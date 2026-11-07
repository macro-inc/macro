"""Run the real mover against tracked sources, without Cargo or a dev shell."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


MOVER = Path(os.environ.get('CRATE_MOVER', Path(__file__).with_name('move_crates.py'))).resolve()


class ResourceMoves(unittest.TestCase):
    def move(self, source, expected, *, filename='src/domain/model.rs', extra=None, extra_expected=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                'crate/Cargo.toml': '[package]\nname="demo"\nversion="0.1.0"\n',
                'crate/core/Cargo.toml': '[package]\nname="demo_core"\nversion="0.1.0"\n',
                'crate/' + filename: source,
                **(extra or {}),
            }
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            mapping = root / 'moves.txt'
            mapping.write_text('crate/src/domain crate/core/src\n')
            command = [sys.executable, '-B', str(MOVER), str(mapping)]
            subprocess.run(command, cwd=root, capture_output=True, check=True)
            destination = root / ('crate/' + filename.replace('src/domain', 'core/src'))
            self.assertEqual(destination.read_text(), expected)
            for name, original in (extra or {}).items():
                destination_extra = root / name.replace('crate/src/domain', 'crate/core/src')
                self.assertEqual(destination_extra.read_text(), (extra_expected or {}).get(name, original))
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file() and '.git' not in p.parts}
            subprocess.run(command[:3] + ['--rewrite-only', str(mapping)], cwd=root, capture_output=True, check=True)
            after = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file() and '.git' not in p.parts}
            self.assertEqual(before, after, 'rewrite-only must not apply depth changes twice')

    def test_validation_strings_and_rust_rest_are_data(self):
        source = '''fn validate(branch: &str) { assert!(!branch.contains("..")); }
const INVALID: &str = "../task";
const RAW: &str = r#"../task"#;
const BYTE: &[u8] = b"../task";
const RAW_BYTE: &[u8] = br##".."##;
const ROOT_DATA: &str = "crate/src/domain is a captured message";
fn f(x: S) { match x { S { field, .. } => {} } let _ = 1..; }
let p = Path::new("../task"); // runtime user data, not a compile resource
'''
        self.move(source, source)

    def test_resource_literals_and_multiline_arguments(self):
        source = '''const A: &str = include_str!("../example.md");
const B: &[u8] = include_bytes!(br#"../example.md"#);
include!{ "../generated.rs" }
std::include_str!("../example.md");
#[path = "../generated.rs"] mod generated;
insta::glob!("../../fixtures", "*.jsonl", |p| {});
#[sqlx::test(
    migrations = "../migrations",
    fixtures(path = "../../fixtures", scripts("../data"))
)] fn test() {}
#[sqlx::test(fixtures("../a.sql", "../b.sql"))] fn positional() {}
let m = sqlx::migrate!("../migrations");
'''
        expected = source.replace('"../example.md"', '"../../src/example.md"').replace('"../generated.rs"', '"../../src/generated.rs"').replace('"../../fixtures"', '"../../fixtures"').replace('"../migrations"', '"../../migrations"').replace('"../a.sql"', '"../../src/a.sql"').replace('"../b.sql"', '"../../src/b.sql"')
        self.move(source, expected, extra={'crate/src/example.md': 'example\n', 'crate/src/generated.rs': 'fn g() {}\n', 'crate/fixtures/record.jsonl': '{"data":"../task"}\n'})

    def test_manifest_expression_and_binding(self):
        source = '''let manifest = PathBuf::from(
    env::var_os("CARGO_MANIFEST_DIR")
        .ok_or_else(|| Error::other("Cargo did not set CARGO_MANIFEST_DIR"))?,
);
let root = manifest.join("../resources");
let root = Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("../resources");
let resource = concat!(env!("CARGO_MANIFEST_DIR"),
    "/../resources");
'''
        self.move(source, source.replace('"../resources"', '"../../resources"').replace('"/../resources"', '"/../../resources"'))

    def test_spoofing_comments_strings_and_wrong_argument(self):
        source = '''// include_str!("../task")
/* outer /* include_str!("../task") */ ../task */
const TEXT: &str = r#"include_str!("../task")"#;
let error = ("CARGO_MANIFEST_DIR", "../task");
let error = Path::new(env("CARGO_MANIFEST_DIR")).join("../task");
let error = concat!("CARGO_MANIFEST_DIR", "../task");
let data = other!("../task");
insta::glob!("../../fixtures", "../task", |p| {});
include_str("../task"); value.include_str("../task");
let q = "../task"; include_str!("../real.md");
'''
        self.move(source, source.replace('include_str!("../real.md")', 'include_str!("../../src/real.md")'))

    def test_shadowed_or_mutable_manifest_binding_does_not_authorize_data(self):
        source = '''let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
{ let manifest = Path::new("user"); let x = manifest.join("../task"); }
let mut mutable = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
mutable = PathBuf::from("user"); let y = mutable.join("../task");
fn f(manifest: &Path) { manifest.join("../task"); }
for manifest in paths { manifest.join("../task"); }
let closure = |manifest: &Path| { manifest.join("../task"); };
let closure = |manifest: &Path| manifest.join("../task");
if let Some(manifest) = other { manifest.join("../task"); }
let (manifest, other) = values; manifest.join("../task");
let manifest = PathBuf::from("user"); let z = manifest.join("../task");
'''
        self.move(source, source)

    def test_recorded_data_and_applied_migrations_remain_exact(self):
        self.move('fn f() {}\n', 'fn f() {}\n', extra={
            'crate/src/domain/fixtures/real.jsonl': '{"path":"crate/src/domain", "input":"../task"}\n',
            'crate/src/domain/record.sse': 'data: crate/src/domain ../task\n',
            'crate/src/domain/migrations/old.sql': "SELECT '../task';\n",
        })

    def test_markdown_links_move_but_commands_and_code_do_not(self):
        source = '''See [resource](../example.md) and `../example.md`.
See [anchored](../example.md?raw=1#section).
[resource]: ../example.md
From `fuzz/`, run `cargo +nightly fuzz run target corpus/target ../tests/fixtures`.
```rust
let x = StackOptions { .. };
call("../task");
```
~~~text
../example.md
~~~
An ellipsis .. and `..` are data. Reject invalid task ID `../task`.
````markdown
```rust
let x = S { .. };
```
[not a resource](../data)
````
Inline link example: `[data](../task)`.
    [indented code](../task)
A multiline code span `
[code](../task)
` retains its data.


'''
        expected = source.replace('(../example.md)', '(../../src/example.md)').replace('[resource]: ../example.md', '[resource]: ../../src/example.md').replace('(../example.md?raw=1#section)', '(../../src/example.md?raw=1#section)')
        self.move(source, expected, filename='src/domain/AGENTS.md', extra={'crate/src/example.md': 'example\n'})

    def test_shell_structural_paths_move_while_embedded_code_is_exact(self):
        source = """#!/bin/sh
resource=../example.md
cat <<'RUST' > generated.rs
for attribute in attributes.drain(..) {
    validate("../task");
}
RUST
cat <<-FIRST <<SECOND
\t../task
\tFIRST
crate/src/domain ../task
SECOND
resource=../example.md
cat <<123
../task
123
cat <<''
../task

cat <<END-DATA
../task
END-DATA
cat <<E"OF"
../task
EOF
printf key#tag; cat <<EOF
../task
EOF
cat <<EOF \\
  >../output.txt
../task
EOF
printf '%s' "multiline
<<SPOOF
text"
resource=../example.md
"""
        expected = source.replace('resource=../example.md', 'resource=../../src/example.md').replace('>../output.txt', '>../../src/output.txt')
        self.move(source, expected, filename='src/domain/regen.sh', extra={'crate/src/example.md': 'example\n', 'crate/src/output.txt': ''})

    def test_pathless_quoted_heredoc_in_unmoved_tool_is_unchanged(self):
        script = """#!/usr/bin/env bash
# Run a local command ... after a constant host check.
until check "$(cat <<'HOST_CHECK'
awk '{ exit !($1 < 2) }' /proc/loadavg
HOST_CHECK
)"; do :; done
"""
        self.move('fn f() {}\n', 'fn f() {}\n', extra={'tooling/bench/timed.sh': script})

    def test_root_resource_remains_a_candidate(self):
        self.move('fn f() {}\n', 'fn f() {}\n',
            extra={'Cargo.toml': '[workspace]\nmembers=["crate/src/domain"]\n'},
            extra_expected={'Cargo.toml': '[workspace]\nmembers=["crate/core/src"]\n'})

    def test_justfile_directory_parent_remains_a_candidate(self):
        source = 'resource := "{{justfile_directory()}}/../example.md"\n'
        expected = 'resource := "{{justfile_directory()}}/../../src/example.md"\n'
        self.move(source, expected, filename='src/domain/justfile', extra={'crate/src/example.md': 'example\n'})

    def test_unsupported_quoted_substitution_refuses_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'value="$(cat <<\'EOF\'\n../task\nEOF\n)"\nvalue="`cat <<EOF\n../task\nEOF\n`"\n'
            script = root / 'crate/src/domain/regen.sh'
            script.parent.mkdir(parents=True)
            script.write_text(original)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            mapping = root / 'moves.txt'
            mapping.write_text('crate/src/domain crate/core/src\n')
            result = subprocess.run([sys.executable, '-B', str(MOVER), str(mapping)], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires explicit inspection', result.stderr)
            self.assertEqual(script.read_text(), original)
            self.assertFalse((root / 'crate/core').exists())
            script.write_text('value="`cat <<EOF\n../task\nEOF\n`"\n')
            result = subprocess.run([sys.executable, '-B', str(MOVER), str(mapping)], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires explicit inspection', result.stderr)
            self.assertFalse((root / 'crate/core').exists())

    def test_structural_manifest_and_just_paths_still_rewrite(self):
        source = '[dependencies]\nresource = { path = "../resource" }\n'
        self.move(source, source.replace('"../resource"', '"../../src/resource"'), filename='src/domain/Cargo.toml')


class PackageRenames(unittest.TestCase):
    def test_structural_package_rename_preserves_captured_blobs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorded = {
                'crate/fixtures/real/record.jsonl': '{"path":"../model-entity", "dep":"model-entity"}\n',
                'crate/record.sse': 'data: model-entity ../model-entity\n',
                'crate/testdata/input.txt': 'model-entity\n',
                'crate/migrations/applied.sql': "SELECT 'model-entity';\n",
                'tooling/scripts/crate_moves/test_move_crates.py': Path(__file__).read_text(),
                'tooling/scripts/crate_moves/rename_packages.py': Path(__file__).with_name('rename_packages.py').read_text(),
                'tooling/scripts/crate_moves/maps/history.txt': 'model-entity=model_entity\n',
            }
            for name, content in {**recorded, 'crate/tests/package.rs': 'assert_eq!(env!("CARGO_PKG_NAME"), "model-entity");\n', 'Cargo.toml': '[dependencies]\nmodel-entity = { path="crates/model-entity" }\n'}.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            renamer = Path(os.environ.get('CRATE_RENAMER', Path(__file__).with_name('rename_packages.py'))).resolve()
            subprocess.run([sys.executable, '-B', str(renamer), 'model-entity=model_entity'], cwd=root, check=True, capture_output=True)
            self.assertEqual((root / 'Cargo.toml').read_text(), '[dependencies]\nmodel_entity = { path="crates/model_entity" }\n')
            self.assertEqual((root / 'crate/tests/package.rs').read_text(), 'assert_eq!(env!("CARGO_PKG_NAME"), "model_entity");\n')
            for name, content in recorded.items():
                self.assertEqual((root / name).read_bytes(), content.encode())


if __name__ == '__main__':
    unittest.main()
