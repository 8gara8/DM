"""CLI entry point for the DeMark Monitor.

Usage:
    demark add AAPL MSFT --tag tech
    demark remove TSLA
    demark list [--tag TAG]
    demark scan [--ticker SYMBOL] [--timeframe daily]
    demark dashboard [--port 8050]
    demark export FILE
    demark import FILE
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import click
import yaml

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


def _load_config() -> dict:
    """Load config.yaml from the current directory or package root."""
    for path in [Path("config.yaml"), Path(__file__).parent.parent / "config.yaml"]:
        if path.exists():
            with open(path) as f:
                return yaml.safe_load(f)
    return {}


def _get_db_path(config: dict | None = None) -> str:
    config = config or _load_config()
    return config.get("database", {}).get("path", "./demark_monitor.db")


@click.group()
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose logging.")
def cli(verbose: bool) -> None:
    """DeMark Indicators Daily Monitor."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    config = _load_config()
    db_path = _get_db_path(config)
    init_db(db_path)


@cli.command()
@click.argument("tickers", nargs=-1, required=True)
@click.option("--tag", "-t", multiple=True, help="Tags for the tickers.")
def add(tickers: tuple[str, ...], tag: tuple[str, ...]) -> None:
    """Add tickers to the watchlist."""
    db_path = _get_db_path()
    tags = list(tag)
    for t in tickers:
        added = add_ticker(t, tags, db_path)
        status = "added" if added else "already in watchlist (tags merged)"
        click.echo(f"  {t.upper()}: {status}")


@cli.command()
@click.argument("ticker")
def remove(ticker: str) -> None:
    """Remove a ticker from the watchlist."""
    db_path = _get_db_path()
    removed = remove_ticker(ticker, db_path)
    if removed:
        click.echo(f"  {ticker.upper()}: removed")
    else:
        click.echo(f"  {ticker.upper()}: not found in watchlist")


@cli.command("list")
@click.option("--tag", "-t", default=None, help="Filter by tag.")
def list_cmd(tag: str | None) -> None:
    """List all watched tickers."""
    db_path = _get_db_path()
    tickers = list_tickers(tag=tag, db_path=db_path)
    if not tickers:
        click.echo("  (watchlist is empty)")
        return
    for t in tickers:
        tags_str = ", ".join(t["tags"]) if t["tags"] else ""
        tag_display = f" [{tags_str}]" if tags_str else ""
        click.echo(f"  {t['ticker']}{tag_display}")


@cli.command()
@click.argument("filepath")
def export(filepath: str) -> None:
    """Export the watchlist to a JSON file."""
    db_path = _get_db_path()
    data = export_watchlist(db_path=db_path)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    click.echo(f"  Exported {len(data)} tickers to {filepath}")


@cli.command("import")
@click.argument("filepath")
def import_cmd(filepath: str) -> None:
    """Import a watchlist from a JSON file."""
    db_path = _get_db_path()
    with open(filepath) as f:
        data = json.load(f)
    count = import_watchlist(data, db_path=db_path)
    click.echo(f"  Imported {count} new tickers from {filepath}")


@cli.command()
@click.option("--ticker", "-t", default=None, help="Scan a single ticker.")
@click.option("--timeframe", "-tf", default="daily", help="Timeframe (daily/weekly/monthly/yearly).")
def scan(ticker: str | None, timeframe: str) -> None:
    """Run a DeMark Sequential scan."""
    from demark.alerts.alerts import generate_alerts
    from demark.data.provider import get_bars
    from demark.engine.sequential import SequentialState, calculate_sequential

    config = _load_config()
    db_path = _get_db_path(config)
    alert_config = config.get("alerts", {})
    setup_threshold = alert_config.get("approaching_setup_threshold", 7)
    countdown_threshold = alert_config.get("approaching_countdown_threshold", 11)

    # Determine tickers to scan
    if ticker:
        tickers_to_scan = [ticker.upper()]
    else:
        watched = list_tickers(db_path=db_path)
        if not watched:
            click.echo("  No tickers in watchlist. Use 'demark add' first.")
            return
        tickers_to_scan = [t["ticker"] for t in watched]

    click.echo(f"\nScanning {len(tickers_to_scan)} ticker(s) on {timeframe} timeframe...\n")

    all_alerts = []

    for sym in tickers_to_scan:
        try:
            click.echo(f"  Fetching {sym}...", nl=False)
            bars = get_bars(sym, timeframe=timeframe)
            if bars.empty:
                click.echo(" no data")
                continue

            annotations, setups, countdowns, state = calculate_sequential(bars)
            click.echo(f" {len(bars)} bars")

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

            # Generate alerts
            alerts = generate_alerts(
                ticker=sym,
                timeframe=timeframe,
                annotations=annotations,
                completed_setups=setups,
                completed_countdowns=countdowns,
                setup_threshold=setup_threshold,
                countdown_threshold=countdown_threshold,
            )

            for a in alerts:
                save_alert(
                    ticker=a.ticker,
                    timeframe=a.timeframe,
                    alert_type=a.alert_type,
                    priority=a.priority,
                    message=a.message,
                    db_path=db_path,
                )

            all_alerts.extend(alerts)

        except Exception as e:
            click.echo(f" error: {e}")
            logger.exception("Error scanning %s", sym)

    # Print results
    click.echo(f"\n{'='*70}")
    click.echo("SCAN RESULTS")
    click.echo(f"{'='*70}\n")

    # Show current signal states
    states = get_all_signal_states(db_path=db_path)
    if states:
        click.echo(f"{'Ticker':<10} {'TF':<8} {'Direction':<6} {'Phase':<10} {'Count':<8} {'TDST':>10} {'Perf':>5}")
        click.echo("-" * 60)
        for s in states:
            if s["phase"] == "none" or not s["direction"]:
                continue
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

    # Print alerts
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
def dashboard(host: str | None, port: int | None) -> None:
    """Launch the web dashboard."""
    config = _load_config()
    dash_config = config.get("alerts", {}).get("dashboard", {})
    h = host or dash_config.get("host", "0.0.0.0")
    p = port or dash_config.get("port", 8050)
    db_path = _get_db_path(config)

    click.echo(f"  Starting dashboard at http://{h}:{p}")

    from demark.dashboard.app import create_app

    app = create_app(db_path=db_path)
    app.run(host=h, port=p, debug=False)


if __name__ == "__main__":
    cli()
