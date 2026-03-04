"""CLI entry point for the DeMark Monitor.

Usage:
    demark add AAPL MSFT --tag tech
    demark remove TSLA
    demark list [--tag TAG]
    demark scan [--ticker SYMBOL] [--timeframe daily]
    demark init
    demark dashboard [--port 8050]
    demark export FILE
    demark import FILE
"""

from __future__ import annotations

import json
import logging

import click

from demark.config import get_db_path, load_config
from demark.storage.db import (
    add_ticker,
    export_watchlist,
    get_all_signal_states,
    import_watchlist,
    init_db,
    list_tickers,
    remove_ticker,
    save_alert,
    save_signal_state,
)

logger = logging.getLogger("demark")


@click.group()
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose logging.")
@click.option("--config", "config_path", default=None, help="Path to config file.")
@click.pass_context
def cli(ctx: click.Context, verbose: bool, config_path: str | None) -> None:
    """DeMark Indicators Daily Monitor."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    cfg = load_config(config_path)
    db_path = get_db_path(cfg)
    init_db(db_path)
    ctx.ensure_object(dict)
    ctx.obj["config"] = cfg
    ctx.obj["db_path"] = db_path


@cli.command()
@click.argument("tickers", nargs=-1, required=True)
@click.option("--tag", "-t", multiple=True, help="Tags for the tickers.")
@click.pass_obj
def add(obj: dict, tickers: tuple[str, ...], tag: tuple[str, ...]) -> None:
    """Add tickers to the watchlist."""
    tags = list(tag)
    for t in tickers:
        added = add_ticker(t, tags, obj["db_path"])
        status = "added" if added else "already in watchlist (tags merged)"
        click.echo(f"  {t.upper()}: {status}")


@cli.command()
@click.argument("ticker")
@click.pass_obj
def remove(obj: dict, ticker: str) -> None:
    """Remove a ticker from the watchlist."""
    removed = remove_ticker(ticker, obj["db_path"])
    if removed:
        click.echo(f"  {ticker.upper()}: removed")
    else:
        click.echo(f"  {ticker.upper()}: not found in watchlist")


@cli.command("list")
@click.option("--tag", "-t", default=None, help="Filter by tag.")
@click.pass_obj
def list_cmd(obj: dict, tag: str | None) -> None:
    """List all watched tickers."""
    tickers = list_tickers(tag=tag, db_path=obj["db_path"])
    if not tickers:
        click.echo("  (watchlist is empty)")
        return
    for t in tickers:
        tags_str = ", ".join(t["tags"]) if t["tags"] else ""
        tag_display = f" [{tags_str}]" if tags_str else ""
        click.echo(f"  {t['ticker']}{tag_display}")


@cli.command()
@click.argument("filepath")
@click.pass_obj
def export(obj: dict, filepath: str) -> None:
    """Export the watchlist to a JSON file."""
    data = export_watchlist(db_path=obj["db_path"])
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    click.echo(f"  Exported {len(data)} tickers to {filepath}")


@cli.command("import")
@click.argument("filepath")
@click.pass_obj
def import_cmd(obj: dict, filepath: str) -> None:
    """Import a watchlist from a JSON file."""
    with open(filepath) as f:
        data = json.load(f)
    count = import_watchlist(data, db_path=obj["db_path"])
    click.echo(f"  Imported {count} new tickers from {filepath}")


@cli.command()
@click.pass_obj
def init(obj: dict) -> None:
    """Initialize the watchlist with default tickers from config."""
    defaults = obj["config"].get("watchlist", {}).get("default_tickers", [])
    if not defaults:
        click.echo("  No default tickers configured.")
        return
    for t in defaults:
        add_ticker(t, tags=["default"], db_path=obj["db_path"])
    click.echo(f"  Initialized default watchlist: {', '.join(defaults)}")


def _scan_ticker_timeframe(
    sym: str,
    timeframe: str,
    db_path: str,
    setup_threshold: int,
    countdown_threshold: int,
) -> list:
    """Scan a single ticker on a single timeframe. Returns alerts."""
    from demark.alerts.alerts import generate_alerts
    from demark.data.provider import get_bars
    from demark.engine.sequential import calculate_sequential

    bars = get_bars(sym, timeframe=timeframe)
    if bars.empty:
        return []

    annotations, setups, countdowns, state = calculate_sequential(bars)

    # Save signal state
    last = annotations[-1] if annotations else None
    if last:
        direction = None
        phase = "none"
        count = 0
        tdst = None
        perfected = False
        cd_bar8 = None

        if last.countdown_count > 0 and last.countdown_direction:
            direction = last.countdown_direction.value
            phase = "countdown"
            count = last.countdown_count
            tdst = last.tdst_level
            cd_bar8 = state.countdown_bar8_close
        elif last.setup_count > 0 and last.setup_direction:
            direction = last.setup_direction.value
            phase = "setup"
            count = last.setup_count
            tdst = last.tdst_level
            perfected = last.setup_perfected

        save_signal_state(
            ticker=sym,
            timeframe=timeframe,
            indicator_type="sequential",
            direction=direction,
            phase=phase,
            current_count=count,
            tdst_level=tdst,
            is_perfected=perfected,
            countdown_bar_8_close=cd_bar8,
            db_path=db_path,
        )

    # Generate and save alerts (with dedup)
    alerts = generate_alerts(
        ticker=sym,
        timeframe=timeframe,
        annotations=annotations,
        completed_setups=setups,
        completed_countdowns=countdowns,
        setup_threshold=setup_threshold,
        countdown_threshold=countdown_threshold,
    )

    new_alerts = []
    for a in alerts:
        alert_id = save_alert(
            ticker=a.ticker,
            timeframe=a.timeframe,
            alert_type=a.alert_type,
            priority=a.priority,
            message=a.message,
            dedupe_key=a.dedupe_key or None,
            db_path=db_path,
        )
        if alert_id is not None:
            new_alerts.append(a)

    return new_alerts


@cli.command()
@click.option("--ticker", "-t", default=None, help="Scan a single ticker.")
@click.option(
    "--timeframe", "-tf", default=None,
    help="Timeframe to scan (daily/weekly/monthly/yearly). Omit to scan all configured timeframes.",
)
@click.pass_obj
def scan(obj: dict, ticker: str | None, timeframe: str | None) -> None:
    """Run a DeMark Sequential scan across all configured timeframes."""
    config = obj["config"]
    db_path = obj["db_path"]
    alert_config = config.get("alerts", {})
    setup_threshold = alert_config.get("approaching_setup_threshold", 7)
    countdown_threshold = alert_config.get("approaching_countdown_threshold", 11)

    # Determine tickers
    if ticker:
        tickers_to_scan = [ticker.upper()]
    else:
        watched = list_tickers(db_path=db_path)
        if not watched:
            click.echo("  No tickers in watchlist. Use 'demark add' or 'demark init' first.")
            return
        tickers_to_scan = [t["ticker"] for t in watched]

    # Determine timeframes
    if timeframe:
        timeframes = [timeframe]
    else:
        timeframes = config.get("timeframes", ["daily"])

    click.echo(
        f"\nScanning {len(tickers_to_scan)} ticker(s) across "
        f"{', '.join(timeframes)} timeframes...\n"
    )

    all_alerts = []

    for sym in tickers_to_scan:
        click.echo(f"  {sym}:", nl=False)
        for tf in timeframes:
            try:
                alerts = _scan_ticker_timeframe(
                    sym, tf, db_path, setup_threshold, countdown_threshold,
                )
                all_alerts.extend(alerts)
                click.echo(f" {tf}", nl=False)
            except Exception as e:
                click.echo(f" {tf}(err)", nl=False)
                logger.exception("Error scanning %s/%s: %s", sym, tf, e)
        click.echo()  # newline after ticker

    # Print results
    click.echo(f"\n{'='*70}")
    click.echo("SCAN RESULTS")
    click.echo(f"{'='*70}\n")

    states = get_all_signal_states(db_path=db_path)
    active = [s for s in states if s["phase"] != "none" and s["direction"]]
    if active:
        click.echo(
            f"{'Ticker':<10} {'TF':<8} {'Direction':<6} {'Phase':<10} "
            f"{'Count':<8} {'TDST':>10} {'Perf':>5}"
        )
        click.echo("-" * 60)
        for s in active:
            max_count = 13 if s["phase"] == "countdown" else 9
            count_str = f"{s['current_count']}/{max_count}"
            tdst_str = f"${s['tdst_level']:,.2f}" if s["tdst_level"] else "—"
            perf_str = "Yes" if s["is_perfected"] else "—"
            click.echo(
                f"{s['ticker']:<10} {s['timeframe']:<8} {(s['direction'] or ''):>6} "
                f"{s['phase']:<10} {count_str:<8} {tdst_str:>10} {perf_str:>5}"
            )
    else:
        click.echo("  No active signals found.")

    if all_alerts:
        click.echo(f"\n{'='*70}")
        click.echo("ALERTS")
        click.echo(f"{'='*70}\n")
        for a in all_alerts:
            icon = {"critical": "[!]", "warning": "[*]", "info": "[i]"}.get(a.priority, "[ ]")
            click.echo(f"  {icon} {a.message}")
    else:
        click.echo("\n  No new alerts.")

    click.echo()


@cli.command()
@click.option("--host", default=None, help="Dashboard host.")
@click.option("--port", "-p", default=None, type=int, help="Dashboard port.")
@click.pass_obj
def dashboard(obj: dict, host: str | None, port: int | None) -> None:
    """Launch the web dashboard."""
    config = obj["config"]
    dash_config = config.get("alerts", {}).get("dashboard", {})
    h = host or dash_config.get("host", "0.0.0.0")
    p = port or dash_config.get("port", 8050)

    click.echo(f"  Starting dashboard at http://{h}:{p}")

    from demark.dashboard.app import create_app

    app = create_app(db_path=obj["db_path"])
    app.run(host=h, port=p, debug=False)


if __name__ == "__main__":
    cli()
