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

from openbao_provisioning import provision_team
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


class RecordingVault:
    """In-memory stand-in for the provisioning API: keeps what was created and
    records every write, so a second run's writes can be compared to the first's."""

    def __init__(self):
        self.namespaces = set()
        self.mounts = {}
        self.auth = {"": {}}
        self.writes = []

    def request(self, method, path, data=None, namespace=None, missing=False):
        scope = namespace or ""
        if method == "GET" and path == "sys/audit":
            return {"data": {"passwords/": {"options": {"log_raw": "false"}}}}
        if method == "GET" and path.startswith("sys/namespaces/"):
            name = path.removeprefix("sys/namespaces/")
            return {"data": {"path": name}} if name in self.namespaces else None
        if method == "GET" and path == "sys/mounts":
            return {"data": self.mounts.setdefault(scope, {})}
        if method == "GET" and path == "sys/auth":
            return {"data": self.auth.setdefault(scope, {})}
        self.writes.append((method, scope, path, data))
        if path.startswith("sys/namespaces/"):
            self.namespaces.add(path.removeprefix("sys/namespaces/"))
        elif path.startswith("sys/mounts/"):
            self.mounts.setdefault(scope, {})[path.removeprefix("sys/mounts/") + "/"] = {
                "type": data["type"], "options": data["options"],
            }
        elif path.startswith("sys/auth/"):
            self.auth.setdefault(scope, {})[path.removeprefix("sys/auth/") + "/"] = {"type": data["type"]}
        return {}


class ProvisionTeam(unittest.TestCase):
    TEAM = "0195f6a4-1f6e-7c1a-8d55-0a0b0c0d0e0f"
    RSA = "-----BEGIN PUBLIC KEY-----\nsynthetic-rsa\n-----END PUBLIC KEY-----\n"
    EC = "-----BEGIN PUBLIC KEY-----\nsynthetic-ec\n-----END PUBLIC KEY-----\n"

    def test_both_keys_and_algorithms_are_trusted_during_a_switch(self):
        vault = RecordingVault()
        provision_team(vault, self.TEAM, [self.RSA, self.EC], "macro-dev-passwords", ["RS256", "ES256"])
        configs = [(scope, path, data) for method, scope, path, data in vault.writes if path.endswith("/config")
                   and path.startswith("auth/")]
        self.assertEqual(configs, [
            (f"team-{self.TEAM}", "auth/macro/config", {
                "jwt_validation_pubkeys": [self.RSA, self.EC],
                "bound_issuer": "macro-dev-passwords",
                "jwt_supported_algs": ["RS256", "ES256"],
            }),
            ("", "auth/macro-lifecycle/config", {
                "jwt_validation_pubkeys": [self.RSA, self.EC],
                "bound_issuer": "macro-dev-passwords",
                "jwt_supported_algs": ["RS256", "ES256"],
            }),
        ])

    def test_a_second_run_creates_nothing_and_rewrites_the_same_configuration(self):
        vault = RecordingVault()
        provision_team(vault, self.TEAM, [self.EC], "macro-dev-passwords", ["ES256"])
        first = list(vault.writes)
        vault.writes.clear()
        provision_team(vault, self.TEAM, [self.EC], "macro-dev-passwords", ["ES256"])
        second = list(vault.writes)

        created = ("sys/namespaces/", "sys/mounts/", "sys/auth/")
        self.assertEqual([write for write in second if write[2].startswith(created)], [])
        self.assertEqual(second, [write for write in first if not write[2].startswith(created)])

    def test_a_switch_to_es256_only_drops_the_old_key(self):
        vault = RecordingVault()
        provision_team(vault, self.TEAM, [self.RSA, self.EC], "macro-dev-passwords", ["RS256", "ES256"])
        vault.writes.clear()
        provision_team(vault, self.TEAM, [self.EC], "macro-dev-passwords", ["ES256"])
        team_config = [data for _, scope, path, data in vault.writes
                       if scope == f"team-{self.TEAM}" and path == "auth/macro/config"]
        self.assertEqual(team_config, [{
            "jwt_validation_pubkeys": [self.EC],
            "bound_issuer": "macro-dev-passwords",
            "jwt_supported_algs": ["ES256"],
        }])

    def test_missing_keys_or_unknown_algorithms_are_refused_before_any_request(self):
        for keys, algorithms in (([], ["ES256"]), ([self.EC], []), ([self.EC], ["HS256"])):
            with self.subTest(keys=keys, algorithms=algorithms):
                vault = RecordingVault()
                with self.assertRaises(ValueError):
                    provision_team(vault, self.TEAM, keys, "macro-dev-passwords", algorithms)
                self.assertEqual(vault.writes, [])


if __name__ == "__main__":
    unittest.main()
