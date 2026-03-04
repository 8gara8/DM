"""Configuration loading for the DeMark Monitor."""

from __future__ import annotations

from pathlib import Path

import yaml


DEFAULT_CONFIG = {
    "data_source": {"provider": "yfinance", "api_key": None},
    "database": {"path": "./demark_monitor.db"},
    "watchlist": {"default_tickers": ["SPY", "QQQ", "BTC-USD", "GLD"]},
    "timeframes": ["daily", "weekly", "monthly", "yearly"],
    "alerts": {
        "approaching_setup_threshold": 7,
        "approaching_countdown_threshold": 11,
        "dashboard": {"enabled": True, "host": "0.0.0.0", "port": 8050},
        "console": {"enabled": True},
    },
    "schedule": {"run_time": "06:00", "timezone": "Asia/Taipei"},
}


def load_config(config_path: str | None = None) -> dict:
    """Load config from a YAML file, falling back to defaults.

    Search order:
      1. Explicit path (if provided)
      2. ./config.yaml
      3. Package-relative config.yaml
      4. Built-in defaults
    """
    candidates = []
    if config_path:
        candidates.append(Path(config_path))
    candidates.extend([
        Path("config.yaml"),
        Path(__file__).parent.parent / "config.yaml",
    ])

    for path in candidates:
        if path.exists():
            with open(path) as f:
                user_cfg = yaml.safe_load(f) or {}
            # Merge with defaults (user values win)
            merged = {**DEFAULT_CONFIG, **user_cfg}
            # Deep-merge alerts section
            if "alerts" in user_cfg:
                merged["alerts"] = {**DEFAULT_CONFIG["alerts"], **user_cfg["alerts"]}
            return merged

    return dict(DEFAULT_CONFIG)


def get_db_path(config: dict | None = None) -> str:
    """Extract database path from config."""
    config = config or load_config()
    return config.get("database", {}).get("path", "./demark_monitor.db")
