"""Alert generation from DeMark Sequential scan results."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from demark.engine.sequential import (
    BarAnnotation,
    CountdownResult,
    Direction,
    SetupResult,
)

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    """Generated alert."""

    ticker: str
    timeframe: str
    alert_type: str
    priority: str  # "critical", "warning", "info"
    message: str
    dedupe_key: str = ""


def generate_alerts(
    ticker: str,
    timeframe: str,
    annotations: list[BarAnnotation],
    completed_setups: list[SetupResult],
    completed_countdowns: list[CountdownResult],
    setup_threshold: int = 7,
    countdown_threshold: int = 11,
) -> list[Alert]:
    """Generate alerts from scan results.

    Only considers the LAST bar's annotations (the most recent bar) plus
    any completed setups/countdowns that occurred on the last bar.

    Args:
        ticker: Security symbol.
        timeframe: Timeframe string.
        annotations: All bar annotations from the scan.
        completed_setups: Completed setups from the scan.
        completed_countdowns: Completed countdowns from the scan.
        setup_threshold: Alert when setup count >= this (default 7).
        countdown_threshold: Alert when countdown count >= this (default 11).

    Returns:
        List of Alert objects.
    """
    if not annotations:
        return []

    alerts: list[Alert] = []
    last = annotations[-1]
    date_str = str(last.date)[:10]

    # --- Setup completion alerts ---
    for setup in completed_setups:
        if setup.bar9_date == last.date:
            direction = setup.direction.value.title()
            perfected = "yes" if setup.is_perfected else "no"
            tdst_str = f"${setup.tdst_level:,.2f}" if setup.tdst_level else "N/A"
            level_type = "support" if setup.direction == Direction.BUY else "resistance"

            alerts.append(Alert(
                ticker=ticker,
                timeframe=timeframe,
                alert_type="setup_complete",
                priority="warning",
                message=(
                    f"{ticker} {timeframe.title()}: {direction} Setup 9 completed "
                    f"(perfected: {perfected}). TDST {level_type} at {tdst_str}"
                ),
                dedupe_key=f"{ticker}:{timeframe}:setup_complete-{date_str}",
            ))

    # --- Countdown completion alerts ---
    for cd in completed_countdowns:
        if cd.bar13_date == last.date:
            direction = cd.direction.value.title()
            qualified = "yes" if cd.is_qualified else "no"

            alerts.append(Alert(
                ticker=ticker,
                timeframe=timeframe,
                alert_type="countdown_complete",
                priority="critical",
                message=(
                    f"{ticker} {timeframe.title()}: {direction} Countdown 13 completed "
                    f"(qualified: {qualified})"
                ),
                dedupe_key=f"{ticker}:{timeframe}:countdown_complete-{date_str}",
            ))

    # --- Approaching setup completion ---
    if (
        last.setup_count >= setup_threshold
        and last.setup_count < 9
        and last.setup_direction is not None
    ):
        direction = last.setup_direction.value.title()
        remaining = 9 - last.setup_count
        bar_word = "bar" if remaining == 1 else "bars"
        alerts.append(Alert(
            ticker=ticker,
            timeframe=timeframe,
            alert_type="approaching_setup",
            priority="info",
            message=(
                f"{ticker} {timeframe.title()}: {direction} Setup at bar "
                f"{last.setup_count} of 9 — {remaining} more qualifying {bar_word} "
                f"to complete"
            ),
            dedupe_key=f"{ticker}:{timeframe}:approaching_setup-{date_str}",
        ))

    # --- Approaching countdown completion ---
    if (
        last.countdown_count >= countdown_threshold
        and last.countdown_count < 13
        and last.countdown_direction is not None
    ):
        direction = last.countdown_direction.value.title()
        remaining = 13 - last.countdown_count
        bar_word = "bar" if remaining == 1 else "bars"
        alerts.append(Alert(
            ticker=ticker,
            timeframe=timeframe,
            alert_type="approaching_countdown",
            priority="warning" if last.countdown_count >= 12 else "info",
            message=(
                f"{ticker} {timeframe.title()}: {direction} Countdown at bar "
                f"{last.countdown_count} of 13 — {remaining} more qualifying {bar_word} "
                f"to complete"
            ),
            dedupe_key=f"{ticker}:{timeframe}:approaching_countdown-{date_str}",
        ))

    return alerts
