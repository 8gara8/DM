"""TD Sequential calculation engine.

Implements the full TD Sequential indicator:
  - Setup Phase (count of 9)
  - Countdown Phase (count of 13)
  - Setup Perfection detection
  - Countdown Qualification (bar 13 check)
  - TDST level tracking
  - Countdown cancellation rules

The engine processes an OHLCV DataFrame and produces bar-by-bar annotations
that can be stored and used for alerting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import pandas as pd

from demark.engine.tdst import calc_tdst_resistance, calc_tdst_support


class Direction(str, Enum):
    BUY = "buy"
    SELL = "sell"


class Phase(str, Enum):
    NONE = "none"
    SETUP = "setup"
    COUNTDOWN = "countdown"


@dataclass
class SetupResult:
    """Result of a completed Setup (9-count)."""

    direction: Direction
    bar1_idx: int  # positional index in the DataFrame
    bar9_idx: int
    bar1_date: Any
    bar9_date: Any
    is_perfected: bool
    tdst_level: float | None


@dataclass
class CountdownResult:
    """Result of a completed Countdown (13-count)."""

    direction: Direction
    bar13_idx: int
    bar13_date: Any
    is_qualified: bool
    setup: SetupResult


@dataclass
class BarAnnotation:
    """Per-bar DeMark annotation for output/display."""

    date: Any
    setup_direction: Direction | None = None
    setup_count: int = 0
    setup_perfected: bool = False
    countdown_direction: Direction | None = None
    countdown_count: int = 0
    countdown_qualified: bool = False
    tdst_level: float | None = None
    tdst_direction: Direction | None = None
    setup_completed: bool = False
    countdown_completed: bool = False


@dataclass
class SequentialState:
    """Running state for the TD Sequential engine.

    This captures everything needed to continue processing new bars
    incrementally without recalculating from scratch.
    """

    # Setup state
    setup_direction: Direction | None = None
    setup_count: int = 0
    setup_bar1_idx: int | None = None
    setup_bar1_date: Any = None

    # Completed setup info (needed during countdown)
    active_setup: SetupResult | None = None

    # Countdown state
    countdown_direction: Direction | None = None
    countdown_count: int = 0
    countdown_bar8_close: float | None = None  # for qualification check
    countdown_bar_indices: list[int] = field(default_factory=list)

    # TDST
    tdst_level: float | None = None
    tdst_direction: Direction | None = None


def _check_buy_setup_perfection(bars: pd.DataFrame, bar9_idx: int) -> bool:
    """Check if a Buy Setup is perfected.

    Buy Setup is perfected if the low of bar 8 or bar 9 is less than
    the low of BOTH bars 6 and 7.

    Args:
        bars: OHLCV DataFrame.
        bar9_idx: Positional index of bar 9 in the DataFrame.

    Returns:
        True if perfected.
    """
    # bar9_idx is bar 9; bar 8 is bar9_idx - 1, etc.
    bar6_idx = bar9_idx - 3
    bar7_idx = bar9_idx - 2
    bar8_idx = bar9_idx - 1

    if bar6_idx < 0:
        return False

    low6 = bars.iloc[bar6_idx]["low"]
    low7 = bars.iloc[bar7_idx]["low"]
    low8 = bars.iloc[bar8_idx]["low"]
    low9 = bars.iloc[bar9_idx]["low"]

    return bool((low8 < low6 and low8 < low7) or (low9 < low6 and low9 < low7))


def _check_sell_setup_perfection(bars: pd.DataFrame, bar9_idx: int) -> bool:
    """Check if a Sell Setup is perfected.

    Sell Setup is perfected if the high of bar 8 or bar 9 is greater than
    the high of BOTH bars 6 and 7.
    """
    bar6_idx = bar9_idx - 3
    bar7_idx = bar9_idx - 2
    bar8_idx = bar9_idx - 1

    if bar6_idx < 0:
        return False

    high6 = bars.iloc[bar6_idx]["high"]
    high7 = bars.iloc[bar7_idx]["high"]
    high8 = bars.iloc[bar8_idx]["high"]
    high9 = bars.iloc[bar9_idx]["high"]

    return bool((high8 > high6 and high8 > high7) or (high9 > high6 and high9 > high7))


def calculate_sequential(
    bars: pd.DataFrame,
    state: SequentialState | None = None,
    start_idx: int = 0,
) -> tuple[list[BarAnnotation], list[SetupResult], list[CountdownResult], SequentialState]:
    """Calculate TD Sequential annotations for an OHLCV DataFrame.

    Args:
        bars: DataFrame with columns [open, high, low, close] and a
              DatetimeIndex (or any index). Must have at least 5 rows for
              the Setup comparison to begin.
        state: Optional pre-existing state for incremental calculation.
               Pass None to calculate from scratch.
        start_idx: Positional index to begin processing from. Useful for
                   incremental updates (process only new bars).

    Returns:
        A tuple of:
          - List of BarAnnotation, one per bar from start_idx onward
          - List of completed SetupResults
          - List of completed CountdownResults
          - The final SequentialState (for persistence / incremental use)
    """
    if state is None:
        state = SequentialState()

    annotations: list[BarAnnotation] = []
    completed_setups: list[SetupResult] = []
    completed_countdowns: list[CountdownResult] = []

    n = len(bars)

    for i in range(start_idx, n):
        ann = BarAnnotation(date=bars.index[i])

        close_i = float(bars.iloc[i]["close"])

        # --- SETUP PHASE ---
        # Setup comparison: close vs close 4 bars earlier
        if i >= 4:
            close_4ago = float(bars.iloc[i - 4]["close"])

            buy_qualifies = close_i < close_4ago
            sell_qualifies = close_i > close_4ago

            if buy_qualifies:
                if state.setup_direction == Direction.BUY:
                    state.setup_count += 1
                else:
                    # Start a new buy setup
                    state.setup_direction = Direction.BUY
                    state.setup_count = 1
                    state.setup_bar1_idx = i
                    state.setup_bar1_date = bars.index[i]
            elif sell_qualifies:
                if state.setup_direction == Direction.SELL:
                    state.setup_count += 1
                else:
                    # Start a new sell setup
                    state.setup_direction = Direction.SELL
                    state.setup_count = 1
                    state.setup_bar1_idx = i
                    state.setup_bar1_date = bars.index[i]
            else:
                # close_i == close_4ago — resets setup
                state.setup_direction = None
                state.setup_count = 0
                state.setup_bar1_idx = None
                state.setup_bar1_date = None

            # Record setup info in annotation
            ann.setup_direction = state.setup_direction
            ann.setup_count = state.setup_count

            # Check for Setup completion (bar 9)
            if state.setup_count == 9:
                bar1_idx = state.setup_bar1_idx
                direction = state.setup_direction

                # Perfection check
                if direction == Direction.BUY:
                    perfected = _check_buy_setup_perfection(bars, i)
                    tdst = calc_tdst_support(bars, bar1_idx)
                else:
                    perfected = _check_sell_setup_perfection(bars, i)
                    tdst = calc_tdst_resistance(bars, bar1_idx)

                setup_result = SetupResult(
                    direction=direction,
                    bar1_idx=bar1_idx,
                    bar9_idx=i,
                    bar1_date=state.setup_bar1_date,
                    bar9_date=bars.index[i],
                    is_perfected=perfected,
                    tdst_level=tdst,
                )
                completed_setups.append(setup_result)

                ann.setup_perfected = perfected
                ann.setup_completed = True
                ann.tdst_level = tdst
                ann.tdst_direction = direction

                # --- Handle countdown on setup completion ---
                # If there's an active countdown in the OPPOSITE direction,
                # cancel it.
                if (
                    state.countdown_direction is not None
                    and state.countdown_direction != direction
                ):
                    state.countdown_direction = None
                    state.countdown_count = 0
                    state.countdown_bar8_close = None
                    state.countdown_bar_indices = []

                # If there's an active countdown in the SAME direction,
                # this is a potential recycling event. For Phase 1, we
                # restart the countdown (recycle).
                if (
                    state.countdown_direction is not None
                    and state.countdown_direction == direction
                ):
                    state.countdown_count = 0
                    state.countdown_bar8_close = None
                    state.countdown_bar_indices = []

                # Start a new countdown from this completed setup
                state.active_setup = setup_result
                state.countdown_direction = direction
                state.countdown_count = 0
                state.countdown_bar8_close = None
                state.countdown_bar_indices = []
                state.tdst_level = tdst
                state.tdst_direction = direction

                # Reset setup count so the next bar starts fresh
                state.setup_direction = None
                state.setup_count = 0
                state.setup_bar1_idx = None
                state.setup_bar1_date = None
        else:
            # Not enough bars for comparison yet
            ann.setup_direction = None
            ann.setup_count = 0

        # --- COUNTDOWN PHASE ---
        if state.countdown_direction is not None and i >= 2:
            if state.countdown_direction == Direction.BUY:
                # Buy Countdown: close <= low 2 bars earlier
                low_2ago = float(bars.iloc[i - 2]["low"])
                if close_i <= low_2ago:
                    state.countdown_count += 1
                    state.countdown_bar_indices.append(i)
                    if state.countdown_count == 8:
                        state.countdown_bar8_close = close_i
            elif state.countdown_direction == Direction.SELL:
                # Sell Countdown: close >= high 2 bars earlier
                high_2ago = float(bars.iloc[i - 2]["high"])
                if close_i >= high_2ago:
                    state.countdown_count += 1
                    state.countdown_bar_indices.append(i)
                    if state.countdown_count == 8:
                        state.countdown_bar8_close = close_i

            ann.countdown_direction = state.countdown_direction
            ann.countdown_count = state.countdown_count
            ann.tdst_level = state.tdst_level
            ann.tdst_direction = state.tdst_direction

            # Check for TDST breach (cancellation)
            if state.tdst_level is not None:
                if (
                    state.countdown_direction == Direction.BUY
                    and close_i > state.tdst_level
                ):
                    # Close above TDST support invalidates buy setup
                    pass  # Phase 1: track but don't auto-cancel (debatable)
                elif (
                    state.countdown_direction == Direction.SELL
                    and close_i < state.tdst_level
                ):
                    pass  # Phase 1: track but don't auto-cancel

            # Check for Countdown completion (bar 13)
            if state.countdown_count == 13:
                # Qualification check: bar 13 close vs bar 8 close
                qualified = False
                if state.countdown_bar8_close is not None:
                    if state.countdown_direction == Direction.BUY:
                        qualified = close_i <= state.countdown_bar8_close
                    else:
                        qualified = close_i >= state.countdown_bar8_close

                countdown_result = CountdownResult(
                    direction=state.countdown_direction,
                    bar13_idx=i,
                    bar13_date=bars.index[i],
                    is_qualified=qualified,
                    setup=state.active_setup,
                )
                completed_countdowns.append(countdown_result)

                ann.countdown_completed = True
                ann.countdown_qualified = qualified

                # Reset countdown state
                state.countdown_direction = None
                state.countdown_count = 0
                state.countdown_bar8_close = None
                state.countdown_bar_indices = []
                state.active_setup = None

        annotations.append(ann)

    return annotations, completed_setups, completed_countdowns, state
