#!/usr/bin/env python3
"""Provision one local Passwords team without deleting or replacing secret data."""

import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "openbao"))
from openbao_provisioning import NoRedirect, OpenBaoClient, provision_team  # noqa: E402


class LocalOpenBao(OpenBaoClient):
    def __init__(self, address, token, audit_id=None):
        parsed = urlsplit(address)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in ("127.0.0.1", "localhost", "::1", "openbao")
            or parsed.username
            or parsed.password
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("bootstrap accepts only an explicit local OpenBao HTTP origin")
        super().__init__(address, token, build_opener(ProxyHandler({}), NoRedirect()), audit_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", required=True)
    parser.add_argument("--init-file", type=Path, help="local bootstrap.json copied from the instance volume")
    parser.add_argument("--team-id", required=True, type=UUID)
    parser.add_argument("--jwt-public-key", required=True, type=Path)
    parser.add_argument("--jwt-issuer", required=True)
    arguments = parser.parse_args()
    token = os.environ.get("BAO_TOKEN")
    if arguments.init_file:
        if token:
            parser.error("use --init-file or BAO_TOKEN, not both")
        token = json.loads(arguments.init_file.read_text())["root_token"]
    if not token:
        parser.error("--init-file or BAO_TOKEN is required (local bootstrap identity only)")
    namespace = provision_team(
        LocalOpenBao(arguments.address, token),
        arguments.team_id,
        arguments.jwt_public_key.read_text(),
        arguments.jwt_issuer,
    )
    print(f"Provisioned local Passwords namespace {namespace}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
