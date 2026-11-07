#!/usr/bin/env python3
"""Normalize the pinned root/team mounted OpenBao 2.7.2 API for progenitor.

Raw documents are preserved verbatim. Only operations used by the client survive.
Missing envelope/response definitions are patched here, never in HTTP wrappers.
"""
import copy
import json
from pathlib import Path

# source, path, method, unique operation ID
KEPT_OPERATIONS = (
    ("team", "/auth/macro/login", "post", "login_team"),
    ("root", "/auth/macro-lifecycle/login", "post", "login_lifecycle"),
    ("team", "/passwords/data/{path}", "get", "read_secret"),
    ("team", "/passwords/data/{path}", "post", "write_secret"),
    ("team", "/passwords/metadata/{path}", "get", "read_metadata"),
    ("team", "/passwords/destroy/{path}", "post", "destroy_versions"),
    ("team", "/totp/keys/{name}", "post", "write_totp"),
    ("team", "/totp/keys/{name}", "delete", "delete_totp"),
    ("team", "/totp/code/{name}", "get", "read_totp"),
    ("root", "/sys/namespaces/{path}", "get", "read_namespace"),
    ("root", "/sys/namespaces/{path}", "delete", "delete_namespace"),
)


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required)}


def array(items):
    return {"type": "array", "items": items}


STRING = {"type": "string"}
INTEGER = {"type": "integer", "format": "uint64", "minimum": 0}
BOOLEAN = {"type": "boolean"}
TIMESTAMP = {"type": "string", "format": "date-time"}


def envelope(name):
    return obj({"data": ref(name)}, ("data",))


def response(schema):
    return {"description": "OpenBao response", "content": {"application/json": {"schema": schema}}}


def body(schema):
    return {"required": True, "content": {"application/json": {"schema": schema}}}


def header(name, required):
    return {"in": "header", "name": name, "required": required, "schema": STRING}


def patch(documents):
    # Source definitions describe plugin fields, not the outer OpenBao envelope.
    # Keep the actual payload generic: applications choose their own KV schema.
    schemas = {
        "SecretString": STRING,
        "SecretData": {"type": "object", "additionalProperties": {}},
        "ErrorResponse": obj({"errors": {**array(ref("SecretString")), "default": []}}),
        "LoginRequest": obj({"jwt": ref("SecretString"), "role": STRING}, ("jwt", "role")),
        # lease_duration (seconds) bounds how long callers may reuse the token.
        "LoginAuth": obj({"client_token": ref("SecretString"), "lease_duration": INTEGER}, ("client_token", "lease_duration")),
        "LoginResponse": obj({"auth": ref("LoginAuth")}, ("auth",)),
        "CasOptions": obj({"cas": INTEGER}, ("cas",)),
        "WriteSecretRequest": obj({"data": ref("SecretData"), "options": ref("CasOptions")}, ("data", "options")),
        "KvVersion": obj({"created_time": TIMESTAMP, "deletion_time": STRING, "destroyed": BOOLEAN, "version": INTEGER}, ("created_time", "deletion_time", "destroyed")),
        "KvReadData": obj({"data": ref("SecretData"), "metadata": ref("KvVersion")}, ("data", "metadata")),
        "KvReadResponse": envelope("KvReadData"),
        "KvWriteData": obj({"version": INTEGER, "created_time": TIMESTAMP}, ("version", "created_time")),
        "KvWriteResponse": envelope("KvWriteData"),
        "KvMetadata": obj({"current_version": INTEGER, "versions": {"type": "object", "additionalProperties": ref("KvVersion")}}, ("current_version", "versions")),
        "KvMetadataResponse": envelope("KvMetadata"),
        "DestroyRequest": obj({"versions": array(INTEGER)}, ("versions",)),
        # Import-only TOTP: no generated/exported secret or QR response.
        "TotpWriteRequest": obj({"key": ref("SecretString"), "period": INTEGER, "digits": INTEGER, "algorithm": STRING}, ("key", "period", "digits", "algorithm")),
        "TotpCode": obj({"code": ref("SecretString")}, ("code",)),
        "TotpResponse": envelope("TotpCode"),
        "NamespaceInfo": obj({key: copy.deepcopy(value) for key, value in documents["root"]["components"]["schemas"]["NamespacesReadNamespacesPathResponse"]["properties"].items() if key in ("id", "path", "tainted", "locked")}, ("id", "path", "tainted")),
        "NamespaceResponse": envelope("NamespaceInfo"),
    }
    success = {
        "login_team": "LoginResponse", "login_lifecycle": "LoginResponse",
        "read_secret": "KvReadResponse", "write_secret": "KvWriteResponse",
        "read_metadata": "KvMetadataResponse", "read_totp": "TotpResponse",
        "read_namespace": "NamespaceResponse",
    }
    requests = {"login_team": "LoginRequest", "login_lifecycle": "LoginRequest", "write_secret": "WriteSecretRequest", "destroy_versions": "DestroyRequest", "write_totp": "TotpWriteRequest"}
    paths = {}
    for source, path, method, operation_id in KEPT_OPERATIONS:
        source_path = documents[source]["paths"][path]
        operation = copy.deepcopy(source_path[method])  # Fail closed on source drift.
        operation["operationId"] = operation_id
        parameters = copy.deepcopy(source_path.get("parameters", []))
        # Metadata list/scan are deliberately not exposed by this client.
        parameters.extend([header("X-Vault-Token", operation_id not in ("login_team", "login_lifecycle")), header("x-macro-audit-id", False)])
        if source == "team":
            parameters.append(header("X-Vault-Namespace", True))
        if operation_id == "read_secret":
            parameters.append({"in": "query", "name": "version", "required": False, "schema": INTEGER})
        operation["parameters"] = parameters
        if operation_id in requests:
            operation["requestBody"] = body(ref(requests[operation_id]))
        if operation_id in success:
            responses = {"200": response(ref(success[operation_id]))}
        else:
            # Delete namespace may return 200 with a status envelope or empty 204.
            # The acknowledgement is GET 404, so neither response body is needed.
            responses = {"204": {"description": "Operation accepted"}}
            if operation_id == "delete_namespace":
                responses["200"] = {"description": "Asynchronous deletion accepted"}
        for code in ("4XX", "5XX"):
            responses[code] = response(ref("ErrorResponse"))
        operation["responses"] = responses
        paths.setdefault("/v1" + path, {})[method] = operation
    return {"openapi": "3.0.3", "info": {"title": "Mounted OpenBao API", "version": "2.7.2"}, "paths": paths, "components": {"schemas": schemas}}


def main():
    here = Path(__file__).resolve().parent
    documents = {name: json.loads((here / f"openbao-2.7.2-{name}.json").read_bytes()) for name in ("root", "team")}
    (here / "openapi.json").write_text(json.dumps(patch(documents), indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
