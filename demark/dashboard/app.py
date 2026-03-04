"""Flask web dashboard for DeMark Monitor.

A daily check-in page showing active signals, recent alerts,
and watchlist status with auto-refresh.
"""

from __future__ import annotations

from datetime import datetime

from flask import Flask, jsonify, render_template, request

from demark.storage.db import (
    add_ticker,
    get_all_signal_states,
    get_recent_alerts,
    init_db,
    list_tickers,
    remove_ticker,
)


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


def create_app(db_path: str = "./demark_monitor.db") -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config["DB_PATH"] = db_path

    init_db(db_path)

    @app.route("/")
    def index():
        signals = _enrich_signals(get_all_signal_states(db_path=db_path))
        alerts = _enrich_alerts(get_recent_alerts(limit=50, db_path=db_path))
        tickers = list_tickers(db_path=db_path)

        return render_template(
            "index.html",
            signals=signals,
            alerts=alerts,
            tickers=tickers,
            now=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    @app.route("/api/signals")
    def api_signals():
        """JSON endpoint for auto-refresh."""
        signals = _enrich_signals(get_all_signal_states(db_path=db_path))
        alerts = _enrich_alerts(get_recent_alerts(limit=50, db_path=db_path))
        tickers = list_tickers(db_path=db_path)
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
        """Add a ticker to the watchlist."""
        data = request.get_json(silent=True) or {}
        ticker = (data.get("ticker") or "").strip().upper()
        if not ticker:
            return jsonify(error="Ticker is required"), 400
        if not ticker.isalpha() or len(ticker) > 10:
            return jsonify(error="Invalid ticker symbol"), 400
        tags = data.get("tags") or []
        is_new = add_ticker(ticker, tags, db_path=db_path)
        return jsonify(ticker=ticker, is_new=is_new, tags=tags), 201 if is_new else 200

    @app.route("/api/tickers/<symbol>", methods=["DELETE"])
    def api_remove_ticker(symbol: str):
        """Remove a ticker from the watchlist."""
        removed = remove_ticker(symbol, db_path=db_path)
        if not removed:
            return jsonify(error="Ticker not found or already removed"), 404
        return jsonify(ticker=symbol.upper(), removed=True)

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
