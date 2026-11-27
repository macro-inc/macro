"""Hosted provisioning guard: exact origin, loopback tunnel only, verified TLS."""

import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import URLError

from provision import HOSTNAME, HostedOpenBao, parse_connect


def issue(directory, name):
    """A throwaway CA and a leaf certificate for `name`, signed by it."""
    def run(*args):
        subprocess.run(["openssl", *args], check=True, capture_output=True, cwd=directory)
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
        "-days", "1", "-subj", "/CN=synthetic-ca",
        "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    Path(directory, "leaf.ext").write_text(
        f"subjectAltName=DNS:{name}\nkeyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\nauthorityKeyIdentifier=keyid\n"
    )
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", f"/CN={name}")
    run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
        "-out", "leaf.pem", "-days", "1", "-extfile", "leaf.ext")


class Vault(BaseHTTPRequestHandler):
    seen_hosts = []

    def do_GET(self):
        Vault.seen_hosts.append(self.headers["Host"])
        body = b'{"data": {}}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class TunnelTls(unittest.TestCase):
    def serve(self, certificate_name):
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory)
        issue(directory, certificate_name)
        server = HTTPServer(("127.0.0.1", 0), Vault)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(Path(directory, "leaf.pem"), Path(directory, "leaf.key"))
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        trust = ssl.create_default_context(cafile=str(Path(directory, "ca.pem")))
        return server.server_address[1], trust

    def test_tunnel_verifies_the_hosted_name_and_sends_it_as_host(self):
        port, trust = self.serve(HOSTNAME)
        client = HostedOpenBao("synthetic", ("127.0.0.1", port), trust)
        self.assertEqual(client.request("GET", "sys/audit"), {"data": {}})
        self.assertEqual(Vault.seen_hosts[-1], HOSTNAME)

    def test_tunnel_refuses_a_certificate_for_another_name(self):
        port, trust = self.serve("other.example.org")
        client = HostedOpenBao("synthetic", ("127.0.0.1", port), trust)
        with self.assertRaises(URLError) as raised:
            client.request("GET", "sys/audit")
        self.assertIsInstance(raised.exception.reason, ssl.SSLCertVerificationError)

    def test_unverified_tls_is_refused(self):
        with self.assertRaises(ValueError):
            HostedOpenBao("synthetic", None, ssl._create_unverified_context())


class ConnectGuard(unittest.TestCase):
    def test_accepts_only_loopback_endpoints(self):
        self.assertEqual(parse_connect("127.0.0.1:18443"), ("127.0.0.1", 18443))
        self.assertEqual(parse_connect("[::1]:18443"), ("::1", 18443))
        self.assertEqual(parse_connect("localhost:18443"), ("localhost", 18443))
        for value in ("10.0.0.1:443", "example.org:443", "127.0.0.1", "127.0.0.1:0", ":443", "127.0.0.1:x"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                parse_connect(value)


class SharedProvisioning(unittest.TestCase):
    def test_local_and_hosted_entrypoints_run_the_same_provisioning(self):
        local = str(Path(__file__).resolve().parents[1] / "local" / "openbao")
        sys.path.insert(0, local)
        try:
            import bootstrap
        finally:
            sys.path.remove(local)
        import provision
        self.assertIs(bootstrap.provision_team, provision.provision_team)


class FakeOpenBao:
    """In-memory stand-in for the paths `provision_team` reads and writes."""

    def __init__(self):
        self.namespaces, self.store, self.mounts, self.writes = set(), {}, {}, []

    def request(self, method, path, data=None, namespace=None, missing=False):
        from openbao_provisioning import OpenBaoRequestError
        key = (namespace, path)
        if method == "GET":
            if path == "sys/audit":
                return {"data": {"passwords/": {"options": {"log_raw": "false"}}}}
            if path.startswith("sys/namespaces/"):
                return {"data": {"tainted": False}} if path.split("/", 2)[2] in self.namespaces else None
            if path in ("sys/mounts", "sys/auth"):
                return {"data": {name: value for (ns, kind, name), value in self.mounts.items()
                                 if ns == namespace and kind == path}}
            if path == "passwords/config":
                return {"data": self.store.get(key, {"max_versions": 0, "cas_required": False})}
            if key in self.store:
                return {"data": self.store[key]}
            if missing:
                return None
            raise OpenBaoRequestError(method, path, 404)
        self.writes.append((namespace, path))
        if path.startswith("sys/namespaces/"):
            self.namespaces.add(path.split("/", 2)[2])
        elif path.startswith(("sys/mounts/", "sys/auth/")):
            kind, name = path.rsplit("/", 1)
            self.mounts[(namespace, kind, name + "/")] = {"type": data["type"], "options": data.get("options")}
        elif path == "passwords/config":
            self.store[key] = {"max_versions": int(data["max_versions"]), "cas_required": data["cas_required"]}
        elif "/role/" in path:
            self.store[key] = {**data, **{name: int(value) for name, value in data.items() if name.endswith("_leeway")},
                               **{name: 60 for name in data if name.endswith("_ttl")}}
        else:
            self.store[key] = data
        return {}


class CreateOnly(unittest.TestCase):
    """The scoped provisioner's path, without a vault (the fixture tests cover a real one)."""

    def provision(self, fake, **options):
        from openbao_provisioning import provision_team
        return provision_team(fake, "00000000-0000-0000-0000-000000000001", ["-----BEGIN PUBLIC KEY-----\nk\n"],
                              "issuer", ["ES256"], overwrite=False, **options)

    def test_lifecycle_role_precedes_the_namespace(self):
        fake = FakeOpenBao()
        result = self.provision(fake)
        self.assertEqual(result.created_pieces[:2], ["lifecycle role", "namespace"])
        self.assertEqual(fake.writes[0], (None, "auth/macro-lifecycle/role/team-00000000-0000-0000-0000-000000000001"))

    def test_deadline_stops_before_the_namespace(self):
        from openbao_provisioning import DeadlineExceeded
        fake = FakeOpenBao()
        with self.assertRaises(DeadlineExceeded):
            self.provision(fake, deadline=0)
        self.assertEqual(fake.namespaces, set())
        self.assertEqual(len(fake.writes), 1)

    def test_healthy_team_gets_no_writes(self):
        fake = FakeOpenBao()
        self.provision(fake)
        fake.writes.clear()
        self.assertFalse(self.provision(fake).created)
        self.assertEqual(fake.writes, [])

    def test_differing_piece_is_incompatible_and_unchanged(self):
        from openbao_provisioning import Incompatible
        fake = FakeOpenBao()
        self.provision(fake)
        namespace = "team-00000000-0000-0000-0000-000000000001"
        fake.store[(namespace, "sys/policies/acl/passwords-service")] = {"policy": "widened"}
        fake.writes.clear()
        with self.assertRaises(Incompatible) as raised:
            self.provision(fake)
        self.assertEqual(raised.exception.piece, "passwords-service policy")
        self.assertEqual(fake.writes, [])

    def test_provisioner_policy_pins_keys_issuer_and_algorithms_as_whole_lists(self):
        from openbao_provisioning import render_provisioner_policy
        policy = render_provisioner_policy("issuer", ["-----BEGIN PUBLIC KEY-----\nold\n", "new\n"], ["RS256", "ES256"])
        self.assertIn('"jwt_validation_pubkeys" = [["-----BEGIN PUBLIC KEY-----\\nold", "new"]]', policy)
        self.assertIn('"bound_issuer" = ["issuer"]', policy)
        self.assertIn('"jwt_supported_algs" = [["RS256", "ES256"]]', policy)
        self.assertNotIn("sys/policies/acl/passwords-lifecycle", policy)


if __name__ == "__main__":
    unittest.main()
