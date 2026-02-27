"""Unit tests for the SQLite storage layer."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from demark.storage.db import (
    add_ticker,
    cache_prices,
    export_watchlist,
    get_all_signal_states,
    get_cached_prices,
    get_recent_alerts,
    get_signal_state,
    import_watchlist,
    init_db,
    list_tickers,
    remove_ticker,
    save_alert,
    save_signal_state,
)


@pytest.fixture
def db_path():
    """Provide a temporary database path for each test."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    init_db(path)
    yield path
    os.unlink(path)


class TestWatchlist:
    def test_add_ticker(self, db_path):
        assert add_ticker("AAPL", db_path=db_path) is True
        # Adding again returns False (already exists)
        assert add_ticker("AAPL", db_path=db_path) is False

    def test_add_ticker_with_tags(self, db_path):
        add_ticker("AAPL", tags=["tech", "mega"], db_path=db_path)
        tickers = list_tickers(db_path=db_path)
        assert len(tickers) == 1
        assert "tech" in tickers[0]["tags"]
        assert "mega" in tickers[0]["tags"]

    def test_add_ticker_merges_tags(self, db_path):
        add_ticker("AAPL", tags=["tech"], db_path=db_path)
        add_ticker("AAPL", tags=["mega"], db_path=db_path)
        tickers = list_tickers(db_path=db_path)
        assert set(tickers[0]["tags"]) == {"tech", "mega"}

    def test_remove_ticker(self, db_path):
        add_ticker("AAPL", db_path=db_path)
        assert remove_ticker("AAPL", db_path=db_path) is True
        assert list_tickers(db_path=db_path) == []

    def test_remove_nonexistent(self, db_path):
        assert remove_ticker("FAKE", db_path=db_path) is False

    def test_list_tickers(self, db_path):
        add_ticker("AAPL", tags=["tech"], db_path=db_path)
        add_ticker("SPY", tags=["index"], db_path=db_path)
        add_ticker("MSFT", tags=["tech"], db_path=db_path)

        all_tickers = list_tickers(db_path=db_path)
        assert len(all_tickers) == 3

        tech_only = list_tickers(tag="tech", db_path=db_path)
        assert len(tech_only) == 2
        assert all(t["ticker"] in ("AAPL", "MSFT") for t in tech_only)

    def test_list_tickers_case_insensitive_tag(self, db_path):
        add_ticker("AAPL", tags=["Tech"], db_path=db_path)
        result = list_tickers(tag="tech", db_path=db_path)
        assert len(result) == 1

    def test_reactivate_removed_ticker(self, db_path):
        add_ticker("AAPL", db_path=db_path)
        remove_ticker("AAPL", db_path=db_path)
        assert add_ticker("AAPL", db_path=db_path) is True
        assert len(list_tickers(db_path=db_path)) == 1

    def test_export_import(self, db_path):
        add_ticker("AAPL", tags=["tech"], db_path=db_path)
        add_ticker("SPY", tags=["index"], db_path=db_path)
        exported = export_watchlist(db_path=db_path)
        assert len(exported) == 2

        # Import into a fresh DB
        fd, path2 = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        init_db(path2)
        count = import_watchlist(exported, db_path=path2)
        assert count == 2
        assert len(list_tickers(db_path=path2)) == 2
        os.unlink(path2)

    def test_ticker_uppercased(self, db_path):
        add_ticker("aapl", db_path=db_path)
        tickers = list_tickers(db_path=db_path)
        assert tickers[0]["ticker"] == "AAPL"


class TestSignalStates:
    def test_save_and_get(self, db_path):
        save_signal_state(
            ticker="AAPL",
            timeframe="daily",
            indicator_type="sequential",
            direction="buy",
            phase="setup",
            current_count=5,
            tdst_level=182.45,
            db_path=db_path,
        )
        state = get_signal_state("AAPL", "daily", db_path=db_path)
        assert state is not None
        assert state["direction"] == "buy"
        assert state["phase"] == "setup"
        assert state["current_count"] == 5
        assert state["tdst_level"] == 182.45

    def test_upsert(self, db_path):
        save_signal_state(
            ticker="AAPL", timeframe="daily", indicator_type="sequential",
            direction="buy", phase="setup", current_count=5, db_path=db_path,
        )
        save_signal_state(
            ticker="AAPL", timeframe="daily", indicator_type="sequential",
            direction="buy", phase="countdown", current_count=3, db_path=db_path,
        )
        state = get_signal_state("AAPL", "daily", db_path=db_path)
        assert state["phase"] == "countdown"
        assert state["current_count"] == 3

    def test_get_all(self, db_path):
        save_signal_state(
            ticker="AAPL", timeframe="daily", indicator_type="sequential",
            direction="buy", phase="setup", current_count=5, db_path=db_path,
        )
        save_signal_state(
            ticker="SPY", timeframe="weekly", indicator_type="sequential",
            direction="sell", phase="countdown", current_count=8, db_path=db_path,
        )
        all_states = get_all_signal_states(db_path=db_path)
        assert len(all_states) == 2

    def test_get_nonexistent(self, db_path):
        assert get_signal_state("FAKE", "daily", db_path=db_path) is None


class TestAlerts:
    def test_save_and_retrieve(self, db_path):
        alert_id = save_alert(
            ticker="AAPL", timeframe="daily",
            alert_type="setup_complete", priority="warning",
            message="AAPL Daily: Sell Setup 9 completed", db_path=db_path,
        )
        assert alert_id > 0

        alerts = get_recent_alerts(db_path=db_path)
        assert len(alerts) == 1
        assert alerts[0]["ticker"] == "AAPL"
        assert alerts[0]["priority"] == "warning"

    def test_recent_alerts_ordering(self, db_path):
        save_alert("AAPL", "daily", "setup_complete", "warning", "msg1", db_path=db_path)
        save_alert("SPY", "weekly", "countdown_complete", "critical", "msg2", db_path=db_path)
        alerts = get_recent_alerts(db_path=db_path)
        # Most recent first
        assert alerts[0]["ticker"] == "SPY"

    def test_alerts_limit(self, db_path):
        for i in range(10):
            save_alert(f"T{i}", "daily", "info", "info", f"msg{i}", db_path=db_path)
        alerts = get_recent_alerts(limit=5, db_path=db_path)
        assert len(alerts) == 5


class TestPriceCache:
    def test_cache_and_retrieve(self, db_path):
        bars = [
            {"date": "2024-01-02", "open": 100, "high": 105, "low": 98, "close": 103, "volume": 1000},
            {"date": "2024-01-03", "open": 103, "high": 106, "low": 101, "close": 104, "volume": 1200},
        ]
        count = cache_prices("AAPL", "daily", bars, db_path=db_path)
        assert count == 2

        cached = get_cached_prices("AAPL", "daily", db_path=db_path)
        assert len(cached) == 2
        assert cached[0]["close"] == 103
        assert cached[1]["close"] == 104

    def test_cache_upsert(self, db_path):
        bars = [{"date": "2024-01-02", "open": 100, "high": 105, "low": 98, "close": 103}]
        cache_prices("AAPL", "daily", bars, db_path=db_path)
        # Update with new close
        bars[0]["close"] = 107
        cache_prices("AAPL", "daily", bars, db_path=db_path)
        cached = get_cached_prices("AAPL", "daily", db_path=db_path)
        assert len(cached) == 1
        assert cached[0]["close"] == 107
