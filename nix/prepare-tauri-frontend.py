#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")


def load_bun_lock(path: Path):
    text = path.read_text()
    # Bun's text lockfile is JSON-like and allows trailing commas.
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def write_json(path: Path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def parse_package_spec(spec: str):
    at = spec.rfind("@")
    if at <= 0:
        return None
    return spec[:at], spec[at + 1 :]


def should_keep_specifier(spec: str) -> bool:
    return spec == "catalog" or spec.startswith(
        (
            "workspace:",
            "file:",
            "link:",
            "github:",
            "git+",
            "http:",
            "https:",
            "catalog:",
        )
    )


def build_resolutions(lock) -> dict[str, str]:
    resolutions = {}
    for key, value in lock.get("packages", {}).items():
        spec = value[0] if value else None
        if not isinstance(spec, str) or "@workspace:" in spec:
            continue
        if len(value) == 4 and value[1] == "":
            parsed = parse_package_spec(spec)
            if parsed and key == parsed[0]:
                resolutions[parsed[0]] = parsed[1]
    return resolutions


def pin_dependency_ranges(lock, resolutions: dict[str, str]) -> bool:
    changed = False

    def pin_deps(deps):
        nonlocal changed
        if not isinstance(deps, dict):
            return
        for name, spec in list(deps.items()):
            if not isinstance(spec, str) or should_keep_specifier(spec):
                continue
            version = resolutions.get(name)
            if version and spec != version:
                deps[name] = version
                changed = True

    for value in lock.get("packages", {}).values():
        for metadata in value:
            if isinstance(metadata, dict):
                for field in DEPENDENCY_FIELDS:
                    pin_deps(metadata.get(field))

    for workspace in lock.get("workspaces", {}).values():
        for field in DEPENDENCY_FIELDS:
            pin_deps(workspace.get(field))

    return changed


def update_package_json(path: Path, fn):
    package_json = json.loads(path.read_text())
    changed = fn(package_json)
    if changed:
        write_json(path, package_json)
    return changed


def pin_workspace_package_json(lock, resolutions: dict[str, str]) -> int:
    changed_files = 0
    for workspace_path in lock.get("workspaces", {}):
        package_json_path = ROOT / workspace_path / "package.json"
        if not package_json_path.exists():
            continue

        def update(package_json):
            changed = False
            for field in DEPENDENCY_FIELDS:
                deps = package_json.get(field)
                if not isinstance(deps, dict):
                    continue
                for name, spec in list(deps.items()):
                    if not isinstance(spec, str) or should_keep_specifier(spec):
                        continue
                    version = resolutions.get(name)
                    if version and spec != version:
                        deps[name] = version
                        changed = True
            return changed

        if update_package_json(package_json_path, update):
            changed_files += 1
    return changed_files


def remove_install_time_git_deps():
    # bun2nix fetches these Git dependencies, but Bun's install-time Git cache
    # keys do not match the generated cache keys reliably. Remove them from the
    # install graph and wire their fetched contents into node_modules in Nix.
    update_package_json(
        ROOT / "app/package.json",
        lambda package_json: package_json.get("dependencies", {}).pop("@inkibra/tauri-plugins", None) is not None,
    )
    update_package_json(
        ROOT / "app/packages/block-pdf/package.json",
        lambda package_json: package_json.get("dependencies", {}).pop("pdfjs-dist", None) is not None,
    )


def patch_vite_config():
    path = ROOT / "app/packages/app/vite.base.ts"
    text = path.read_text()
    needle = "      resolve: {\n        dedupe:"
    replacement = (
        "      resolve: {\n"
        "        alias: [\n"
        "          { find: /^@tauri-apps\\/api/, replacement: resolve(__dirname, '../../../node_modules/@tauri-apps/api') },\n"
        "        ],\n"
        "        dedupe:"
    )
    if replacement not in text:
        text = text.replace(needle, replacement)
        path.write_text(text)


lock_path = ROOT / "bun.lock"
lock = load_bun_lock(lock_path)
resolutions = build_resolutions(lock)
changed_lock = pin_dependency_ranges(lock, resolutions)
changed_files = pin_workspace_package_json(lock, resolutions)
if changed_lock:
    write_json(lock_path, lock)

remove_install_time_git_deps()
patch_vite_config()

print(
    f"Prepared Tauri frontend source; pinned {changed_files} package.json files"
    f"{' and bun.lock' if changed_lock else ''}",
    file=sys.stderr,
)
