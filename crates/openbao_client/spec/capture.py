#!/usr/bin/env python3
"""Capture verbatim mounted specs from an explicitly provisioned disposable Bao.

No app credentials are read; the local bootstrap token file must be mode 0600.
Usage: capture.py --address http://127.0.0.1:18272 --init-file /outside/repo/bootstrap.json
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

TEAM = "team-00000000-0000-7000-8000-000000000272"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("Capture forbids redirects")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", required=True)
    parser.add_argument("--init-file", required=True, type=Path)
    args = parser.parse_args()
    url = urlsplit(args.address)
    if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1") or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Capture accepts only an explicit loopback HTTP origin")
    if args.init_file.stat().st_mode & 0o077:
        raise ValueError("Bootstrap file must be restricted to its owner")
    token = json.loads(args.init_file.read_bytes())["root_token"]
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(path, namespace=None):
        headers = {"X-Vault-Token": token}
        if namespace:
            headers["X-Vault-Namespace"] = namespace
        with opener.open(Request(args.address.rstrip("/") + "/v1/" + path, headers=headers), timeout=30) as response:
            return response.read()

    if json.loads(get("sys/health"))["version"] != "2.7.2":
        raise ValueError("Capture requires exactly OpenBao 2.7.2")
    mounts = json.loads(get("sys/mounts", TEAM))["data"]
    if mounts["passwords/"]["type"] != "kv" or mounts["passwords/"]["options"]["version"] != "2" or mounts["totp/"]["type"] != "totp":
        raise ValueError("Required team mounts are missing")
    if json.loads(get("sys/auth", TEAM))["data"]["macro/"]["type"] != "jwt" or json.loads(get("sys/auth"))["data"]["macro-lifecycle/"]["type"] != "jwt":
        raise ValueError("Required JWT mounts are missing")
    directory = Path(__file__).resolve().parent
    for source, namespace in (("root", None), ("team", TEAM)):
        data = get("sys/internal/specs/openapi", namespace)
        json.loads(data)  # Reject an invalid response; preserve original bytes.
        target = directory / f"openbao-2.7.2-{source}.json"
        target.write_bytes(data)
        print(f"{target.name}: sha256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
