"""SQLite storage layer for watchlist, signal states, and alert history."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator


DEFAULT_DB_PATH = "./demark_monitor.db"


def get_db_path(config: dict | None = None) -> str:
    if config and "database" in config:
        return config["database"].get("path", DEFAULT_DB_PATH)
    return DEFAULT_DB_PATH


@contextmanager
def get_connection(db_path: str | None = None) -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections."""
    path = db_path or DEFAULT_DB_PATH
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | None = None) -> None:
    """Create all tables if they don't exist."""
    with get_connection(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS watchlist (
                ticker TEXT PRIMARY KEY,
                tags TEXT DEFAULT '[]',
                added_at TEXT NOT NULL,
                is_active INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS price_cache (
                ticker TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                date TEXT NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL DEFAULT 0,
                PRIMARY KEY (ticker, timeframe, date)
            );

            CREATE TABLE IF NOT EXISTS signal_states (
                ticker TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                indicator_type TEXT NOT NULL DEFAULT 'sequential',
                direction TEXT,
                phase TEXT DEFAULT 'none',
                current_count INTEGER DEFAULT 0,
                count_started_date TEXT,
                setup_completed_date TEXT,
                tdst_level REAL,
                is_perfected INTEGER DEFAULT 0,
                countdown_bar_8_close REAL,
                composite_pattern TEXT,
                state_json TEXT,
                last_updated TEXT NOT NULL,
                PRIMARY KEY (ticker, timeframe, indicator_type)
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                priority TEXT NOT NULL,
                message TEXT NOT NULL,
                triggered_at TEXT NOT NULL,
                acknowledged INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_ticker ON alerts(ticker);
            CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered_at);
            CREATE INDEX IF NOT EXISTS idx_price_cache_ticker_tf ON price_cache(ticker, timeframe);
        """)


# --- Watchlist operations ---

def add_ticker(ticker: str, tags: list[str] | None = None, db_path: str | None = None) -> bool:
    """Add a ticker to the watchlist. Returns True if newly added."""
    tags = tags or []
    with get_connection(db_path) as conn:
        existing = conn.execute(
            "SELECT ticker, is_active, tags FROM watchlist WHERE ticker = ?", (ticker.upper(),)
        ).fetchone()
        if existing:
            if not existing["is_active"]:
                conn.execute(
                    "UPDATE watchlist SET is_active = 1, tags = ? WHERE ticker = ?",
                    (json.dumps(tags), ticker.upper()),
                )
                return True
            # Already active — merge tags
            current_tags = json.loads(existing["tags"]) if existing["tags"] else []
            merged = list(set(current_tags + tags))
            conn.execute(
                "UPDATE watchlist SET tags = ? WHERE ticker = ?",
                (json.dumps(merged), ticker.upper()),
            )
            return False
        conn.execute(
            "INSERT INTO watchlist (ticker, tags, added_at) VALUES (?, ?, ?)",
            (ticker.upper(), json.dumps(tags), datetime.utcnow().isoformat()),
        )
        return True


def remove_ticker(ticker: str, db_path: str | None = None) -> bool:
    """Soft-delete a ticker. Returns True if it was active."""
    with get_connection(db_path) as conn:
        result = conn.execute(
            "UPDATE watchlist SET is_active = 0 WHERE ticker = ? AND is_active = 1",
            (ticker.upper(),),
        )
        return result.rowcount > 0


def list_tickers(tag: str | None = None, db_path: str | None = None) -> list[dict]:
    """List all active tickers, optionally filtered by tag."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT ticker, tags, added_at FROM watchlist WHERE is_active = 1 ORDER BY ticker"
        ).fetchall()

    result = []
    for row in rows:
        tags = json.loads(row["tags"]) if row["tags"] else []
        if tag and tag.lower() not in [t.lower() for t in tags]:
            continue
        result.append({
            "ticker": row["ticker"],
            "tags": tags,
            "added_at": row["added_at"],
        })
    return result


def export_watchlist(db_path: str | None = None) -> list[dict]:
    """Export the full active watchlist."""
    return list_tickers(db_path=db_path)


def import_watchlist(items: list[dict], db_path: str | None = None) -> int:
    """Import tickers from a list of dicts. Returns count of newly added."""
    count = 0
    for item in items:
        ticker = item.get("ticker", "")
        tags = item.get("tags", [])
        if ticker and add_ticker(ticker, tags, db_path):
            count += 1
    return count


# --- Signal state operations ---

def save_signal_state(
    ticker: str,
    timeframe: str,
    indicator_type: str,
    direction: str | None,
    phase: str,
    current_count: int,
    tdst_level: float | None = None,
    is_perfected: bool = False,
    countdown_bar_8_close: float | None = None,
    count_started_date: str | None = None,
    setup_completed_date: str | None = None,
    state_json: str | None = None,
    db_path: str | None = None,
) -> None:
    """Upsert a signal state record."""
    with get_connection(db_path) as conn:
        conn.execute(
            """INSERT INTO signal_states
               (ticker, timeframe, indicator_type, direction, phase,
                current_count, count_started_date, setup_completed_date,
                tdst_level, is_perfected, countdown_bar_8_close, state_json,
                last_updated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker, timeframe, indicator_type) DO UPDATE SET
                 direction = excluded.direction,
                 phase = excluded.phase,
                 current_count = excluded.current_count,
                 count_started_date = excluded.count_started_date,
                 setup_completed_date = excluded.setup_completed_date,
                 tdst_level = excluded.tdst_level,
                 is_perfected = excluded.is_perfected,
                 countdown_bar_8_close = excluded.countdown_bar_8_close,
                 state_json = excluded.state_json,
                 last_updated = excluded.last_updated
            """,
            (
                ticker.upper(),
                timeframe,
                indicator_type,
                direction,
                phase,
                current_count,
                count_started_date,
                setup_completed_date,
                tdst_level,
                1 if is_perfected else 0,
                countdown_bar_8_close,
                state_json,
                datetime.utcnow().isoformat(),
            ),
        )


def get_signal_state(
    ticker: str, timeframe: str, indicator_type: str = "sequential", db_path: str | None = None
) -> dict | None:
    """Retrieve the current signal state for a ticker/timeframe."""
    with get_connection(db_path) as conn:
        row = conn.execute(
            """SELECT * FROM signal_states
               WHERE ticker = ? AND timeframe = ? AND indicator_type = ?""",
            (ticker.upper(), timeframe, indicator_type),
        ).fetchone()
        if row:
            return dict(row)
    return None


def get_all_signal_states(db_path: str | None = None) -> list[dict]:
    """Retrieve all signal states."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM signal_states ORDER BY ticker, timeframe"
        ).fetchall()
        return [dict(r) for r in rows]


# --- Alert operations ---

def save_alert(
    ticker: str,
    timeframe: str,
    alert_type: str,
    priority: str,
    message: str,
    db_path: str | None = None,
) -> int:
    """Save an alert and return its ID."""
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """INSERT INTO alerts (ticker, timeframe, alert_type, priority, message, triggered_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ticker.upper(), timeframe, alert_type, priority, message, datetime.utcnow().isoformat()),
        )
        return cursor.lastrowid


def get_recent_alerts(limit: int = 50, db_path: str | None = None) -> list[dict]:
    """Get recent alerts, most recent first."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM alerts ORDER BY triggered_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_alerts_for_ticker(ticker: str, limit: int = 20, db_path: str | None = None) -> list[dict]:
    """Get alerts for a specific ticker."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM alerts WHERE ticker = ? ORDER BY triggered_at DESC LIMIT ?",
            (ticker.upper(), limit),
        ).fetchall()
        return [dict(r) for r in rows]


# --- Price cache operations ---

def cache_prices(
    ticker: str,
    timeframe: str,
    bars: list[dict],
    db_path: str | None = None,
) -> int:
    """Cache OHLCV price data. Returns number of rows inserted."""
    count = 0
    with get_connection(db_path) as conn:
        for bar in bars:
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO price_cache
                       (ticker, timeframe, date, open, high, low, close, volume)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        ticker.upper(),
                        timeframe,
                        bar["date"],
                        bar["open"],
                        bar["high"],
                        bar["low"],
                        bar["close"],
                        bar.get("volume", 0),
                    ),
                )
                count += 1
            except Exception:
                continue
    return count


def get_cached_prices(
    ticker: str, timeframe: str, db_path: str | None = None
) -> list[dict]:
    """Retrieve cached prices for a ticker/timeframe, ordered by date."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """SELECT date, open, high, low, close, volume
               FROM price_cache
               WHERE ticker = ? AND timeframe = ?
               ORDER BY date""",
            (ticker.upper(), timeframe),
        ).fetchall()
        return [dict(r) for r in rows]
