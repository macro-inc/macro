#!/usr/bin/env python3
"""Provision one local Passwords team without deleting or replacing secret data."""

import argparse
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID


class OpenBaoRequestError(RuntimeError):
    """Sanitized provider failure, with status available for readiness checks."""
    def __init__(self, method, path, status):
        self.status = status
        super().__init__(f"OpenBao {method} {path}: HTTP {status}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("OpenBao redirects are forbidden")


class LocalOpenBao:
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
        self.address = address.rstrip("/")
        self.token = token
        self.audit_id = audit_id
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method, path, data=None, namespace=None, missing=False):
        headers = {"X-Vault-Token": self.token, "Content-Type": "application/json"}
        if self.audit_id:
            headers["x-macro-audit-id"] = self.audit_id
        if namespace:
            headers["X-Vault-Namespace"] = namespace
        body = None if data is None else json.dumps(data).encode()
        request = Request(f"{self.address}/v1/{path}", body, headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                content = response.read(1024 * 1024)
                return json.loads(content) if content else {}
        except HTTPError as error:
            error.close()
            if missing and error.code == 404:
                return None
            # Never print request/response bodies, tokens, JWTs, or secret values.
            raise OpenBaoRequestError(method, path, error.code) from None


def configure_kv(client, namespace, newly_mounted):
    # The KV v2 plugin may still be initializing after sys/mounts acknowledges it.
    # Retry only a newly mounted backend's temporary 400, never an existing config.
    for attempt in range(8):
        try:
            client.request("POST", "passwords/config", {"max_versions": 100, "cas_required": True}, namespace)
            return
        except OpenBaoRequestError as error:
            if not newly_mounted or error.status != 400 or attempt == 7:
                raise
            time.sleep(min(0.05 * 2 ** attempt, 0.5))


def bootstrap(client, team_id, public_key, issuer):
    namespace = f"team-{team_id}"
    audits = client.request("GET", "sys/audit")["data"]
    if "passwords/" not in audits:
        raise ValueError("local OpenBao must start with the passwords audit device from local.hcl")
    if audits["passwords/"]["options"].get("log_raw") != "false":
        raise ValueError("Password audit device must redact sensitive values")
    client.request("POST", "sys/config/auditing/request-headers/x-macro-audit-id", {"hmac": False})
    if client.request("GET", f"sys/namespaces/{namespace}", missing=True) is None:
        client.request("POST", f"sys/namespaces/{namespace}", {})

    mounts = client.request("GET", "sys/mounts", namespace=namespace)["data"]
    for path, kind, options in (
        ("passwords", "kv", {"version": "2"}),
        ("totp", "totp", {}),
    ):
        existing = mounts.get(path + "/")
        if existing:
            if existing["type"] != kind or (kind == "kv" and existing["options"].get("version") != "2"):
                raise ValueError(f"incompatible existing mount: {namespace}/{path}")
        else:
            client.request("POST", f"sys/mounts/{path}", {"type": kind, "options": options}, namespace)

    configure_kv(client, namespace, "passwords/" not in mounts)
    authentication = client.request("GET", "sys/auth", namespace=namespace)["data"]
    existing = authentication.get("macro/")
    if existing and existing["type"] != "jwt":
        raise ValueError(f"incompatible existing auth mount: {namespace}/macro")
    if not existing:
        client.request("POST", "sys/auth/macro", {"type": "jwt"}, namespace)
    client.request("POST", "auth/macro/config", {
        "jwt_validation_pubkeys": [public_key],
        "bound_issuer": issuer,
        "jwt_supported_algs": ["RS256"],
    }, namespace)
    policy = '\n'.join((
        'path "passwords/data/*" { capabilities = ["create", "read", "update", "delete"] }',
        'path "passwords/metadata/*" { capabilities = ["read", "list", "delete"] }',
        'path "passwords/undelete/*" { capabilities = ["update"] }',
        'path "passwords/destroy/*" { capabilities = ["update"] }',
        'path "totp/keys/*" { capabilities = ["create", "read", "update", "delete"] }',
        'path "totp/code/*" { capabilities = ["read"] }',
    ))
    client.request("PUT", "sys/policies/acl/passwords-service", {"policy": policy}, namespace)
    client.request("POST", "auth/macro/role/passwords-service", {
        "role_type": "jwt",
        "user_claim": "sub",
        "bound_subject": "macro-passwords-service",
        "bound_audiences": ["macro-passwords"],
        "bound_claims": {"team_id": str(team_id)},
        "claim_mappings": {"audit_id": "audit_id"},
        "clock_skew_leeway": -1,
        "expiration_leeway": -1,
        "not_before_leeway": -1,
        "token_policies": ["passwords-service"],
        "token_no_default_policy": True,
        "token_ttl": "60s",
        "token_max_ttl": "60s",
        "token_explicit_max_ttl": "60s",
    }, namespace)
    # Parent-scoped lifecycle JWTs may delete exactly one bound team namespace.
    root_auth = client.request("GET", "sys/auth")["data"]
    lifecycle_mount = root_auth.get("macro-lifecycle/")
    if lifecycle_mount and lifecycle_mount["type"] != "jwt":
        raise ValueError("incompatible local lifecycle authentication mount")
    if not lifecycle_mount:
        client.request("POST", "sys/auth/macro-lifecycle", {"type": "jwt"})
    client.request("POST", "auth/macro-lifecycle/config", {
        "jwt_validation_pubkeys": [public_key],
        "bound_issuer": issuer,
        "jwt_supported_algs": ["RS256"],
    })
    lifecycle_policy = f"passwords-lifecycle-{team_id}"
    client.request("PUT", f"sys/policies/acl/{lifecycle_policy}", {
        "policy": f'path "sys/namespaces/{namespace}" {{ capabilities = ["read", "delete"] }}',
    })
    client.request("POST", f"auth/macro-lifecycle/role/{namespace}", {
        "role_type": "jwt",
        "user_claim": "sub",
        "bound_subject": "macro-passwords-lifecycle",
        "bound_audiences": ["macro-passwords-lifecycle"],
        "bound_claims": {"team_id": str(team_id)},
        "claim_mappings": {"audit_id": "audit_id"},
        "clock_skew_leeway": -1,
        "expiration_leeway": -1,
        "not_before_leeway": -1,
        "token_policies": [lifecycle_policy],
        "token_no_default_policy": True,
        "token_ttl": "60s", "token_max_ttl": "60s", "token_explicit_max_ttl": "60s",
    })
    print(f"Provisioned local Passwords namespace {namespace}")


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
    bootstrap(
        LocalOpenBao(arguments.address, token),
        arguments.team_id,
        arguments.jwt_public_key.read_text(),
        arguments.jwt_issuer,
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
