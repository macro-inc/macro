"""Copy between two vaults: exact version numbers, append-only, values never printed."""

import contextlib
import io
import sys
import unittest
from unittest import mock

import copy_secrets
from openbao_provisioning import OpenBaoRequestError

TEAM = "team-0190b0e4-0000-7000-8000-000000000001"
SECRET = "synthetic-secret-value"


class FakeVault:
    """The KV v2, namespace, TOTP and health endpoints copy_secrets uses."""

    def __init__(self, cluster_id, max_versions=100):
        self.cluster_id = cluster_id
        self.max_versions = max_versions
        self.namespaces = {}
        self.writes = 0

    def provision(self, namespace, totp_keys=()):
        self.namespaces[namespace] = {"items": {}, "totp": set(totp_keys)}

    def put(self, namespace, path, *values):
        """Append versions directly; None makes a destroyed version."""
        for value in values:
            self._append(namespace, path, value or {"placeholder": "x"}, destroyed=value is None)

    def _append(self, namespace, path, value, destroyed=False):
        item = self.namespaces[namespace]["items"].setdefault(path, {"current": 0, "versions": {}})
        item["current"] += 1
        item["versions"][item["current"]] = {"value": value, "destroyed": destroyed, "deletion_time": ""}
        for old in [version for version in item["versions"] if version <= item["current"] - self.max_versions]:
            del item["versions"][old]
        return item["current"]

    def request(self, method, path, data=None, namespace=None, missing=False):
        path, _, query = path.partition("?")
        if path == "sys/health":
            return {"cluster_id": self.cluster_id}
        if path == "sys/namespaces" and method == "LIST":
            return {"data": {"keys": [name + "/" for name in self.namespaces]}}
        space = self.namespaces.get(namespace)
        if path == "sys/mounts":
            if space is None:
                return self._missing(method, path, missing)
            return {"data": {"passwords/": {}, "totp/": {}}}
        if path == "totp/keys" and method == "LIST":
            return {"data": {"keys": sorted(space["totp"])}} if space["totp"] else self._missing(method, path, missing)
        mount, kind, item_path = path.split("/", 2) if path.count("/") >= 2 else (*path.split("/", 1), "")
        if mount != "passwords":
            raise AssertionError(f"unexpected path {path}")
        items = space["items"]
        if kind == "metadata" and method == "LIST":
            keys = sorted(name for name in items if name.startswith(item_path))
            return {"data": {"keys": keys}} if keys else self._missing(method, path, missing)
        item = items.get(item_path)
        if kind == "metadata":
            if item is None:
                return self._missing(method, path, missing)
            return {"data": {"current_version": item["current"], "versions": {
                str(version): {"destroyed": entry["destroyed"], "deletion_time": entry["deletion_time"]}
                for version, entry in item["versions"].items()
            }}}
        if kind == "data" and method == "GET":
            entry = item["versions"][int(query.removeprefix("version="))]
            if entry["destroyed"] or entry["deletion_time"]:
                raise OpenBaoRequestError(method, path, 404)
            return {"data": {"data": entry["value"]}}
        if kind == "data" and method == "POST":
            current = 0 if item is None else item["current"]
            if data["options"]["cas"] != current:
                raise OpenBaoRequestError(method, path, 400)
            self.writes += 1
            return {"data": {"version": self._append(namespace, item_path, data["data"])}}
        if kind == "destroy":
            for version in data["versions"]:
                if version in item["versions"]:
                    item["versions"][version]["destroyed"] = True
            return {}
        if kind == "delete":
            for version in data["versions"]:
                item["versions"][version]["deletion_time"] = "2026-01-01T00:00:00Z"
            return {}
        raise AssertionError(f"unexpected {method} {path}")

    @staticmethod
    def _missing(method, path, missing):
        if missing:
            return None
        raise OpenBaoRequestError(method, path, 404)


def vaults():
    source, destination = FakeVault("legacy"), FakeVault("account")
    source.provision(TEAM, totp_keys=["0190b0e4-0000-7000-8000-0000000000aa"])
    destination.provision(TEAM)
    return source, destination


class CopyTeam(unittest.TestCase):
    def test_copies_every_version_with_its_number_and_state(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": SECRET}, None, {"password": "v3"})
        source.put(TEAM, "item-b", {"password": "only"})

        report = copy_secrets.copy_team(source, destination, TEAM, dry_run=False)

        self.assertEqual((report["items"], report["versions_copied"], report["diverged"]), (2, 4, []))
        self.assertEqual(report["totp_keys"], 1)
        copied = destination.namespaces[TEAM]["items"]["item-a"]
        self.assertEqual(copied["current"], 3)
        self.assertEqual(copied["versions"][1]["value"], {"password": SECRET})
        self.assertTrue(copied["versions"][2]["destroyed"])
        self.assertEqual(copied["versions"][3]["value"], {"password": "v3"})
        self.assertEqual(copy_secrets.verify_team(source, destination, TEAM), [])

    def test_a_repeat_run_writes_nothing_and_a_later_one_appends(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": "v1"})
        copy_secrets.copy_team(source, destination, TEAM, dry_run=False)
        writes = destination.writes

        again = copy_secrets.copy_team(source, destination, TEAM, dry_run=False)
        self.assertEqual((again["versions_copied"], again["versions_present"], destination.writes), (0, 1, writes))

        source.put(TEAM, "item-a", {"password": "v2"})
        later = copy_secrets.copy_team(source, destination, TEAM, dry_run=False)
        self.assertEqual(later["versions_copied"], 1)
        self.assertEqual(destination.namespaces[TEAM]["items"]["item-a"]["versions"][2]["value"], {"password": "v2"})

    def test_dry_run_writes_nothing(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": "v1"}, {"password": "v2"})

        report = copy_secrets.copy_team(source, destination, TEAM, dry_run=True)

        self.assertEqual((report["versions_copied"], destination.writes), (2, 0))
        self.assertEqual(destination.namespaces[TEAM]["items"], {})

    def test_a_diverged_destination_is_reported_and_left_alone(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": "source"})
        destination.put(TEAM, "item-a", {"password": "written-elsewhere"})

        report = copy_secrets.copy_team(source, destination, TEAM, dry_run=False)

        self.assertEqual(report["diverged"], ["item-a"])
        self.assertEqual(destination.writes, 0)
        self.assertEqual(copy_secrets.verify_team(source, destination, TEAM), ["item-a"])

    def test_versions_pruned_past_max_versions_keep_their_numbers(self):
        source, destination = FakeVault("legacy", max_versions=2), FakeVault("account", max_versions=2)
        source.provision(TEAM)
        destination.provision(TEAM)
        source.put(TEAM, "item-a", {"password": "v1"}, {"password": "v2"}, {"password": "v3"})

        copy_secrets.copy_team(source, destination, TEAM, dry_run=False)

        copied = destination.namespaces[TEAM]["items"]["item-a"]
        self.assertEqual((copied["current"], sorted(copied["versions"])), (3, [2, 3]))
        self.assertEqual(copied["versions"][3]["value"], {"password": "v3"})
        self.assertEqual(copy_secrets.verify_team(source, destination, TEAM), [])


class CheckVaults(unittest.TestCase):
    def test_refuses_the_same_vault_twice(self):
        source, _ = vaults()
        with self.assertRaises(copy_secrets.CopyError):
            copy_secrets.check_vaults(source, source, [TEAM])

    def test_refuses_an_unprovisioned_destination_team(self):
        source, destination = vaults()
        destination.namespaces.clear()
        with self.assertRaisesRegex(copy_secrets.CopyError, TEAM):
            copy_secrets.check_vaults(source, destination, [TEAM])


class Main(unittest.TestCase):
    def run_main(self, source, destination, *arguments):
        clients = iter([source, destination])
        argv = ["copy_secrets.py", "--source-connect", "127.0.0.1:18443",
                "--destination-connect", "127.0.0.1:28443", *arguments]
        environment = {"BAO_SOURCE_TOKEN": "synthetic-a", "BAO_DESTINATION_TOKEN": "synthetic-b"}
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), mock.patch.dict("os.environ", environment), \
                mock.patch.object(copy_secrets, "HostedOpenBao", lambda *_: next(clients)), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                copy_secrets.main()
                code = 0
            except SystemExit as exit:
                code = exit.code
        return code, output.getvalue()

    def test_prints_counts_never_values(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": SECRET})

        code, output = self.run_main(source, destination)

        self.assertEqual(code, 0)
        self.assertIn(f"{TEAM}: 1 items, copied 1 versions", output)
        self.assertNotIn(SECRET, output)

    def test_divergence_fails_the_run(self):
        source, destination = vaults()
        source.put(TEAM, "item-a", {"password": SECRET})
        destination.put(TEAM, "item-a", {"password": "other"})

        code, output = self.run_main(source, destination)

        self.assertEqual(code, 2)
        self.assertIn("diverged, left alone: item-a", output)
        self.assertNotIn(SECRET, output)

    def test_one_tunnel_for_both_is_refused(self):
        argv = ["copy_secrets.py", "--source-connect", "127.0.0.1:18443", "--destination-connect", "127.0.0.1:18443"]
        with mock.patch.object(sys, "argv", argv), contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit):
            copy_secrets.main()


if __name__ == "__main__":
    unittest.main()
