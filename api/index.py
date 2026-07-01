import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import and export the Flask app at module level
from app import app

# Ensure app is available for Vercel
__all__ = ["app"]
