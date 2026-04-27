"""Data provider for fetching OHLCV price data.

Uses yfinance by default, with architecture allowing swap to other providers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd

logger = logging.getLogger(__name__)


def fetch_daily_bars(
    ticker: str,
    period: str = "2y",
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame:
    """Fetch daily OHLCV bars from yfinance.

    Args:
        ticker: Security symbol (e.g., "AAPL", "SPY", "BTC-USD").
        period: yfinance period string (e.g., "1y", "2y", "5y", "max").
                Ignored if start/end are provided.
        start: Start date string "YYYY-MM-DD".
        end: End date string "YYYY-MM-DD".

    Returns:
        DataFrame with columns [open, high, low, close, volume] and
        DatetimeIndex. Column names are lowercase.
    """
    try:
        import yfinance as yf
    except ImportError:
        raise ImportError("yfinance is required: pip install yfinance")

    try:
        tk = yf.Ticker(ticker)
        if start and end:
            df = tk.history(start=start, end=end, auto_adjust=True)
        elif start:
            df = tk.history(start=start, auto_adjust=True)
        else:
            df = tk.history(period=period, auto_adjust=True)
    except Exception as e:
        logger.error("Failed to fetch data for %s: %s", ticker, e)
        return pd.DataFrame()

    if df.empty:
        logger.warning("No data returned for %s", ticker)
        return df

    # Normalize column names to lowercase
    df.columns = [c.lower() for c in df.columns]

    # Keep only OHLCV columns
    keep = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
    df = df[keep]

    # Drop any rows with NaN in OHLC
    df = df.dropna(subset=["open", "high", "low", "close"])

    return df


def aggregate_weekly(daily: pd.DataFrame) -> pd.DataFrame:
    """Aggregate daily bars into weekly bars.

    Each week: open=Monday's open, high=week high, low=week low,
    close=Friday's close, volume=sum.
    """
    if daily.empty:
        return daily

    weekly = daily.resample("W-FRI").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open", "close"])

    return weekly


def aggregate_monthly(daily: pd.DataFrame) -> pd.DataFrame:
    """Aggregate daily bars into monthly bars."""
    if daily.empty:
        return daily

    monthly = daily.resample("ME").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open", "close"])

    return monthly


def aggregate_yearly(daily: pd.DataFrame) -> pd.DataFrame:
    """Aggregate daily bars into yearly bars."""
    if daily.empty:
        return daily

    yearly = daily.resample("YE").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open", "close"])

    return yearly


def get_bars(
    ticker: str,
    timeframe: str = "daily",
    period: str = "2y",
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame:
    """Fetch bars for any supported timeframe.

    Args:
        ticker: Security symbol.
        timeframe: One of "daily", "weekly", "monthly", "yearly".
        period: yfinance period for daily data fetch.
        start: Optional start date.
        end: Optional end date.

    Returns:
        OHLCV DataFrame for the requested timeframe.
    """
    # For non-daily timeframes, fetch longer history to have enough bars
    if timeframe != "daily" and not start:
        if timeframe == "weekly":
            period = "5y"
        elif timeframe == "monthly":
            period = "10y"
        elif timeframe == "yearly":
            period = "max"

    daily = fetch_daily_bars(ticker, period=period, start=start, end=end)

    if daily.empty:
        return daily

    if timeframe == "daily":
        return daily
    elif timeframe == "weekly":
        return aggregate_weekly(daily)
    elif timeframe == "monthly":
        return aggregate_monthly(daily)
    elif timeframe == "yearly":
        return aggregate_yearly(daily)
    else:
        raise ValueError(f"Unknown timeframe: {timeframe}")
