"""Scoped provisioner against a disposable OpenBao 2.7.2 (see README "Provisioner fixture tests").

Skipped unless OPENBAO_FIXTURE_ADDRESS (loopback http) and OPENBAO_FIXTURE_ROOT_TOKEN
are set. Every team uses a fresh UUID, so runs never collide; the fixture is
in-memory and is thrown away afterwards.
"""

import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4

from openbao_provisioning import (
    DeadlineExceeded, Incompatible, NoRedirect, OpenBaoClient, OpenBaoRequestError,
    PROVISIONER_MOUNT, PROVISIONER_ROLE, PROVISIONER_SUBJECT,
    bootstrap_root, inspect_team, lifecycle_role, provision_team, service_role,
)

ADDRESS = os.environ.get("OPENBAO_FIXTURE_ADDRESS")
ROOT_TOKEN = os.environ.get("OPENBAO_FIXTURE_ROOT_TOKEN")
ISSUER = "fixture-passwords"
PROVISIONER_ISSUER = "fixture-provisioner"
ALGORITHMS = ["ES256"]


def client(token):
    parsed = urlsplit(ADDRESS)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("fixture tests talk only to a loopback OpenBao")
    return OpenBaoClient(ADDRESS, token, build_opener(ProxyHandler({}), NoRedirect()))


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class Key:
    """A throwaway P-256 key signing ES256 JWTs with openssl."""

    def __init__(self, directory):
        self.path = Path(directory, f"{uuid4()}.pem")
        subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(self.path)],
                       check=True, capture_output=True)
        self.public = subprocess.run(["openssl", "ec", "-in", str(self.path), "-pubout"],
                                     check=True, capture_output=True).stdout.decode()

    def jwt(self, claims):
        now = int(time.time())
        signing_input = encoded(json.dumps({"alg": "ES256", "typ": "JWT"}).encode()) + "." + encoded(
            json.dumps({"iat": now, "nbf": now, "exp": now + 60, **claims}).encode())
        der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(self.path)],
                             input=signing_input.encode(), check=True, capture_output=True).stdout
        # DER SEQUENCE { INTEGER r, INTEGER s } to the JWS r || s form.
        offset, raw = 2 if der[1] < 0x80 else 3, b""
        for _ in range(2):
            length = der[offset + 1]
            raw += der[offset + 2:offset + 2 + length].lstrip(b"\x00").rjust(32, b"\x00")
            offset += 2 + length
        return signing_input + "." + encoded(raw)


@unittest.skipUnless(ADDRESS and ROOT_TOKEN, "disposable OpenBao fixture required")
class ProvisionerFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.service_key = Key(cls.directory.name)
        cls.provisioner_key = Key(cls.directory.name)
        cls.root = client(ROOT_TOKEN)
        bootstrap_root(cls.root, [cls.service_key.public], ISSUER, ALGORITHMS,
                       cls.provisioner_key.public, PROVISIONER_ISSUER)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def provisioner(self):
        """The real path: a JWT login to the provisioner role, as the service will do."""
        login = self.root.request("POST", f"auth/{PROVISIONER_MOUNT}/login", {
            "role": PROVISIONER_ROLE,
            "jwt": self.provisioner_key.jwt({"iss": PROVISIONER_ISSUER, "sub": PROVISIONER_SUBJECT,
                                             "aud": PROVISIONER_SUBJECT}),
        })
        return client(login["auth"]["client_token"]), login["auth"]

    def provision(self, team, **options):
        return provision_team(self.provisioner()[0], team, [self.service_key.public], ISSUER, ALGORITHMS,
                              overwrite=False, **options)

    def inspect(self, team):
        return inspect_team(self.provisioner()[0], team, [self.service_key.public], ISSUER, ALGORITHMS)

    def service(self, team):
        """Log in as the document storage service would, proving the setup works end to end."""
        login = self.root.request("POST", "auth/macro/login", {
            "role": "passwords-service",
            "jwt": self.service_key.jwt({"iss": ISSUER, "sub": "macro-passwords-service",
                                         "aud": "macro-passwords", "team_id": str(team)}),
        }, f"team-{team}")
        self.assertEqual(login["auth"]["policies"], ["passwords-service"])
        return client(login["auth"]["client_token"])

    def snapshot(self, team):
        """Everything the provisioner may write for a team, as OpenBao reports it."""
        ns = f"team-{team}"
        read = lambda path, namespace=ns: (self.root.request("GET", path, namespace=namespace, missing=True) or {}).get("data")
        mounts = {path: (mount["type"], mount["options"]) for path, mount in read("sys/mounts").items()}
        auths = {path: mount["type"] for path, mount in read("sys/auth").items()}
        return {
            "mounts": mounts, "auths": auths, "kv": read("passwords/config"),
            "jwt": read("auth/macro/config"),
            "policy": read("sys/policies/acl/passwords-service"),
            "role": read("auth/macro/role/passwords-service"),
            "lifecycle": read(f"auth/macro-lifecycle/role/{ns}", None),
        }

    def assertDenied(self, method, path, token_client, data=None, namespace=None):
        with self.assertRaises(OpenBaoRequestError) as raised:
            token_client.request(method, path, data, namespace)
        self.assertEqual(raised.exception.status, 403, f"{method} {path}")

    def test_provisioner_logs_in_through_its_jwt_role(self):
        _, auth = self.provisioner()
        self.assertEqual(auth["policies"], ["openbao-provisioner"])
        self.assertLessEqual(auth["lease_duration"], 60)

    def test_unknown_team_inspects_absent(self):
        self.assertEqual(self.inspect(uuid4()), "absent")

    def test_concurrent_first_use_creates_exactly_one_namespace(self):
        team, results, errors = uuid4(), [], []

        def first_use():
            try:
                results.append(self.provision(team))
            except Exception as error:  # noqa: BLE001 - reported below
                errors.append(error)

        threads = [threading.Thread(target=first_use) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 8)
        # OpenBao answers a namespace POST that lands after creation finished with
        # 200 (an update), so several callers may report creating it; there is one.
        self.assertGreaterEqual(sum("namespace" in result.created_pieces for result in results), 1)
        namespaces = self.root.request("LIST", "sys/namespaces")["data"]["keys"]
        self.assertEqual(namespaces.count(f"team-{team}/"), 1)
        self.assertEqual(self.inspect(team), "ready")
        self.service(team)

    def test_partial_setup_resumes(self):
        team = uuid4()
        ns = f"team-{team}"
        # A crash after the namespace and the first mount.
        self.root.request("POST", f"sys/namespaces/{ns}", {})
        self.root.request("POST", "sys/mounts/passwords", {"type": "kv", "options": {"version": "2"}}, ns)
        self.assertEqual(self.inspect(team), "partial")
        result = self.provision(team)
        self.assertNotIn("namespace", result.created_pieces)
        self.assertNotIn("passwords mount", result.created_pieces)
        self.assertIn("totp mount", result.created_pieces)
        self.assertIn("lifecycle role", result.created_pieces)
        self.assertEqual(self.inspect(team), "ready")
        self.service(team)

    def test_same_intent_retry_writes_nothing(self):
        team = uuid4()
        self.assertTrue(self.provision(team).created)
        service = self.service(team)
        service.request("POST", "passwords/data/item", {"options": {"cas": 0}, "data": {"password": "synthetic"}}, f"team-{team}")
        before = self.snapshot(team)
        retry = self.provision(team)
        self.assertFalse(retry.created)
        self.assertEqual(retry.created_pieces, [])
        self.assertEqual(self.snapshot(team), before)  # includes the policy's version and modified time
        current = service.request("GET", "passwords/data/item", namespace=f"team-{team}")["data"]
        self.assertEqual((current["data"]["password"], current["metadata"]["version"]), ("synthetic", 1))

    def test_existing_healthy_namespace_is_left_untouched(self):
        team = uuid4()
        ns = f"team-{team}"
        # Set up by an operator (root, overwrite), with a stored secret and TOTP key.
        provision_team(self.root, team, [self.service_key.public], ISSUER, ALGORITHMS, overwrite=True)
        service = self.service(team)
        service.request("POST", "passwords/data/item", {"options": {"cas": 0}, "data": {"password": "one"}}, ns)
        service.request("POST", "passwords/data/item", {"options": {"cas": 1}, "data": {"password": "two"}}, ns)
        service.request("POST", "totp/keys/item", {"key": "JBSWY3DPEHPK3PXP", "issuer": "Fixture", "account_name": "Synthetic"}, ns)
        before = self.snapshot(team)
        self.assertEqual(self.inspect(team), "ready")
        result = self.provision(team)
        self.assertFalse(result.created)
        self.assertEqual(self.snapshot(team), before)
        current = service.request("GET", "passwords/data/item", namespace=ns)["data"]
        self.assertEqual((current["data"]["password"], current["metadata"]["version"]), ("two", 2))
        self.assertRegex(service.request("GET", "totp/code/item", namespace=ns)["data"]["code"], r"^\d{6}$")

    def test_incompatible_config_is_refused_and_left_unchanged(self):
        other_key = Key(self.directory.name)
        cases = {
            "passwords mount": lambda ns: self.root.request(
                "POST", "sys/mounts/passwords", {"type": "kv", "options": {"version": "1"}}, ns),
            "JWT config": lambda ns: self.root.request(
                "POST", "auth/macro/config", {"jwt_validation_pubkeys": [other_key.public], "bound_issuer": ISSUER,
                                              "jwt_supported_algs": ALGORITHMS}, ns),
            "passwords-service policy": lambda ns: self.root.request(
                "PUT", "sys/policies/acl/passwords-service", {"policy": 'path "*" { capabilities = ["read"] }'}, ns),
            "passwords-service role": lambda ns: self.root.request(
                "POST", "auth/macro/role/passwords-service", {**service_role(ns[5:]), "bound_audiences": ["someone-else"]}, ns),
        }
        for piece, break_it in cases.items():
            with self.subTest(piece=piece):
                team = uuid4()
                ns = f"team-{team}"
                if piece == "passwords mount":
                    # An existing namespace without our mounts, already erasable.
                    self.root.request("POST", f"auth/macro-lifecycle/role/{ns}", lifecycle_role(team))
                    self.root.request("POST", f"sys/namespaces/{ns}", {})
                else:
                    self.provision(team)
                break_it(ns)
                before = self.snapshot(team)
                with self.assertRaises(Incompatible) as raised:
                    self.provision(team)
                self.assertEqual(raised.exception.piece, piece)
                self.assertEqual(self.snapshot(team), before)
                self.assertEqual(self.inspect(team), "incompatible")

    def test_deadline_passed_creates_no_namespace(self):
        team = uuid4()
        with self.assertRaises(DeadlineExceeded):
            self.provision(team, deadline=time.time() - 1)
        self.assertIsNone(self.root.request("GET", f"sys/namespaces/team-{team}", missing=True))
        # The lifecycle role is written before the namespace, so a crash or
        # deadline between them leaves a role and no namespace, never the reverse.
        self.assertIsNotNone(self.root.request("GET", f"auth/macro-lifecycle/role/team-{team}", missing=True))
        self.assertEqual(self.inspect(team), "absent")
        result = self.provision(team)
        self.assertEqual(result.created_pieces[0], "namespace")
        self.assertNotIn("lifecycle role", result.created_pieces)
        self.assertEqual(self.inspect(team), "ready")

    def test_every_created_namespace_has_its_lifecycle_role(self):
        team = uuid4()
        result = self.provision(team)
        self.assertEqual(result.created_pieces[:2], ["lifecycle role", "namespace"])

    def test_least_privilege(self):
        team, other = uuid4(), uuid4()
        for each in (team, other):
            self.provision(each)
        ns = f"team-{team}"
        self.service(team).request("POST", "passwords/data/item", {"options": {"cas": 0}, "data": {"password": "x"}}, ns)
        provisioner, _ = self.provisioner()
        stranger = Key(self.directory.name)
        pinned_config = {"jwt_validation_pubkeys": [self.service_key.public.strip()], "bound_issuer": ISSUER,
                         "jwt_supported_algs": ALGORITHMS}
        role = self.root.request("GET", "auth/macro/role/passwords-service", namespace=ns)["data"]
        for method, path, data, namespace in (
            ("GET", "passwords/data/item", None, ns),
            ("POST", "passwords/data/item", {"options": {"cas": 1}, "data": {"password": "y"}}, ns),
            ("LIST", "totp/keys", None, ns),
            ("POST", "auth/macro/config", {**pinned_config, "jwt_validation_pubkeys": [stranger.public.strip()]}, ns),
            ("POST", "auth/macro/config", {**pinned_config, "bound_issuer": "someone-else"}, ns),
            ("POST", "auth/macro/config", {**pinned_config, "jwt_supported_algs": ["HS256"]}, ns),
            ("PUT", "sys/policies/acl/passwords-service", {"policy": 'path "*" { capabilities = ["sudo", "read"] }'}, ns),
            ("PUT", "sys/policies/acl/other", {"policy": 'path "*" { capabilities = ["read"] }'}, ns),
            ("POST", "auth/macro/role/passwords-service", {"token_policies": ["passwords-service", "default"],
                                                           "role_type": "jwt", "user_claim": "sub"}, ns),
            ("POST", "auth/macro/role/passwords-service", {"token_period": "24h"}, ns),
            ("POST", "auth/macro/role/other", {"role_type": "jwt", "user_claim": "sub"}, ns),
            ("POST", "sys/mounts/other", {"type": "kv"}, ns),
            ("POST", "sys/mounts/passwords/tune", {"max_lease_ttl": "1h"}, ns),
            ("POST", "sys/namespaces/child", {}, ns),
            ("POST", "sys/namespaces/not-a-team", {}, None),
            ("DELETE", f"sys/namespaces/{ns}", None, None),
            ("PUT", "sys/policies/acl/escalate", {"policy": 'path "*" { capabilities = ["sudo"] }'}, None),
            ("PUT", "sys/policies/acl/openbao-provisioner", {"policy": 'path "*" { capabilities = ["sudo"] }'}, None),
            ("POST", "sys/auth/other", {"type": "jwt"}, None),
            ("POST", "auth/macro-lifecycle/config", pinned_config, None),
            ("POST", f"auth/macro-lifecycle/role/{ns}", {"token_policies": ["default"], "role_type": "jwt",
                                                         "user_claim": "team_id"}, None),
            ("POST", "auth/macro-lifecycle/role/other", {"role_type": "jwt", "user_claim": "team_id"}, None),
            ("POST", "sys/config/auditing/request-headers/x-macro-audit-id", {"hmac": True}, None),
            ("POST", "auth/token/create", {}, None),
        ):
            with self.subTest(method=method, path=path):
                self.assertDenied(method, path, provisioner, data, namespace)
        self.assertEqual(self.root.request("GET", "auth/macro/role/passwords-service", namespace=ns)["data"], role)

        # The templated lifecycle policy scopes each team's token to its own namespace.
        login = self.root.request("POST", "auth/macro-lifecycle/login", {
            "role": ns,
            "jwt": self.service_key.jwt({"iss": ISSUER, "sub": "macro-passwords-lifecycle",
                                         "aud": "macro-passwords-lifecycle", "team_id": str(team)}),
        })
        lifecycle = client(login["auth"]["client_token"])
        self.assertDenied("GET", f"sys/namespaces/team-{other}", lifecycle)
        self.assertDenied("DELETE", f"sys/namespaces/team-{other}", lifecycle)
        self.assertDenied("POST", f"sys/namespaces/team-{uuid4()}", lifecycle, {})
        lifecycle.request("GET", f"sys/namespaces/{ns}")
        lifecycle.request("DELETE", f"sys/namespaces/{ns}")
        self.assertIsNotNone(self.root.request("GET", f"sys/namespaces/team-{other}", missing=True))


if __name__ == "__main__":
    unittest.main()
