"""
Reports the git commit this running process was actually started from —
computed once at startup, not per-request, since a new commit only ever
takes effect via a fresh process (systemctl restart). Deliberately reads
this from git directly rather than trusting a value the CI workflow passed
in: an incrementing counter file would need committing back to the repo on
every deploy, which risks the deploy workflow re-triggering itself (it's
watching server/** on push to main), and would drift the moment anyone
`git pull`s on the VM by hand outside of CI. Reading `git rev-list --count`
gives an ever-increasing build number for free, no extra state to maintain
or get out of sync.
"""

import subprocess
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent  # server/ — inside the git working tree


def _git(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=REPO_DIR, capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def read_version_info() -> dict:
    commit = _git("rev-parse", "--short", "HEAD")
    build = _git("rev-list", "--count", "HEAD")
    commit_date = _git("log", "-1", "--format=%cI")
    subject = _git("log", "-1", "--format=%s")
    return {
        "commit": commit or "unknown",
        "build": int(build) if build and build.isdigit() else None,
        "commit_date": commit_date,
        "subject": subject,
    }
