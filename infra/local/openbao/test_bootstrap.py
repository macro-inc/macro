"""Integration coverage against an explicitly configured, disposable local vault."""

import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4

from bootstrap import OpenBaoRequestError, configure_kv, LocalOpenBao, bootstrap


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=")


class BootstrapIntegration(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("PASSWORDS_TEST_OPENBAO_ADDRESS"), "local OpenBao address required")
    def test_versions_totp_repeat_bootstrap_and_team_isolation(self):
        address = os.environ["PASSWORDS_TEST_OPENBAO_ADDRESS"]
        root = LocalOpenBao(address, os.environ["BAO_TOKEN"])
        first_team, second_team = uuid4(), uuid4()
        first_namespace, second_namespace = f"team-{first_team}", f"team-{second_team}"

        with tempfile.TemporaryDirectory() as directory:
            private_key = Path(directory) / "signing.pem"
            subprocess.run([
                "openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                "-out", str(private_key),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            public_key = subprocess.check_output([
                "openssl", "pkey", "-in", str(private_key), "-pubout",
            ]).decode()
            for team in (first_team, second_team):
                bootstrap(root, team, public_key, "local-integration")
            auditing = root.request("GET", "sys/config/auditing/request-headers/x-macro-audit-id")
            self.assertFalse(auditing["x-macro-audit-id"]["hmac"])

            header = encoded(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
            audit_id = uuid4().hex
            claims = encoded(json.dumps({
                "iss": "local-integration", "sub": "macro-passwords-service", "aud": "macro-passwords",
                "team_id": str(first_team), "iat": int(time.time()), "exp": int(time.time()) + 60,
                "audit_id": audit_id,
            }).encode())
            signing_input = header + b"." + claims
            signature = subprocess.run([
                "openssl", "dgst", "-sha256", "-sign", str(private_key),
            ], input=signing_input, stdout=subprocess.PIPE, check=True).stdout
            jwt = (signing_input + b"." + encoded(signature)).decode()

            login = root.request("POST", "auth/macro/login", {
                "role": "passwords-service", "jwt": jwt,
            }, first_namespace)
            service = LocalOpenBao(address, login["auth"]["client_token"])
            self.assertEqual(login["auth"]["policies"], ["passwords-service"])
            self.assertLessEqual(login["auth"]["lease_duration"], 60)
            self.assertEqual(login["auth"]["metadata"]["audit_id"], audit_id)
            expired_claims = encoded(json.dumps({
                "iss": "local-integration", "sub": "macro-passwords-service", "aud": "macro-passwords",
                "team_id": str(first_team), "iat": int(time.time()) - 61, "exp": int(time.time()) - 1,
                "audit_id": audit_id,
            }).encode())
            expired_input = header + b"." + expired_claims
            expired_signature = subprocess.run([
                "openssl", "dgst", "-sha256", "-sign", str(private_key),
            ], input=expired_input, stdout=subprocess.PIPE, check=True).stdout
            expired_jwt = (expired_input + b"." + encoded(expired_signature)).decode()
            with self.assertRaisesRegex(RuntimeError, "HTTP (400|403)"):
                root.request("POST", "auth/macro/login", {
                    "role": "passwords-service", "jwt": expired_jwt,
                }, first_namespace)
            service.request("POST", "passwords/data/item", {
                "options": {"cas": 0}, "data": {"password": "synthetic-version-one"},
            }, first_namespace)
            with self.assertRaisesRegex(RuntimeError, "HTTP 400"):
                service.request("POST", "passwords/data/item", {
                    "options": {"cas": 0}, "data": {"password": "stale-write"},
                }, first_namespace)
            service.request("POST", "passwords/data/item", {
                "options": {"cas": 1}, "data": {"password": "synthetic-version-two"},
            }, first_namespace)
            history = service.request("GET", "passwords/data/item?version=1", namespace=first_namespace)
            self.assertEqual(history["data"]["data"]["password"], "synthetic-version-one")
            bootstrap(root, first_team, public_key, "local-integration")
            current = service.request("GET", "passwords/data/item", namespace=first_namespace)
            self.assertEqual(current["data"]["metadata"]["version"], 2)
            service.request("POST", "totp/keys/item", {
                "key": "JBSWY3DPEHPK3PXP", "issuer": "Local", "account_name": "Synthetic",
            }, first_namespace)
            code = service.request("GET", "totp/code/item", namespace=first_namespace)["data"]["code"]
            self.assertRegex(code, r"^\d{6}$")
            service.request("DELETE", "totp/keys/item", namespace=first_namespace)

            with self.assertRaisesRegex(RuntimeError, "HTTP (400|403)"):
                root.request("POST", "auth/macro/login", {
                    "role": "passwords-service", "jwt": jwt,
                }, second_namespace)
            with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                service.request("GET", "passwords/data/item", namespace=second_namespace)
            with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                service.request("GET", "sys/mounts", namespace=first_namespace)

            lifecycle_claims = encoded(json.dumps({
                "iss": "local-integration", "sub": "macro-passwords-lifecycle",
                "aud": "macro-passwords-lifecycle", "team_id": str(first_team),
                "iat": int(time.time()), "exp": int(time.time()) + 60, "audit_id": audit_id,
            }).encode())
            lifecycle_input = header + b"." + lifecycle_claims
            lifecycle_signature = subprocess.run([
                "openssl", "dgst", "-sha256", "-sign", str(private_key),
            ], input=lifecycle_input, stdout=subprocess.PIPE, check=True).stdout
            lifecycle_jwt = (lifecycle_input + b"." + encoded(lifecycle_signature)).decode()
            lifecycle_login = root.request("POST", "auth/macro-lifecycle/login", {
                "role": first_namespace, "jwt": lifecycle_jwt,
            })
            lifecycle = LocalOpenBao(address, lifecycle_login["auth"]["client_token"])
            with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                lifecycle.request("DELETE", f"sys/namespaces/{second_namespace}")
            with self.assertRaisesRegex(RuntimeError, "HTTP (400|403)"):
                root.request("POST", "auth/macro-lifecycle/login", {
                    "role": second_namespace, "jwt": lifecycle_jwt,
                })
            lifecycle.request("DELETE", f"sys/namespaces/{first_namespace}")
            pending = lifecycle.request("GET", f"sys/namespaces/{first_namespace}", missing=True)
            if pending is not None:
                self.assertTrue(pending["data"]["tainted"], "DELETE must begin namespace erasure")
            self.assertIsNotNone(root.request("GET", f"sys/namespaces/{second_namespace}"))
            root.request("DELETE", f"auth/macro-lifecycle/role/{first_namespace}")
            with self.assertRaisesRegex(RuntimeError, "HTTP (400|403)"):
                root.request("POST", "auth/macro-lifecycle/login", {
                    "role": first_namespace, "jwt": lifecycle_jwt,
                })

    @unittest.skipUnless(
        os.environ.get("PASSWORDS_TEST_OPENBAO_ADDRESS") and os.environ.get("PASSWORDS_TEST_OPENBAO_CONTAINER"),
        "local OpenBao address and container required for audit-log inspection",
    )
    def test_audit_correlation_and_redaction_in_provider_logs(self):
        audit_id = uuid4().hex
        client = LocalOpenBao(
            os.environ["PASSWORDS_TEST_OPENBAO_ADDRESS"], os.environ["BAO_TOKEN"], audit_id,
        )
        client.request("POST", "sys/config/auditing/request-headers/x-macro-audit-id", {"hmac": False})
        mount = "audit-check-" + uuid4().hex
        client.request("POST", "sys/mounts/" + mount, {"type": "kv", "options": {"version": "2"}})
        try:
            client.request("POST", mount + "/data/item", {
                "data": {"password": "synthetic-audit-password", "totp_seed": "JBSWY3DPEHPK3PXP"},
            })
        finally:
            client.request("DELETE", "sys/mounts/" + mount)
        logs = subprocess.run(
            ["docker", "logs", os.environ["PASSWORDS_TEST_OPENBAO_CONTAINER"]],
            capture_output=True, check=True,
        )
        output = logs.stdout + logs.stderr
        self.assertIn(audit_id.encode(), output)
        self.assertIn(b"hmac-sha256:", output)
        self.assertNotIn(b"synthetic-audit-password", output)
        self.assertNotIn(b"JBSWY3DPEHPK3PXP", output)


class LocalOriginGuard(unittest.TestCase):
    def test_bootstrap_rejects_remote_origins_before_network_access(self):
        for address in ("https://example.org", "http://127.0.0.1.example.org", "http://user@localhost", "http://localhost/x"):
            with self.assertRaises(ValueError):
                LocalOpenBao(address, "synthetic")


if __name__ == "__main__":
    unittest.main()


class MountReadiness(unittest.TestCase):
    def test_new_backend_config_retries_temporary_failure_only(self):
        class PendingMount:
            calls = 0
            def request(self, method, path, data, namespace):
                self.calls += 1
                if self.calls == 1:
                    raise OpenBaoRequestError(method, path, 400)
        pending = PendingMount()
        from unittest.mock import patch
        with patch("bootstrap.time.sleep"):
            configure_kv(pending, "synthetic", True)
        self.assertEqual(pending.calls, 2)
        existing = PendingMount()
        with self.assertRaises(OpenBaoRequestError):
            configure_kv(existing, "synthetic", False)
        self.assertEqual(existing.calls, 1)
