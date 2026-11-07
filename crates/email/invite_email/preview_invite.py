#!/usr/bin/env python3
"""
Preview script for invite.html — renders the Askama template with dummy data
using Jinja2 (which has nearly identical syntax) and opens it in a browser.
"""

import re
import sys
import tempfile
import webbrowser
from pathlib import Path

try:
    from jinja2 import Environment
except ImportError:
    print("jinja2 not found. Install it with: pip3 install jinja2")
    sys.exit(1)

TEMPLATE_PATH = Path(__file__).parent / "templates" / "invite.html"

# ---------------------------------------------------------------------------
# Dummy data
# ---------------------------------------------------------------------------

DUMMY_REFERRAL_URL = "http://localhost:3000/app/signup?referral_code=ABC123DEF"

# ---------------------------------------------------------------------------
# Askama → Jinja2 syntax conversion
# ---------------------------------------------------------------------------


def askama_to_jinja2(src: str) -> str:
    """Apply lightweight regex transforms to make the Askama template
    renderable by Jinja2."""

    # referral_url() is a method call on self in Askama; replace with the
    # dummy URL string directly so Jinja2 can render it as a plain variable.
    src = re.sub(r"\{\{\s*referral_url\(\)\s*\}\}", DUMMY_REFERRAL_URL, src)

    # {% if let Some(var) = expr %} → {% if expr %}{% set var = expr %}
    # Jinja2 doesn't have if-let, but {% set %} inside {% if %} achieves the same.
    src = re.sub(
        r"\{%-?\s*if let Some\((\w+)\)\s*=\s*(\w+)\s*-?%\}",
        r"{% if \2 %}{% set \1 = \2 %}",
        src,
    )

    return src


# ---------------------------------------------------------------------------
# Render & open
# ---------------------------------------------------------------------------


def main() -> None:
    raw = TEMPLATE_PATH.read_text(encoding="utf-8")
    converted = askama_to_jinja2(raw)

    env = Environment(autoescape=False)
    tmpl = env.from_string(converted)

    html = tmpl.render(
        sender_profile_picture_url="https://placehold.co/40x40/888888/ffffff", # set to None to test the email-only fallback path
        sender_name="Peter Chinman",  # set to None to test the email-only fallback path
        sender_email="peter.chinman@gmail.com",
    )

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".html",
        prefix="invite_preview_",
        delete=False,
        encoding="utf-8",
    ) as f:
        f.write(html)
        tmp_path = f.name

    print(f"Rendered to: {tmp_path}")
    webbrowser.open(f"file://{tmp_path}")


if __name__ == "__main__":
    main()
