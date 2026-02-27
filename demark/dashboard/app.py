"""Flask web dashboard for DeMark Monitor.

A simple daily check-in page showing all active signals, recent alerts,
and watchlist status.
"""

from __future__ import annotations

from datetime import datetime

from flask import Flask, render_template

from demark.storage.db import (
    get_all_signal_states,
    get_recent_alerts,
    init_db,
    list_tickers,
)


def create_app(db_path: str = "./demark_monitor.db") -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config["DB_PATH"] = db_path

    init_db(db_path)

    @app.route("/")
    def index():
        """Main dashboard view — signal summary table + alerts."""
        signals = get_all_signal_states(db_path=db_path)
        alerts = get_recent_alerts(limit=50, db_path=db_path)
        tickers = list_tickers(db_path=db_path)

        # Separate active signals from inactive
        active_signals = [
            s for s in signals if s["phase"] != "none" and s["direction"]
        ]

        # Enrich signals with display info
        for s in active_signals:
            max_count = 13 if s["phase"] == "countdown" else 9
            s["max_count"] = max_count
            s["count_display"] = f"{s['current_count']}/{max_count}"
            s["tdst_display"] = (
                f"${s['tdst_level']:,.2f}" if s["tdst_level"] else "—"
            )
            s["perfected_display"] = "Yes" if s["is_perfected"] else "—"

            # Status text
            if s["phase"] == "setup" and s["current_count"] == 9:
                s["status"] = "Setup Complete"
            elif s["phase"] == "countdown" and s["current_count"] == 13:
                s["status"] = "Countdown Complete"
            elif s["phase"] == "countdown":
                s["status"] = "Countdown Active"
            elif s["phase"] == "setup":
                s["status"] = "Setup Active"
            else:
                s["status"] = "—"

        # Add priority icons to alerts
        priority_icons = {
            "critical": "\U0001f534",
            "warning": "\U0001f7e1",
            "info": "\U0001f7e2",
        }
        for a in alerts:
            a["icon"] = priority_icons.get(a["priority"], "")

        return render_template(
            "index.html",
            signals=active_signals,
            alerts=alerts,
            tickers=tickers,
            now=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    @app.route("/ticker/<symbol>")
    def ticker_detail(symbol: str):
        """Detail view for a single ticker."""
        signals = get_all_signal_states(db_path=db_path)
        ticker_signals = [
            s for s in signals if s["ticker"] == symbol.upper()
        ]

        for s in ticker_signals:
            max_count = 13 if s["phase"] == "countdown" else 9
            s["max_count"] = max_count
            s["count_display"] = f"{s['current_count']}/{max_count}"
            s["tdst_display"] = (
                f"${s['tdst_level']:,.2f}" if s["tdst_level"] else "—"
            )
            s["perfected_display"] = "Yes" if s["is_perfected"] else "—"

        from demark.storage.db import get_alerts_for_ticker

        alerts = get_alerts_for_ticker(symbol, limit=30, db_path=db_path)
        priority_icons = {
            "critical": "\U0001f534",
            "warning": "\U0001f7e1",
            "info": "\U0001f7e2",
        }
        for a in alerts:
            a["icon"] = priority_icons.get(a["priority"], "")

        return render_template(
            "ticker.html",
            symbol=symbol.upper(),
            signals=ticker_signals,
            alerts=alerts,
            now=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        )

    return app
