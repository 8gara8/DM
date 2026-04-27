"""TDST (TD Setup Trend) level calculation.

TDST levels serve as support/resistance derived from the bar immediately
before a Setup begins (bar 1).

- TDST Support (Buy Setup): true high of the bar before bar 1
- TDST Resistance (Sell Setup): true low of the bar before bar 1

True High = max(high, previous close)
True Low = min(low, previous close)
"""

from __future__ import annotations

import pandas as pd


def true_high(high: float, prev_close: float) -> float:
    """Calculate true high: max(high, previous close)."""
    return max(high, prev_close)


def true_low(low: float, prev_close: float) -> float:
    """Calculate true low: min(low, previous close)."""
    return min(low, prev_close)


def calc_tdst_support(bars: pd.DataFrame, setup_bar1_idx: int) -> float | None:
    """Calculate TDST Support level for a Buy Setup.

    TDST Support = true high of the bar immediately before bar 1 of the
    Buy Setup.

    Args:
        bars: DataFrame with columns [open, high, low, close] indexed by date.
        setup_bar1_idx: Integer position of bar 1 in the DataFrame.

    Returns:
        The TDST support level, or None if there is insufficient history.
    """
    if setup_bar1_idx < 1:
        return None

    pre_bar = bars.iloc[setup_bar1_idx - 1]
    if setup_bar1_idx < 2:
        # No bar before the pre-bar to get previous close; use pre-bar's high
        return float(pre_bar["high"])

    prev_close = float(bars.iloc[setup_bar1_idx - 2]["close"])
    return true_high(float(pre_bar["high"]), prev_close)


def calc_tdst_resistance(bars: pd.DataFrame, setup_bar1_idx: int) -> float | None:
    """Calculate TDST Resistance level for a Sell Setup.

    TDST Resistance = true low of the bar immediately before bar 1 of the
    Sell Setup.

    Args:
        bars: DataFrame with columns [open, high, low, close] indexed by date.
        setup_bar1_idx: Integer position of bar 1 in the DataFrame.

    Returns:
        The TDST resistance level, or None if there is insufficient history.
    """
    if setup_bar1_idx < 1:
        return None

    pre_bar = bars.iloc[setup_bar1_idx - 1]
    if setup_bar1_idx < 2:
        return float(pre_bar["low"])

    prev_close = float(bars.iloc[setup_bar1_idx - 2]["close"])
    return true_low(float(pre_bar["low"]), prev_close)
