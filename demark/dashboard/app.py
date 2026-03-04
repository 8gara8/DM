"""Flask web dashboard for DeMark Monitor.

A daily check-in page showing active signals, recent alerts,
and watchlist status with auto-refresh.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime

from flask import Flask, jsonify, render_template, request

from demark.config import load_config
from demark.storage.db import (
    add_ticker,
    get_all_signal_states,
    get_recent_alerts,
    init_db,
    list_tickers,
    remove_ticker,
)

logger = logging.getLogger("demark")


def _enrich_signals(signals: list[dict]) -> list[dict]:
    """Add display fields to signal dicts."""
    active = [s for s in signals if s["phase"] != "none" and s["direction"]]
    for s in active:
        max_count = 13 if s["phase"] == "countdown" else 9
        s["max_count"] = max_count
        s["count_display"] = f"{s['current_count']}/{max_count}"
        s["progress_pct"] = round(s["current_count"] / max_count * 100)
        s["tdst_display"] = (
            f"${s['tdst_level']:,.2f}" if s["tdst_level"] else "\u2014"
        )
        s["perfected_display"] = "Yes" if s["is_perfected"] else "\u2014"

        if s["phase"] == "setup" and s["current_count"] == 9:
            s["status"] = "Setup Complete"
            s["status_class"] = "complete"
        elif s["phase"] == "countdown" and s["current_count"] == 13:
            s["status"] = "Countdown Complete"
            s["status_class"] = "complete"
        elif s["phase"] == "countdown":
            s["status"] = "Countdown Active"
            s["status_class"] = "active"
        elif s["phase"] == "setup":
            s["status"] = "Setup Active"
            s["status_class"] = "active"
        else:
            s["status"] = "\u2014"
            s["status_class"] = ""
    return active


def _enrich_alerts(alerts: list[dict]) -> list[dict]:
    """Add display fields to alert dicts."""
    icons = {"critical": "\U0001f534", "warning": "\U0001f7e1", "info": "\U0001f7e2"}
    for a in alerts:
        a["icon"] = icons.get(a["priority"], "")
    return alerts


# Track background scan status per ticker
_scan_status: dict[str, str] = {}  # ticker -> "scanning" | "done" | "error:msg"
_scan_lock = threading.Lock()


def _run_scan_background(
    tickers: list[str],
    timeframes: list[str],
    db_path: str,
    setup_threshold: int,
    countdown_threshold: int,
) -> None:
    """Run scan in a background thread."""
    from demark.engine.scan import scan_ticker_timeframe

    for sym in tickers:
        with _scan_lock:
            _scan_status[sym] = "scanning"
        try:
            for tf in timeframes:
                scan_ticker_timeframe(
                    ticker=sym,
                    timeframe=tf,
                    db_path=db_path,
                    setup_threshold=setup_threshold,
                    countdown_threshold=countdown_threshold,
                )
            with _scan_lock:
                _scan_status[sym] = "done"
        except Exception as e:
            logger.exception("Scan error for %s: %s", sym, e)
            with _scan_lock:
                _scan_status[sym] = f"error:{e}"


def create_app(db_path: str = "./demark_monitor.db") -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config["DB_PATH"] = db_path

    config = load_config()
    timeframes = config.get("timeframes", ["daily"])
    alert_config = config.get("alerts", {})
    setup_threshold = alert_config.get("approaching_setup_threshold", 7)
    countdown_threshold = alert_config.get("approaching_countdown_threshold", 11)

    init_db(db_path)

    @app.route("/")
    def index():
        tickers = list_tickers(db_path=db_path)
        active_tickers = {t["ticker"] for t in tickers}
        signals = _enrich_signals(get_all_signal_states(db_path=db_path))
        signals = [s for s in signals if s["ticker"] in active_tickers]
        alerts = _enrich_alerts(get_recent_alerts(limit=50, db_path=db_path))

        # Group signals by ticker
        grouped: dict[str, list[dict]] = {}
        for s in signals:
            grouped.setdefault(s["ticker"], []).append(s)

        return render_template(
            "index.html",
            signals=signals,
            grouped_signals=grouped,
            alerts=alerts,
            tickers=tickers,
            now=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    @app.route("/api/signals")
    def api_signals():
        """JSON endpoint for auto-refresh."""
        tickers = list_tickers(db_path=db_path)
        active_tickers = {t["ticker"] for t in tickers}
        signals = _enrich_signals(get_all_signal_states(db_path=db_path))
        signals = [s for s in signals if s["ticker"] in active_tickers]
        alerts = _enrich_alerts(get_recent_alerts(limit=50, db_path=db_path))
        return jsonify(
            signals=signals,
            alerts=alerts,
            tickers_count=len(tickers),
            updated=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    @app.route("/api/tickers")
    def api_tickers():
        """Return the current watchlist as JSON."""
        tickers = list_tickers(db_path=db_path)
        return jsonify(tickers=tickers)

    @app.route("/api/tickers", methods=["POST"])
    def api_add_ticker():
        """Add a ticker to the watchlist and trigger a background scan."""
        data = request.get_json(silent=True) or {}
        ticker = (data.get("ticker") or "").strip().upper()
        if not ticker:
            return jsonify(error="Ticker is required"), 400
        if not ticker.isalpha() or len(ticker) > 10:
            return jsonify(error="Invalid ticker symbol"), 400
        tags = data.get("tags") or []
        is_new = add_ticker(ticker, tags, db_path=db_path)

        # Kick off a background scan for the new ticker
        thread = threading.Thread(
            target=_run_scan_background,
            args=([ticker], timeframes, db_path, setup_threshold, countdown_threshold),
            daemon=True,
        )
        thread.start()

        return jsonify(ticker=ticker, is_new=is_new, tags=tags, scanning=True), 201 if is_new else 200

    @app.route("/api/tickers/<symbol>", methods=["DELETE"])
    def api_remove_ticker(symbol: str):
        """Remove a ticker from the watchlist."""
        removed = remove_ticker(symbol, db_path=db_path)
        if not removed:
            return jsonify(error="Ticker not found or already removed"), 404
        return jsonify(ticker=symbol.upper(), removed=True)

    @app.route("/api/scan", methods=["POST"])
    def api_scan():
        """Trigger a scan for specific tickers or all watchlist tickers."""
        data = request.get_json(silent=True) or {}
        ticker = (data.get("ticker") or "").strip().upper()

        if ticker:
            tickers_to_scan = [ticker]
        else:
            watched = list_tickers(db_path=db_path)
            if not watched:
                return jsonify(error="No tickers in watchlist"), 400
            tickers_to_scan = [t["ticker"] for t in watched]

        # Check if any of these are already scanning
        with _scan_lock:
            already = [t for t in tickers_to_scan if _scan_status.get(t) == "scanning"]
        if already:
            return jsonify(error=f"Already scanning: {', '.join(already)}"), 409

        thread = threading.Thread(
            target=_run_scan_background,
            args=(tickers_to_scan, timeframes, db_path, setup_threshold, countdown_threshold),
            daemon=True,
        )
        thread.start()

        return jsonify(scanning=tickers_to_scan, count=len(tickers_to_scan))

    @app.route("/api/scan/status")
    def api_scan_status():
        """Check scan status for all tickers."""
        with _scan_lock:
            status = dict(_scan_status)
        return jsonify(status=status)

    @app.route("/ticker/<symbol>")
    def ticker_detail(symbol: str):
        signals = get_all_signal_states(db_path=db_path)
        ticker_signals = [s for s in signals if s["ticker"] == symbol.upper()]
        ticker_signals = _enrich_signals(ticker_signals + [
            s for s in signals
            if s["ticker"] == symbol.upper() and s["phase"] == "none"
        ])

        from demark.storage.db import get_alerts_for_ticker

        alerts = _enrich_alerts(
            get_alerts_for_ticker(symbol, limit=30, db_path=db_path)
        )

        return render_template(
            "ticker.html",
            symbol=symbol.upper(),
            signals=ticker_signals,
            alerts=alerts,
            now=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    return app
