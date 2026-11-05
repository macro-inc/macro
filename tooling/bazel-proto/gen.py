#!/usr/bin/env python3
"""Generate Bazel BUILD files for the Cargo workspace from `cargo metadata`.

Experiment only. Usage (from the repository root):
    cargo metadata --format-version 1 --locked --all-features \
        --filter-platform x86_64-unknown-linux-gnu > /tmp/meta.json
    python3 tooling/bazel-proto/gen.py /tmp/meta.json

Writes BUILD.bazel into every workspace package plus MODULE.bazel. Cargo stays the
source of truth; nothing here is hand-maintained per crate except FIXUPS.
"""
import json
import os
import re
import sys

# Packages with no Bazel target: sync_service's storage backends conflict under
# --all-features, and CI's suite already excludes it.
SKIP_TARGETS = {"sync_service", "bazel_all_features", "workspace-hack"}

# Files a crate reads from outside its own package at compile or test time.
MIGRATIONS = "//crates/macro_db_client:migrations"
SQLX = "//:sqlx_offline_data"

# Run-time reads the literal scan can't see, because the path is built up in code.
RUNTIME_DATA = {
    "databases_sql": ["//crates/database_sql:all_files"],
    "whatsapp_session_service": ["//tooling/xtask/crates/xtask_local:all_files"],
    "local_e2e_test_support": ["//tooling/seed_cli:all_files"],
}
ROOT_RUNTIME_DATA = {
    "whatsapp_session_service": ["infra/stacks/whatsapp-session-service"],
}


def rel(path, root):
    return os.path.relpath(path, root)


def bin_refs(bins, path):
    # The name may be used by a helper module, so read the whole tests directory.
    text = ""
    for base, _, files in os.walk(os.path.dirname(path)):
        for name in files:
            if name.endswith(".rs"):
                text += open(os.path.join(base, name), errors="replace").read()
    return [b for b in bins if f"CARGO_BIN_EXE_{b}" in text]


def bin_labels(bins, path):
    return [":" + b.replace("-", "_") + "_bin" for b in bin_refs(bins, path)]


def itest_env(base, bins, path):
    env = dict(base)
    for b in bin_refs(bins, path):
        env[f"CARGO_BIN_EXE_{b}"] = "$(rootpath :" + b.replace("-", "_") + "_bin)"
    return json.dumps(env, sort_keys=True)


def root_target(path):
    return "esc_" + re.sub(r"[^A-Za-z0-9_]", "_", path)


ESCAPE = re.compile(r'"/?((?:\.\./)+[^"\n{}]+)"')
ROOT_PATHS = set()


def scan_escapes(package_dir, root, package_dirs):
    """Labels of the packages whose files this crate reaches with ../ paths."""
    found = set()
    for base, dirs, files in os.walk(package_dir):
        dirs[:] = [d for d in dirs if d not in ("target", "node_modules")]
        for name in files:
            if not name.endswith(".rs"):
                continue
            path = os.path.join(base, name)
            try:
                text = open(path, errors="replace").read()
            except OSError:
                continue
            for literal in ESCAPE.findall(text):
                for start in (base, package_dir):
                    target = os.path.normpath(os.path.join(start, literal))
                    if not os.path.exists(target) or not target.startswith(root + os.sep):
                        continue
                    owner = target
                    while owner != root and rel(owner, root) not in package_dirs:
                        owner = os.path.dirname(owner)
                    if owner == root:
                        path_in_root = rel(target, root)
                        ROOT_PATHS.add(path_in_root)
                        found.add("//:" + root_target(path_in_root))
                    elif owner != package_dir:
                        found.add(f"//{rel(owner, root)}:all_files")
                    break
    return sorted(found)


def starlark_list(items, indent="        "):
    if not items:
        return "[]"
    body = "".join(f'{indent}"{item}",\n' for item in sorted(set(items)))
    return "[\n" + body + indent[:-4] + "]"


def write_all_features(meta, root):
    """A member enabling every feature, because crate_universe resolves default features only."""
    members = set(meta["workspace_members"])
    packages = {p["id"]: p for p in meta["packages"]}
    directory = "tooling/bazel-proto/all_features"
    lines = ["[package]", 'name = "bazel_all_features"', 'version = "0.0.0"', 'edition = "2024"', "publish = false", "", "[dependencies]"]
    for pid in sorted(members, key=lambda i: packages[i]["name"]):
        pkg = packages[pid]
        if pkg["name"] in SKIP_TARGETS:
            continue
        if not any(set(t["kind"]) & {"lib", "rlib", "proc-macro", "cdylib", "staticlib", "dylib"} for t in pkg["targets"]):
            continue
        path = os.path.relpath(os.path.dirname(pkg["manifest_path"]), os.path.join(root, directory))
        features = [f for f in pkg["features"] if f != "default"]
        lines.append(f'{json.dumps(pkg["name"])} = {{ path = {json.dumps(path)}, features = {json.dumps(features)} }}')
    os.makedirs(os.path.join(root, directory, "src"), exist_ok=True)
    open(os.path.join(root, directory, "src/lib.rs"), "w").close()
    with open(os.path.join(root, directory, "Cargo.toml"), "w") as f:
        f.write("\n".join(lines) + "\n")


def main():
    if sys.argv[1] == "--all-features-crate":
        meta = json.load(open(sys.argv[2]))
        write_all_features(meta, meta["workspace_root"])
        return
    meta = json.load(open(sys.argv[1]))
    root = meta["workspace_root"]
    members = set(meta["workspace_members"])
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}

    def pkg_dir(pid):
        return rel(os.path.dirname(packages[pid]["manifest_path"]), root)

    def lib_target(pid):
        for t in packages[pid]["targets"]:
            if set(t["kind"]) & {"lib", "rlib", "proc-macro", "cdylib", "staticlib", "dylib"}:
                return t
        return None

    def is_proc_macro(pid):
        t = lib_target(pid)
        return t is not None and "proc-macro" in t["kind"]

    def label(pid):
        p = packages[pid]
        if pid in members:
            return f"//{pkg_dir(pid)}:{crate_ident(lib_target(pid))}"
        return f"@crates//:{p['name']}-{p['version']}"

    def crate_ident(target):
        return target["name"].replace("-", "_")

    def deps_of(pid, kinds):
        """(deps, proc_macro_deps, aliases) for the dep kinds, None meaning normal."""
        deps, macros, aliases = [], [], {}
        for d in nodes[pid]["deps"]:
            if not any(k["kind"] in kinds for k in d["dep_kinds"]):
                continue
            dep_pid = d["pkg"]
            target = lib_target(dep_pid)
            # hakari's crate only unifies features, which crate_universe does globally.
            if target is None or packages[dep_pid]["name"] == "workspace-hack":
                continue
            lab = label(dep_pid)
            (macros if is_proc_macro(dep_pid) else deps).append(lab)
            if d["name"] != crate_ident(target):
                aliases[lab] = d["name"]
        return deps, macros, aliases

    package_dirs = {pkg_dir(pid) for pid in members} | {"tooling/bazel-proto"}
    manifests = []
    escape_count = 0
    stats = {"lib": 0, "bin": 0, "test": 0, "build_script": 0}
    for pid in sorted(members):
        pkg = packages[pid]
        directory = pkg_dir(pid)
        manifests.append(f"//{directory}:Cargo.toml" if directory != "." else "//:Cargo.toml")
        out = [
            'load("@rules_rust//rust:defs.bzl", "rust_binary", "rust_library", "rust_proc_macro", "rust_test")',
            'load("@rules_rust//cargo:defs.bzl", "cargo_build_script")',
            "",
            'package(default_visibility = ["//visibility:public"])',
            "",
            'exports_files(["Cargo.toml"])',
            "",
            'filegroup(name = "all_files", srcs = glob(["**"], exclude = ["BUILD.bazel", "target/**"]))',
            "",
        ]
        if directory == "crates/macro_db_client":
            out += ['filegroup(name = "migrations", srcs = glob(["migrations/**"]))', ""]

        if pkg["name"] in SKIP_TARGETS or pkg["name"] == "workspace-hack":
            write(root, directory, out)
            continue

        node = nodes[pid]
        features = node["features"]
        uses_sqlx = any(d["name"] == "sqlx" for d in pkg["dependencies"])
        escapes = scan_escapes(os.path.join(root, directory), root, package_dirs)
        escape_count += bool(escapes)
        if uses_sqlx and MIGRATIONS not in escapes and pkg["name"] != "macro_db_client":
            escapes.append(MIGRATIONS)
        escapes += RUNTIME_DATA.get(pkg["name"], [])
        for path_in_root in ROOT_RUNTIME_DATA.get(pkg["name"], []):
            ROOT_PATHS.add(path_in_root)
            escapes.append("//:" + root_target(path_in_root))
        extra_labels = list(escapes)
        if uses_sqlx:
            extra_labels += [SQLX, "//tooling/bazel-proto:fake_cargo.sh"]
        extra = " + " + json.dumps(extra_labels) if extra_labels else ""
        rustc_env = {"CARGO_MANIFEST_DIR": f"/proc/self/cwd/{directory}"}
        if uses_sqlx:
            rustc_env.update(
                {
                    "SQLX_OFFLINE": "true",
                    # sqlx runs CARGO with the manifest directory as its working directory.
                    "CARGO": "/proc/self/cwd/" + "../" * (directory.count("/") + 1) + "tooling/bazel-proto/fake_cargo.sh",
                    "BAZEL_WS_ROOT": "/proc/self/cwd",
                }
            )
        env = json.dumps(rustc_env, sort_keys=True)
        # .sqlx leaves out test-only queries: tests compile against live Postgres, as CI does.
        test_rustc = dict(rustc_env)
        if uses_sqlx:
            test_rustc["SQLX_OFFLINE"] = "false"
            test_rustc["DATABASE_URL"] = os.environ["BAZEL_PROTO_DB_URL"]
        test_env = json.dumps(test_rustc, sort_keys=True)
        bins = [t["name"] for t in pkg["targets"] if "bin" in t["kind"]]
        test_data = 'glob(["**"], exclude = ["BUILD.bazel", "target/**"])' + (
            " + " + json.dumps(escapes) if escapes else ""
        )
        common = (
            f'    edition = "{pkg["edition"]}",\n'
            f'    version = "{pkg["version"]}",\n'
            f"    crate_features = {starlark_list(features)},\n"
            f'    compile_data = glob(["**"], exclude = ["BUILD.bazel", "target/**"]){extra},\n'
            f"    rustc_env = {env},\n"
        )
        normal, normal_macros, normal_alias = deps_of(pid, {None})
        dev, dev_macros, dev_alias = deps_of(pid, {None, "dev"})

        build_script = next((t for t in pkg["targets"] if "custom-build" in t["kind"]), None)
        script_deps = []
        if build_script:
            stats["build_script"] += 1
            bdeps, bmacros, baliases = deps_of(pid, {"build"})
            out.append(
                "cargo_build_script(\n"
                '    name = "build_script",\n'
                f'    srcs = ["{rel(build_script["src_path"], os.path.dirname(pkg["manifest_path"]))}"],\n'
                f'    crate_root = "{rel(build_script["src_path"], os.path.dirname(pkg["manifest_path"]))}",\n'
                f'    edition = "{pkg["edition"]}",\n'
                f'    version = "{pkg["version"]}",\n'
                f"    crate_features = {starlark_list(features)},\n"
                f"    deps = {starlark_list(bdeps)},\n"
                f"    proc_macro_deps = {starlark_list(bmacros)},\n"
                f"    aliases = {json.dumps(baliases, sort_keys=True)},\n"
                f"    data = {test_data},\n"
                ")\n"
            )
            script_deps = [":build_script"]

        srcs = 'glob(["**/*.rs"], exclude = ["target/**"])'
        lib = lib_target(pid)
        if lib:
            rule = "rust_proc_macro" if "proc-macro" in lib["kind"] else "rust_library"
            stats["lib"] += 1
            out.append(
                f"{rule}(\n"
                f'    name = "{crate_ident(lib)}",\n'
                f"    srcs = {srcs},\n"
                f'    crate_root = "{rel(lib["src_path"], os.path.dirname(pkg["manifest_path"]))}",\n'
                + common
                + f"    deps = {starlark_list(normal + script_deps)},\n"
                f"    proc_macro_deps = {starlark_list(normal_macros)},\n"
                f"    aliases = {json.dumps(normal_alias, sort_keys=True)},\n"
                ")\n"
            )
            if lib["test"]:
                stats["test"] += 1
                out.append(
                    "rust_test(\n"
                    f'    name = "{crate_ident(lib)}_unit",\n'
                    f'    crate = ":{crate_ident(lib)}",\n'
                    f"    crate_features = {starlark_list(features)},\n"
                    f"    rustc_env = {test_env},\n"
                    f"    deps = {starlark_list(sorted(set(dev) - set(normal)))},\n"
                    f"    proc_macro_deps = {starlark_list(sorted(set(dev_macros) - set(normal_macros)))},\n"
                    f"    aliases = {json.dumps(dev_alias, sort_keys=True)},\n"
                    f"    data = {test_data},\n"
                    f'    env = {{"CARGO_MANIFEST_DIR": "/proc/self/cwd/{directory}", "INSTA_WORKSPACE_ROOT": "/proc/self/cwd", "INSTA_UPDATE": "no"}},\n'
                    ")\n"
                )
        own = [f":{crate_ident(lib)}"] if lib and "proc-macro" not in lib["kind"] else []
        own_macros = [f":{crate_ident(lib)}"] if lib and "proc-macro" in lib["kind"] else []
        for t in pkg["targets"]:
            kind = t["kind"]
            path = rel(t["src_path"], os.path.dirname(pkg["manifest_path"]))
            if "bin" in kind:
                stats["bin"] += 1
                name = t["name"].replace("-", "_") + "_bin"
                out.append(
                    "rust_binary(\n"
                    f'    name = "{name}",\n'
                    f"    srcs = {srcs},\n"
                    f'    crate_name = "{crate_ident(t)}",\n'
                    f'    crate_root = "{path}",\n'
                    + common
                    + f"    deps = {starlark_list(normal + own + script_deps)},\n"
                    f"    proc_macro_deps = {starlark_list(normal_macros + own_macros)},\n"
                    f"    aliases = {json.dumps(normal_alias, sort_keys=True)},\n"
                    ")\n"
                )
            elif "test" in kind:
                stats["test"] += 1
                name = t["name"].replace("-", "_") + "_itest"
                out.append(
                    "rust_test(\n"
                    f'    name = "{name}",\n'
                    f'    srcs = depset(["{path}"] + glob(["tests/**/*.rs"])).to_list(),\n'
                    f'    crate_name = "{crate_ident(t)}",\n'
                    f'    crate_root = "{path}",\n'
                    + common.replace(
                        f"    rustc_env = {env},\n",
                        "    rustc_env = " + itest_env(test_rustc, bins, os.path.join(root, directory, path)) + ",\n",
                    )
                    + f"    deps = {starlark_list(dev + own + script_deps)},\n"
                    f"    proc_macro_deps = {starlark_list(dev_macros + own_macros)},\n"
                    f"    aliases = {json.dumps(dev_alias, sort_keys=True)},\n"
                    f"    data = {test_data} + {json.dumps(bin_labels(bins, os.path.join(root, directory, path)))},\n"
                    f'    env = {{"CARGO_MANIFEST_DIR": "/proc/self/cwd/{directory}", "INSTA_WORKSPACE_ROOT": "/proc/self/cwd", "INSTA_UPDATE": "no"}},\n'
                    ")\n"
                )
        write(root, directory, out)

    # Root package: the offline query cache and root manifests.
    root_build = os.path.join(root, "BUILD.bazel")
    if "." not in {pkg_dir(pid) for pid in members}:
        with open(root_build, "w") as f:
            f.write(
                'package(default_visibility = ["//visibility:public"])\n\n'
                'exports_files(["Cargo.toml", "Cargo.lock"])\n\n'
                'filegroup(name = "sqlx_offline_data", srcs = glob([".sqlx/**"]))\n\n'
                + "".join(
                    f'\nfilegroup(name = "{root_target(p)}", srcs = glob(["{p}", "{p}/**"], allow_empty = True))\n'
                    for p in sorted(ROOT_PATHS)
                )
            )
    manifests.append("//:Cargo.toml")

    with open(os.path.join(root, "MODULE.bazel"), "w") as f:
        f.write(MODULE.replace("@MANIFESTS@", starlark_list(manifests, "        ")))
    print(stats, "manifests", len(manifests), "crates reading across packages", escape_count)


def write(root, directory, lines):
    with open(os.path.join(root, directory, "BUILD.bazel"), "w") as f:
        f.write("\n".join(lines) + "\n")


MODULE = r"""module(name = "macro_ci_proto")

bazel_dep(name = "rules_rust", version = "0.75.0")
bazel_dep(name = "platforms", version = "1.0.0")

rust = use_extension("@rules_rust//rust:extensions.bzl", "rust")
rust.toolchain(
    edition = "2024",
    versions = ["1.94.0"],
)
use_repo(rust, "rust_toolchains")

register_toolchains("@rust_toolchains//:all")

crate = use_extension("@rules_rust//crate_universe:extensions.bzl", "crate")
crate.from_cargo(
    name = "crates",
    cargo_lockfile = "//:Cargo.lock",
    manifests = @MANIFESTS@,
    supported_platform_triples = ["x86_64-unknown-linux-gnu"],
)
crate.annotation(
    crate = "openssl-sys",
    build_script_env = {"OPENSSL_NO_VENDOR": "1"},
)
use_repo(crate, "crates")
"""

if __name__ == "__main__":
    main()
