# DeMark Indicators Daily Monitor

Track TD Sequential, TD Combo, and composite DeMark patterns across a managed watchlist of securities. Get daily alerts when signals complete, approach completion, or when key TDST levels are breached.

## Features (Phase 1 — MVP)

- **TD Sequential Engine** — Setup (9-count) and Countdown (13-count) calculation
- **TDST Levels** — Support/resistance levels derived from Setup initiation bars
- **Setup Perfection** — Detection of perfected Buy/Sell Setups
- **SQLite Storage** — Persistent watchlist, signal states, and alert history
- **CLI Interface** — Manage watchlist, run scans, view results from the terminal
- **Web Dashboard** — Simple daily check-in page showing all active signals

## Quick Start

```bash
# Install
pip install -e ".[dev]"

# Add tickers to your watchlist
demark add SPY QQQ AAPL MSFT --tag index

# Run a scan
demark scan

# Launch the web dashboard
demark dashboard

# Run tests
pytest
```

## CLI Commands

```bash
demark add AAPL MSFT GOOGL --tag tech    # Add tickers
demark remove TSLA                        # Remove a ticker
demark list                               # List all watched tickers
demark list --tag tech                    # Filter by tag
demark scan                               # Run DeMark scan on all tickers
demark scan --ticker AAPL                 # Scan a single ticker
demark dashboard                          # Launch web dashboard
demark export watchlist.json              # Export watchlist
demark import watchlist.json              # Import watchlist
```

## Configuration

Edit `config.yaml` to adjust settings:

- Data source provider and API keys
- Database path
- Default watchlist tickers
- Active timeframes
- Alert thresholds
- Dashboard host/port
- Schedule time and timezone

## Project Structure

```
demark-monitor/
├── config.yaml              # Configuration
├── pyproject.toml           # Dependencies and project metadata
├── demark/
│   ├── engine/              # Core DeMark calculation logic
│   │   ├── sequential.py    # TD Sequential (Setup + Countdown)
│   │   └── tdst.py          # TDST level calculation
│   ├── data/                # Data fetching and caching
│   │   └── provider.py      # yfinance data provider
│   ├── storage/             # SQLite models and queries
│   │   └── db.py
│   ├── alerts/              # Alert generation
│   │   └── alerts.py
│   ├── dashboard/           # Web UI (Flask)
│   │   ├── app.py
│   │   └── templates/
│   └── cli.py               # CLI entry point
└── tests/
    ├── test_sequential.py   # Unit tests for TD Sequential
    └── test_storage.py      # Storage layer tests
```

## DeMark Indicator Rules

### TD Sequential Setup (9-count)
- **Buy Setup**: 9 consecutive closes < close 4 bars earlier
- **Sell Setup**: 9 consecutive closes > close 4 bars earlier
- Perfection: bar 8 or 9 low/high exceeds bars 6 and 7

### TD Sequential Countdown (13-count)
- **Buy Countdown**: Close <= low 2 bars earlier (non-consecutive, counts to 13)
- **Sell Countdown**: Close >= high 2 bars earlier (non-consecutive, counts to 13)
- Qualification: bar 13 close vs bar 8 close comparison

### TDST Levels
- Support: true high of the bar before Buy Setup bar 1
- Resistance: true low of the bar before Sell Setup bar 1

## License

MIT
