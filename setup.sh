#!/usr/bin/env bash
#
# DeMark Monitor — Mac/Linux setup script
# Usage: bash setup.sh
#

set -e

VENV_DIR=".venv"

echo ""
echo "=== DeMark Monitor Setup ==="
echo ""

# Check Python version
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is not installed."
    echo "Install it with:  brew install python"
    exit 1
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)')
PY_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)')

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
    echo "Error: Python 3.10+ is required (found $PY_VERSION)."
    echo "Install it with:  brew install python"
    exit 1
fi

echo "  Python $PY_VERSION found."

# Create virtual environment
if [ -d "$VENV_DIR" ]; then
    echo "  Virtual environment already exists at $VENV_DIR"
else
    echo "  Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate it
source "$VENV_DIR/bin/activate"
echo "  Virtual environment activated."

# Upgrade pip
pip install --upgrade pip --quiet

# Install the package in editable mode
echo "  Installing demark-monitor and dependencies..."
pip install -e . --quiet

echo ""
echo "=== Setup complete ==="
echo ""
echo "To get started:"
echo ""
echo "  1. Activate the environment:  source $VENV_DIR/bin/activate"
echo "  2. Initialize the watchlist:  demark init"
echo "  3. Run a scan:                demark scan"
echo "  4. Launch the dashboard:      demark dashboard"
echo ""
echo "Or run directly with:  python -m demark <command>"
echo ""
