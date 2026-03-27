#!/usr/bin/env python3
"""
Preview script for digest.html — renders the Askama template with dummy data
using Jinja2 (which has nearly identical syntax) and opens it in a browser.
"""

import re
import sys
import tempfile
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

try:
    from jinja2 import Environment
except ImportError:
    print("jinja2 not found. Install it with: pip3 install jinja2")
    sys.exit(1)

TEMPLATE_PATH = Path(__file__).parent / "templates" / "digest.html"

# ---------------------------------------------------------------------------
# Dummy data
# ---------------------------------------------------------------------------


class NotifPreview:
    def __init__(self, title: str, body: str, created_at: datetime):
        self.title = title
        self.body = body
        self._created_at = created_at

    # Askama calls notif.created_at.format(…); in the converted template we
    # expose a pre-formatted string instead (see the regex below).
    @property
    def created_at_formatted(self) -> str:
        return self._created_at.strftime("%Y-%m-%d")


DUMMY_NOTIFS = [
    NotifPreview(
        title="Alice commented on your document",
        body="Looks great — just left a few notes on the introduction section. Hey @you, can you take a look. Q2 financial projections. Looks great — just left a few notes on the introduction section. Hey @you, can you take a look. Q2 financial projections.",
        created_at=datetime(2025, 6, 10, tzinfo=timezone.utc),
    ),
    NotifPreview(
        title="Bob shared a file with you",
        body="Q2 financial projections (v3).xlsx has been shared with your team. Q2 financial projections (v3).xlsx has been shared with your team.",
        created_at=datetime(2025, 6, 9, tzinfo=timezone.utc),
    ),
    NotifPreview(
        title="Carol mentioned you in a comment",
        body="Hey @you, can you take a look at the design spec before Friday?",
        created_at=datetime(2025, 6, 8, tzinfo=timezone.utc),
    ),
]

# ---------------------------------------------------------------------------
# Askama → Jinja2 syntax conversion
# ---------------------------------------------------------------------------


def askama_to_jinja2(src: str) -> str:
    """Apply lightweight regex transforms to make the Askama template
    renderable by Jinja2."""

    # notifs.len()  →  notifs|length
    src = re.sub(r"\bnotifs\.len\(\)", "notifs|length", src)

    # notif.created_at.format("…")  →  notif.created_at_formatted
    # (we pre-format the date in Python instead)
    src = re.sub(
        r'notif\.created_at\.format\("[^"]*"\)',
        "notif.created_at_formatted",
        src,
    )

    # Askama uses `!expr` for logical negation; Jinja2 uses `not expr`
    # Only touch it inside block tags ({% … %})
    def replace_bang(m: re.Match) -> str:
        return m.group(0).replace("!", "not ")

    src = re.sub(r"\{%-?\s*if\s+![^%]+%\}", replace_bang, src)

    return src


# ---------------------------------------------------------------------------
# Render & open
# ---------------------------------------------------------------------------


def main() -> None:
    raw = TEMPLATE_PATH.read_text(encoding="utf-8")
    converted = askama_to_jinja2(raw)

    env = Environment(autoescape=False)
    tmpl = env.from_string(converted)

    html = tmpl.render(notifs=DUMMY_NOTIFS)

    # Write to a temp file that persists until the script exits
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".html",
        prefix="digest_preview_",
        delete=False,
        encoding="utf-8",
    ) as f:
        f.write(html)
        tmp_path = f.name

    print(f"Rendered to: {tmp_path}")
    webbrowser.open(f"file://{tmp_path}")


if __name__ == "__main__":
    main()
