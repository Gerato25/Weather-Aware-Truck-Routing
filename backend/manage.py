#!/usr/bin/env python
import os
import subprocess
import sys
from pathlib import Path


def _venv_python() -> Path:
    root = Path(__file__).resolve().parent.parent
    scripts = "Scripts" if os.name == "nt" else "bin"
    name = "python.exe" if os.name == "nt" else "python"
    return root / ".venv" / scripts / name


def bootstrap() -> None:
    try:
        import django  # noqa: F401
        return
    except ImportError:
        pass

    venv_python = _venv_python()
    if Path(sys.executable).resolve() == venv_python.resolve():
        sys.stderr.write("Django is not installed. Run: pip install -r requirements.txt\n")
        raise SystemExit(1)

    if not venv_python.exists():
        print("Creating virtualenv...")
        subprocess.check_call([sys.executable, "-m", "venv", str(venv_python.parent.parent)])

    probe = subprocess.run([str(venv_python), "-c", "import django"], capture_output=True)
    if probe.returncode != 0:
        print("Installing backend dependencies...")
        req = Path(__file__).resolve().parent / "requirements.txt"
        subprocess.check_call([str(venv_python), "-m", "pip", "install", "-r", str(req)])

    raise SystemExit(subprocess.call([str(venv_python), *sys.argv]))


def main() -> None:
    bootstrap()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
