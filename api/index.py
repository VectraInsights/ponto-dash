import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    # Import app
    from app import app as application
    
    # For WSGI server
    app = application
    
except Exception as e:
    print(f"Erro ao importar app: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    raise
