import unittest

from normalize_openapi import normalize


class NormalizeOpenApi(unittest.TestCase):
    def test_optional_reference_preserves_target_and_nullability(self):
        result = normalize({"anyOf": [{"$ref": "#/components/schemas/Endpoint"}, {"type": "null"}], "description": "Optional endpoint"})
        self.assertEqual(result, {"$ref": "#/components/schemas/Endpoint", "nullable": True, "description": "Optional endpoint"})

    def test_nested_numeric_bounds_preserve_exclusivity(self):
        result = normalize({"type": "array", "items": {"type": ["integer", "null"], "exclusiveMinimum": 0, "maximum": 25}})
        self.assertEqual(result["items"], {"type": "integer", "nullable": True, "exclusiveMinimum": True, "minimum": 0, "maximum": 25})

    def test_refuses_schema_semantics_the_generator_cannot_preserve(self):
        for schema in ({"type": ["string", "integer"]}, {"prefixItems": []}, {"if": {"type": "string"}}, {"oneOf": [{"type": "null"}, {"type": "string"}, {"type": "integer"}]}):
            with self.subTest(schema=schema), self.assertRaises(ValueError):
                normalize(schema)


if __name__ == "__main__":
    unittest.main()
