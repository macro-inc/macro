import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("patch", HERE / "patch.py")
patch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patch)


class PatchTests(unittest.TestCase):
    def setUp(self):
        self.sources = {source: json.loads((HERE / f"openbao-2.7.2-{source}.json").read_bytes()) for source in ("root", "team")}

    def test_only_called_operations_and_headers_survive(self):
        output = patch.patch(self.sources)
        operations = [(path, method) for path, methods in output["paths"].items() for method in methods]
        self.assertEqual(set(operations), {("/v1" + path, method) for _, path, method, _ in patch.KEPT_OPERATIONS})
        for source, path, method, name in patch.KEPT_OPERATIONS:
            operation = output["paths"]["/v1" + path][method]
            names = {param["name"] for param in operation["parameters"]}
            self.assertEqual("X-Vault-Namespace" in names, source == "team")
            self.assertIn("X-Vault-Token", names)
            self.assertIn("4XX", operation["responses"])
            self.assertIn("5XX", operation["responses"])
            self.assertNotIn("default", operation["responses"])
        self.assertNotIn("delete", output["paths"]["/v1/passwords/metadata/{path}"])

    def test_source_operation_disappearance_fails_closed(self):
        del self.sources["team"]["paths"]["/passwords/data/{path}"]["get"]
        with self.assertRaises(KeyError):
            patch.patch(self.sources)

    def test_normalization_is_stable_and_does_not_mutate_sources(self):
        original = copy.deepcopy(self.sources)
        first = patch.patch(self.sources)
        self.assertEqual(self.sources, original)
        second = patch.patch({source: json.loads(json.dumps(document, sort_keys=True)) for source, document in self.sources.items()})
        self.assertEqual(first, second)
        self.assertEqual(first, json.loads((HERE / "openapi.json").read_text()))


if __name__ == "__main__":
    unittest.main()
