"""Trims the converted Incus OpenAPI 3 document to the endpoints this crate
uses and reshapes it into something progenitor generates cleanly.

Usage: python3 patch.py <converted openapi3.json> <output openapi.json>
"""

import json
import sys

# (source path, method) -> output path. Incus documents `?recursion=1`
# variants as separate path strings; progenitor cannot take a query in a path,
# so the recursion variant replaces the plain path and gains a `recursion`
# query parameter.
KEPT_OPERATIONS = {
    ("/1.0", "get"): "/1.0",
    ("/1.0/instances?recursion=1", "get"): "/1.0/instances",
    ("/1.0/instances", "post"): "/1.0/instances",
    ("/1.0/instances/{name}", "get"): "/1.0/instances/{name}",
    ("/1.0/instances/{name}", "put"): "/1.0/instances/{name}",
    ("/1.0/instances/{name}", "patch"): "/1.0/instances/{name}",
    ("/1.0/instances/{name}", "delete"): "/1.0/instances/{name}",
    ("/1.0/instances/{name}/exec", "post"): "/1.0/instances/{name}/exec",
    ("/1.0/instances/{name}/rebuild", "post"): "/1.0/instances/{name}/rebuild",
    ("/1.0/instances/{name}/state", "get"): "/1.0/instances/{name}/state",
    ("/1.0/instances/{name}/state", "put"): "/1.0/instances/{name}/state",
    ("/1.0/operations/{id}", "get"): "/1.0/operations/{id}",
    ("/1.0/operations/{id}/wait", "get"): "/1.0/operations/{id}/wait",
    ("/1.0/images?recursion=1", "get"): "/1.0/images",
    ("/1.0/images/aliases/{name}", "get"): "/1.0/images/aliases/{name}",
    ("/1.0/resources", "get"): "/1.0/resources",
    (
        "/1.0/storage-pools/{poolName}/volumes/{type}",
        "post",
    ): "/1.0/storage-pools/{poolName}/volumes/{type}",
    (
        "/1.0/storage-pools/{poolName}/volumes/{type}/{volumeName}",
        "delete",
    ): "/1.0/storage-pools/{poolName}/volumes/{type}/{volumeName}",
}

# Progenitor takes one success type. These operations document both a sync
# and an async success; keep the one Incus returns for how we call them.
SUCCESS_STATUS = {
    # Rebuilding from an image always runs as an operation.
    "instance_rebuild_post": "202",
    # Creating an empty volume (no copy or migration) is synchronous.
    "storage_pool_volumes_type_post": "200",
}

RECURSION_PARAMETER = {
    "description": "Recursion level; this client always sends 1",
    "in": "query",
    "name": "recursion",
    "required": True,
    "schema": {"type": "integer"},
}

# Every Incus failure, whatever the status, has this body.
ERROR_RESPONSE = {
    "description": "Error response",
    "properties": {
        "type": {"type": "string"},
        "error": {"type": "string"},
        "error_code": {"type": "integer", "format": "int64"},
    },
    "type": "object",
}

# A started background operation (202).
ASYNC_RESPONSE = {
    "description": "Async response",
    "properties": {
        "type": {"type": "string"},
        "status": {"type": "string"},
        "status_code": {"type": "integer", "format": "int64"},
        "operation": {"type": "string"},
        "metadata": {"$ref": "#/components/schemas/Operation"},
    },
    "required": ["metadata"],
    "type": "object",
}

EMPTY_SYNC_RESPONSE = {
    "description": "Empty sync response",
    "properties": {
        "type": {"type": "string"},
        "status": {"type": "string"},
        "status_code": {"type": "integer", "format": "int64"},
    },
    "type": "object",
}

# The Resources schema covers every device on the host; we read only totals.
RESOURCES_KEPT_PROPERTIES = {"cpu", "memory"}
RESOURCES_CPU_KEPT_PROPERTIES = {"architecture", "total"}
RESOURCES_MEMORY_KEPT_PROPERTIES = {"total", "used"}


def json_response(description, schema):
    return {
        "description": description,
        "content": {"application/json": {"schema": schema}},
    }


def patch_operation(source_path, operation, document):
    operation = json.loads(json.dumps(operation))

    request_body = operation.get("requestBody")
    if request_body is not None and "$ref" in request_body:
        name = request_body["$ref"].split("/")[-1]
        operation["requestBody"] = document["components"]["requestBodies"][name]

    if request_body is not None:
        operation["requestBody"].pop("x-s2o-overloaded", None)
        operation["requestBody"]["required"] = True
        # Rebuild declares application/octet-stream but takes a JSON body.
        content = operation["requestBody"]["content"]
        if "application/json" not in content:
            content["application/json"] = content.pop("application/octet-stream")

    operation.pop("x-s2o-warning", None)

    if "?recursion=1" in source_path:
        operation["parameters"].append(RECURSION_PARAMETER)

    responses = {}
    kept_status = SUCCESS_STATUS.get(operation["operationId"])
    for status, response in operation["responses"].items():
        if not status.startswith("2"):
            continue
        if kept_status is not None and status != kept_status:
            continue

        reference = response.get("$ref", "")
        if reference.endswith("/Operation"):
            responses[status] = json_response(
                "Operation", {"$ref": "#/components/schemas/AsyncResponse"}
            )
        elif reference.endswith("/EmptySyncResponse"):
            responses[status] = json_response(
                "Empty sync response",
                {"$ref": "#/components/schemas/EmptySyncResponse"},
            )
        else:
            responses[status] = response

    # Ranges, not `default`: progenitor counts `default` as a success type.
    for error_range in ("4XX", "5XX"):
        responses[error_range] = json_response(
            "Error", {"$ref": "#/components/schemas/ErrorResponse"}
        )
    operation["responses"] = responses

    return operation


def add_if_match_header(operation):
    operation["parameters"].append(
        {
            "description": "ETag of the instance read before this update",
            "in": "header",
            "name": "If-Match",
            "required": True,
            "schema": {"type": "string"},
        }
    )


def referenced_schemas(value, found):
    if isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith(
            "#/components/schemas/"
        ):
            found.add(reference.split("/")[-1])
        for child in value.values():
            referenced_schemas(child, found)
    elif isinstance(value, list):
        for child in value:
            referenced_schemas(child, found)


def mark_nullable(schema):
    """Go encodes nil maps and slices as `null`, so any map or list field may
    be null on the wire."""
    if schema.get("type") in ("object", "array"):
        schema["nullable"] = True
    for child in schema.get("properties", {}).values():
        mark_nullable(child)
    items = schema.get("items")
    if isinstance(items, dict):
        mark_nullable(items)


def keep_properties(schema, kept):
    schema["properties"] = {
        key: value for key, value in schema["properties"].items() if key in kept
    }


def main():
    source_file, output_file = sys.argv[1], sys.argv[2]
    with open(source_file) as handle:
        document = json.load(handle)

    paths = {}
    for (source_path, method), output_path in KEPT_OPERATIONS.items():
        operation = patch_operation(
            source_path, document["paths"][source_path][method], document
        )
        if operation["operationId"] == "instance_put":
            add_if_match_header(operation)
        paths.setdefault(output_path, {})[method] = operation

    schemas = document["components"]["schemas"]
    schemas["ErrorResponse"] = ERROR_RESPONSE
    schemas["AsyncResponse"] = ASYNC_RESPONSE
    schemas["EmptySyncResponse"] = EMPTY_SYNC_RESPONSE

    # Incus serialises every config value and device option as a string.
    schemas["ConfigMap"]["additionalProperties"] = {"type": "string"}
    schemas["DevicesMap"]["additionalProperties"] = {
        "type": "object",
        "additionalProperties": {"type": "string"},
    }

    keep_properties(schemas["Resources"], RESOURCES_KEPT_PROPERTIES)
    keep_properties(schemas["ResourcesCPU"], RESOURCES_CPU_KEPT_PROPERTIES)
    keep_properties(schemas["ResourcesMemory"], RESOURCES_MEMORY_KEPT_PROPERTIES)

    kept_schemas = set()
    referenced_schemas(paths, kept_schemas)
    pending = list(kept_schemas)
    while pending:
        name = pending.pop()
        found = set()
        referenced_schemas(schemas[name], found)
        for child in found - kept_schemas:
            kept_schemas.add(child)
            pending.append(child)

    for name in kept_schemas:
        for child in schemas[name].get("properties", {}).values():
            mark_nullable(child)

    output = {
        "openapi": "3.0.3",
        "info": {
            key: value for key, value in document["info"].items() if key != "contact"
        },
        "paths": paths,
        "components": {
            "schemas": {name: schemas[name] for name in sorted(kept_schemas)}
        },
    }

    with open(output_file, "w") as handle:
        json.dump(output, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
