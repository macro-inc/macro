"""Opt-in lifecycle regression using only a disposable local Compose project."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4

from bootstrap import LocalOpenBao, bootstrap


@unittest.skipUnless(os.environ.get("PASSWORDS_TEST_OPENBAO_PERSISTENCE"), "disposable Docker lifecycle test opt-in required")
class PersistenceIntegration(unittest.TestCase):
    def test_init_unseal_and_values_survive_restart_and_recreation(self):
        source = Path(__file__).resolve().parent
        project = "passwords-persistence-" + uuid4().hex
        with tempfile.TemporaryDirectory() as directory:
            compose = Path(directory) / "compose.json"
            compose.write_text(json.dumps({
                "services": {"openbao": {
                    "image": "openbao/openbao:2.7.2",
                    "entrypoint": ["/usr/bin/dumb-init", "--", "/bin/sh", "/openbao/config/start.sh"],
                    "environment": {"BAO_ADDR": "http://127.0.0.1:8200"},
                    "volumes": [
                        str(source / "local.hcl") + ":/openbao/config/macro-local.hcl:ro,z",
                        str(source / "start.sh") + ":/openbao/config/start.sh:ro,z",
                        "vault:/openbao/file",
                    ],
                    "ports": ["127.0.0.1::8200"],
                    "network_mode": "bridge",
                    "healthcheck": {"test": ["CMD", "bao", "status"], "interval": "1s", "timeout": "3s", "retries": 60},
                }},
                "volumes": {"vault": {}},
            }))
            command = ["docker", "compose", "-p", project, "-f", str(compose)]

            def run(*arguments):
                try:
                    return subprocess.check_output(command + list(arguments), stderr=subprocess.PIPE)
                except subprocess.CalledProcessError as error:
                    logs = subprocess.run(command + ["logs", "--tail", "20"], capture_output=True).stdout.decode()
                    raise RuntimeError(error.stderr.decode() + logs) from None

            try:
                run("up", "-d", "--wait", "--wait-timeout", "90")
                credentials = run("exec", "-T", "openbao", "cat", "/openbao/file/bootstrap.json")
                self.assertEqual(run("exec", "-T", "openbao", "stat", "-c", "%a", "/openbao/file/bootstrap.json").strip(), b"600")
                self.assertEqual(len(run("exec", "-T", "openbao", "cat", "/openbao/file/seal.key")), 32)
                seal_digest = hashlib.sha256(run("exec", "-T", "openbao", "cat", "/openbao/file/seal.key")).digest()
                private_key = Path(directory) / "jwt.pem"
                subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(private_key)], check=True, capture_output=True)
                public_key = subprocess.check_output(["openssl", "pkey", "-in", str(private_key), "-pubout"]).decode()
                team = uuid4()
                namespace = f"team-{team}"

                def client():
                    port = run("port", "openbao", "8200").decode().strip().split(":")[-1]
                    return LocalOpenBao("http://127.0.0.1:" + port, json.loads(credentials)["root_token"])

                root = client()
                bootstrap(root, team, public_key, "local-persistence")
                for version in (0, 1):
                    root.request("POST", "passwords/data/item", {"options": {"cas": version}, "data": {"password": f"synthetic-{version}"}}, namespace)
                root.request("POST", "totp/keys/item", {"key": "JBSWY3DPEHPK3PXP"}, namespace)

                for operation in ("restart", "recreate"):
                    if operation == "restart":
                        run("restart", "openbao")
                    else:
                        run("down")
                    run("up", "-d", "--wait", "--wait-timeout", "90")
                    root = client()
                    self.assertTrue(run("exec", "-T", "openbao", "cat", "/openbao/file/bootstrap.json") == credentials)
                    self.assertEqual(hashlib.sha256(run("exec", "-T", "openbao", "cat", "/openbao/file/seal.key")).digest(), seal_digest)
                    self.assertEqual(root.request("GET", "passwords/data/item", namespace=namespace)["data"]["data"]["password"], "synthetic-1")
                    self.assertEqual(root.request("GET", "passwords/data/item?version=1", namespace=namespace)["data"]["data"]["password"], "synthetic-0")
                    self.assertRegex(root.request("GET", "totp/code/item", namespace=namespace)["data"]["code"], r"^\d{6}$")
                    self.assertEqual(root.request("GET", "auth/macro/config", namespace=namespace)["data"]["bound_issuer"], "local-persistence")
                    bootstrap(root, team, public_key, "local-persistence")
                    logs = run("logs")
                    for credential in [json.loads(credentials)["root_token"], *json.loads(credentials)["recovery_keys_b64"]]:
                        self.assertFalse(credential.encode() in logs, "Initialization credential appeared in container logs")
                port = run("port", "openbao", "8200").decode().strip().split(":")[-1]
                provider = subprocess.run([
                    sys.executable, "-m", "unittest", "discover", "-s", str(source), "-p", "test_bootstrap.py",
                ], env={
                    **os.environ,
                    "BAO_TOKEN": json.loads(credentials)["root_token"],
                    "PASSWORDS_TEST_OPENBAO_ADDRESS": "http://127.0.0.1:" + port,
                    "PASSWORDS_TEST_OPENBAO_CONTAINER": run("ps", "-q", "openbao").decode().strip(),
                }, capture_output=True)
                self.assertEqual(provider.returncode, 0, provider.stderr.decode())
            finally:
                run("down", "--volumes")
