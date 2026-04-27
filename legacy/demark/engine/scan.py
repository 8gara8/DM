"""Reusable scan logic for running DeMark Sequential analysis.

Used by both the CLI and the web dashboard.
"""

from __future__ import annotations

import logging

from demark.alerts.alerts import generate_alerts
from demark.data.provider import get_bars
from demark.engine.sequential import calculate_sequential
from demark.storage.db import save_alert, save_signal_state

logger = logging.getLogger("demark")


def scan_ticker_timeframe(
    ticker: str,
    timeframe: str,
    db_path: str,
    setup_threshold: int = 7,
    countdown_threshold: int = 11,
) -> list:
    """Scan a single ticker on a single timeframe. Returns new alerts."""
    bars = get_bars(ticker, timeframe=timeframe)
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
            ticker=ticker,
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
        ticker=ticker,
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
