"""Convert the engine's supported OpenAPI 3.1 schemas for Progenitor 0.15."""

import json
import sys


def normalize(value):
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if not isinstance(value, dict):
        return value
    unsupported = {"$dynamicRef", "prefixItems", "unevaluatedProperties", "if", "then", "else"} & value.keys()
    if unsupported:
        raise ValueError(f"Unsupported OpenAPI schema keywords: {sorted(unsupported)}")
    result = {key: normalize(item) for key, item in value.items() if key not in {"$schema", "jsonSchemaDialect"}}
    types = result.get("type")
    if isinstance(types, list):
        non_null = [item for item in types if item != "null"]
        if len(non_null) != 1:
            raise ValueError(f"Unsupported schema type union: {types}")
        result["type"] = non_null[0]
        if "null" in types:
            result["nullable"] = True
    for union in ("anyOf", "oneOf"):
        variants = result.get(union)
        if variants and any(item.get("type") == "null" for item in variants):
            non_null = [item for item in variants if item.get("type") != "null"]
            if len(non_null) != 1:
                raise ValueError("Unsupported nullable schema union")
            del result[union]
            result.update(non_null[0])
            result["nullable"] = True
    if "const" in result:
        result["enum"] = [result.pop("const")]
    for bound, inclusive in (("exclusiveMinimum", "minimum"), ("exclusiveMaximum", "maximum")):
        if bound in result and not isinstance(result[bound], bool):
            result[inclusive] = result[bound]
            result[bound] = True
    if "examples" in result and "type" in result:
        examples = result.pop("examples")
        if examples:
            result["example"] = examples[0]
    return result


if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        document = json.load(source)
    if document.get("openapi") != "3.1.0":
        raise ValueError("Expected the engine's OpenAPI 3.1.0 document")
    document = normalize(document)
    document["openapi"] = "3.0.3"
    with open(sys.argv[2], "w") as output:
        json.dump(document, output, indent=2, sort_keys=True)
        output.write("\n")
