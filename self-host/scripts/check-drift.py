#!/usr/bin/env python3
"""Fail if the self-host artifacts have drifted from the Rust source of truth.

The compose file and Caddyfile are checked in so a self-hoster needs no Rust
toolchain, which means they can silently fall behind the inventory they were
derived from. A service added to `inventory::RUST_SERVICES` that never reaches
self-host/docker-compose.yml is a feature that quietly does not exist in a
self-hosted install; a queue added to `resources::QUEUES` and not to .env.example
is a worker that tight-loops on a queue that was never created.

Sources of truth:
  tooling/xtask/crates/xtask_local/src/local/inventory.rs   services + routes
  tooling/xtask/crates/xtask_local/src/local/resources.rs   buckets/queues/tables
  crates/macro_queues/src/lib.rs                            queue names

Run: python3 self-host/scripts/check-drift.py
"""
from __future__ import annotations
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SELF_HOST = ROOT / "self-host"
failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# --- inventory -------------------------------------------------------------
inv = (ROOT / "tooling/xtask/crates/xtask_local/src/local/inventory.rs").read_text()
services = []
for block in re.findall(r"RustService \{(.*?)\n    \},", inv, re.S):
    def field(name):
        m = re.search(rf'{name}:\s*(?:Some\("([^"]+)"\)|"([^"]+)"|None|(true|false))', block)
        if not m:
            return None
        return m.group(1) or m.group(2) or m.group(3)
    services.append({
        "compose_name": field("compose_name"),
        "cargo_bin": field("cargo_bin"),
        "path_prefix": field("path_prefix"),
        "is_websocket": field("is_websocket") == "true",
        "modes": re.search(r"modes:\s*&\[([^\]]*)\]", block).group(1),
    })

# Local-mode services, minus the seed-CLI sidecar which is a dev-only fixture.
wanted = [s for s in services if "Mode::Local" in s["modes"] and s["compose_name"] != "gmail_forwarder"]

compose = (SELF_HOST / "docker-compose.yml").read_text()
caddy = (SELF_HOST / "Caddyfile").read_text()
env_example = (SELF_HOST / ".env.example").read_text()

for s in wanted:
    if f'/app/out/{s["cargo_bin"]}' not in compose:
        fail(f'service {s["compose_name"]}: binary /app/out/{s["cargo_bin"]} not run by docker-compose.yml')
    if s["path_prefix"]:
        if s["path_prefix"] not in caddy:
            fail(f'service {s["compose_name"]}: route {s["path_prefix"]} missing from Caddyfile')
        elif s["is_websocket"] and "uri strip_prefix " + s["path_prefix"] not in caddy:
            fail(f'service {s["compose_name"]}: websocket route {s["path_prefix"]} is not a strip_prefix handler')

# --- resources -------------------------------------------------------------
manifest = json.loads((SELF_HOST / "init/resources.json").read_text())
env_keys = {
    line.split("=", 1)[0]
    for line in env_example.splitlines()
    if line and not line.lstrip().startswith("#") and "=" in line
}

for b in manifest["buckets"]:
    if b["env_key"] not in env_keys:
        fail(f'bucket {b["name"]}: {b["env_key"]} missing from .env.example')
for t in manifest["tables"]:
    if t["env_key"] not in env_keys:
        fail(f'table {t["name"]}: {t["env_key"]} missing from .env.example')
for q in manifest["queues"]:
    for binding in q["bindings"]:
        if binding["key"] not in env_keys:
            fail(f'queue {q["name"]}: {binding["key"]} missing from .env.example')

# The manifest itself must match the Rust catalog it was extracted from.
res = (ROOT / "tooling/xtask/crates/xtask_local/src/local/resources.rs").read_text()
rust_queue_count = len(re.findall(r"\n    Queue \{", res.split("pub const QUEUES")[1].split("pub const BUCKETS")[0]))
if rust_queue_count != len(manifest["queues"]):
    fail(f'resources.json has {len(manifest["queues"])} queues, resources.rs declares {rust_queue_count}'
         " — regenerate self-host/init/resources.json")

# --- the auth binary must not be the local-stack build ---------------------
# `.#local-stack-binaries` compiles authentication_service with
# `return_passwordless_code` and without `rate_limit`, which returns the
# one-time login code in the API response. Shipping that is a full
# authentication bypass, so the publish workflow replaces it with the
# production build. Guard the step: deleting it would silently reintroduce
# the bypass and nothing else would notice.
workflow = (ROOT / ".github/workflows/self-host-images.yml").read_text()
if "local-stack-binaries" in workflow:
    if "deploy-service-binaries-authentication-service" not in workflow:
        fail("self-host-images.yml builds from local-stack-binaries but never replaces"
             " authentication_service with the production build — that ships a login-code"
             " leak and no rate limiting")
    if "Verify the auth binary is the production build" not in workflow:
        fail("self-host-images.yml no longer verifies the auth binary was replaced")

# --- kafka -----------------------------------------------------------------
topics_src = json.loads((ROOT / ".github/kafka-cluster-topics.json").read_text())
topics_copy = json.loads((SELF_HOST / "init/kafka-topics.json").read_text())
if topics_src != topics_copy:
    fail("self-host/init/kafka-topics.json differs from .github/kafka-cluster-topics.json")

# --- report ----------------------------------------------------------------
if failures:
    print("self-host artifacts have drifted:\n", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    print(f"\n{len(failures)} problem(s).", file=sys.stderr)
    sys.exit(1)

print(f"self-host artifacts in sync: {len(wanted)} services, "
      f"{len(manifest['queues'])} queues, {len(manifest['buckets'])} buckets, "
      f"{len(manifest['tables'])} tables, {len(topics_src)} kafka topics")
