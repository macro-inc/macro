//! `cargo x test-targets`
//!
//! Fails when the workspace builds a test binary that runs no test of its own,
//! or holds a test that no test binary runs.
//!
//! Cargo builds a test binary for every lib, bin and integration-test target with
//! `test = true` (the default), whether or not it holds a test. Each one
//! recompiles its module tree in test mode and links, so a service's openapi
//! bin that re-declares the service's modules costs a second full test build
//! of them. Three rules keep that from coming back:
//!
//! - A lib or bin with `test = true` holds a test that no other tested target of
//!   its package also compiles. Otherwise it sets `test = false`.
//! - A lib or bin with `test = false` holds no test that only it compiles; such a
//!   test would silently never run.
//! - A package has at most one tested integration-test target, `tests/it/main.rs`
//!   with one module per file, instead of one binary per `tests/*.rs`.
//!
//! The check is static. A target's files are its module tree, followed from
//! `mod` declarations (with `#[path]`). A file holds a test when its tokens
//! contain a test attribute (`#[test]`, `#[tokio::test]`, `#[sqlx::test]`,
//! `#[wasm_bindgen_test]`, ...) or a `proptest!` block, macro bodies included.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use anyhow::{Context, Result, bail};
use guppy::graph::{BuildTargetId, PackageGraph};
use proc_macro2::{Delimiter, TokenStream, TokenTree};
use xtask_graph::build_graph;

#[cfg(test)]
mod test;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        bail!("usage: cargo x test-targets");
    }

    // Read-only: `--locked` so the check never rewrites Cargo.lock.
    let graph = build_graph(true)?;
    let violations = check(&packages(&graph))?;
    if violations.is_empty() {
        return Ok(());
    }

    for violation in &violations {
        eprintln!("{violation}\n");
    }
    bail!("{} test target problem(s)", violations.len())
}

/// A workspace package and the targets `cargo test` can build.
struct Package {
    name: String,
    manifest: PathBuf,
    targets: Vec<Target>,
}

struct Target {
    kind: TargetKind,
    name: String,
    /// `test = true`: `cargo test` builds and runs its test binary.
    tested: bool,
    root: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TargetKind {
    Library,
    Binary,
    IntegrationTest,
}

impl fmt::Display for TargetKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            TargetKind::Library => "lib",
            TargetKind::Binary => "bin",
            TargetKind::IntegrationTest => "test",
        })
    }
}

enum Violation {
    /// A tested lib or bin whose every test another tested target already runs.
    RunsNoTestOfItsOwn {
        manifest: PathBuf,
        kind: TargetKind,
        target: String,
    },
    /// An untested lib or bin holding tests that no tested target compiles.
    TestsNeverRun {
        manifest: PathBuf,
        kind: TargetKind,
        target: String,
        files: Vec<PathBuf>,
    },
    /// More than one tested integration-test target in a package.
    SplitIntegrationTests {
        manifest: PathBuf,
        targets: Vec<String>,
    },
}

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Violation::RunsNoTestOfItsOwn {
                manifest,
                kind,
                target,
            } => write!(
                f,
                "{}: {kind} `{target}` builds a test binary that runs no test of its own. \
                 Set `test = false` on it.",
                manifest.display()
            ),
            Violation::TestsNeverRun {
                manifest,
                kind,
                target,
                files,
            } => {
                write!(
                    f,
                    "{}: {kind} `{target}` has `test = false`, so these tests never run. \
                     Remove `test = false`, or move them into a tested target:",
                    manifest.display()
                )?;
                for file in files {
                    write!(f, "\n  {}", file.display())?;
                }
                Ok(())
            }
            Violation::SplitIntegrationTests { manifest, targets } => write!(
                f,
                "{}: each of {} builds its own test binary. Move them into \
                 `tests/it/`, one module each, declared from `tests/it/main.rs`.",
                manifest.display(),
                targets.join(", ")
            ),
        }
    }
}

fn packages(graph: &PackageGraph) -> Vec<Package> {
    graph
        .workspace()
        .iter()
        .map(|package| Package {
            name: package.name().to_owned(),
            manifest: package.manifest_path().as_std_path().to_owned(),
            targets: package
                .build_targets()
                .filter_map(|target| {
                    let (kind, name) = match target.id() {
                        BuildTargetId::Library => (TargetKind::Library, package.name()),
                        BuildTargetId::Binary(name) => (TargetKind::Binary, name),
                        BuildTargetId::Test(name) => (TargetKind::IntegrationTest, name),
                        // Build scripts, examples and benches; `cargo test` runs none of them.
                        _ => return None,
                    };
                    Some(Target {
                        kind,
                        name: name.to_owned(),
                        tested: target.test_by_default(),
                        root: target.path().as_std_path().to_owned(),
                    })
                })
                .collect(),
        })
        .collect()
}

fn check(packages: &[Package]) -> Result<Vec<Violation>> {
    let mut holds_test = BTreeMap::new();
    let mut violations = Vec::new();
    for package in packages {
        check_package(package, &mut holds_test, &mut violations)
            .with_context(|| format!("checking package {}", package.name))?;
    }
    Ok(violations)
}

fn check_package(
    package: &Package,
    holds_test: &mut BTreeMap<PathBuf, bool>,
    violations: &mut Vec<Violation>,
) -> Result<()> {
    let mut test_files = Vec::new();
    for target in &package.targets {
        let mut files = BTreeSet::new();
        for file in module_files(&target.root)? {
            if file_holds_test(&file, holds_test)? {
                files.insert(file);
            }
        }
        test_files.push(files);
    }

    let tested_elsewhere = |index: usize| -> BTreeSet<&PathBuf> {
        package
            .targets
            .iter()
            .zip(&test_files)
            .enumerate()
            .filter(|(other, (target, _))| *other != index && target.tested)
            .flat_map(|(_, (_, files))| files)
            .collect()
    };

    for (index, (target, files)) in package.targets.iter().zip(&test_files).enumerate() {
        if target.kind == TargetKind::IntegrationTest {
            continue;
        }

        let elsewhere = tested_elsewhere(index);
        if target.tested && files.iter().all(|file| elsewhere.contains(file)) {
            violations.push(Violation::RunsNoTestOfItsOwn {
                manifest: package.manifest.clone(),
                kind: target.kind,
                target: target.name.clone(),
            });
        }

        let never_run: Vec<PathBuf> = files
            .iter()
            .filter(|file| !elsewhere.contains(file))
            .cloned()
            .collect();
        if !target.tested && !never_run.is_empty() {
            violations.push(Violation::TestsNeverRun {
                manifest: package.manifest.clone(),
                kind: target.kind,
                target: target.name.clone(),
                files: never_run,
            });
        }
    }

    let integration_tests: Vec<String> = package
        .targets
        .iter()
        .filter(|target| target.kind == TargetKind::IntegrationTest && target.tested)
        .map(|target| format!("`{}`", target.name))
        .collect();
    if integration_tests.len() > 1 {
        violations.push(Violation::SplitIntegrationTests {
            manifest: package.manifest.clone(),
            targets: integration_tests,
        });
    }
    Ok(())
}

/// The crate root and every file its `mod` declarations reach. A declared file
/// that doesn't exist belongs to a module compiled out by `cfg`, so it is skipped.
fn module_files(root: &Path) -> Result<BTreeSet<PathBuf>> {
    let mut files = BTreeSet::new();
    let mut pending = vec![(root.to_owned(), true)];
    while let Some((file, owns_directory)) = pending.pop() {
        if !file.exists() || !files.insert(file.clone()) {
            continue;
        }

        let source = std::fs::read_to_string(&file)
            .with_context(|| format!("reading {}", file.display()))?;
        let syntax =
            syn::parse_file(&source).with_context(|| format!("parsing {}", file.display()))?;
        let directory = file.parent().context("module file has no parent")?;
        // A crate root, `mod.rs` or `#[path]` file owns its directory; any other
        // `foo.rs` keeps its submodules in `foo/`.
        let children = if owns_directory || file.file_name().is_some_and(|name| name == "mod.rs") {
            directory.to_owned()
        } else {
            directory.join(file.file_stem().context("module file has no stem")?)
        };
        declared_modules(&syntax.items, directory, &children, &mut pending);
    }
    Ok(files)
}

/// Queue the files of the `mod` declarations in `items`. `path_base` resolves
/// `#[path]`, and `children` resolves the rest.
fn declared_modules(
    items: &[syn::Item],
    path_base: &Path,
    children: &Path,
    pending: &mut Vec<(PathBuf, bool)>,
) {
    for item in items {
        let syn::Item::Mod(module) = item else {
            continue;
        };

        let name = module.ident.to_string();
        let name = name.strip_prefix("r#").unwrap_or(&name);
        let path = module.attrs.iter().find_map(|attr| match &attr.meta {
            syn::Meta::NameValue(meta) if meta.path.is_ident("path") => match &meta.value {
                syn::Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(path),
                    ..
                }) => Some(path.value()),
                _ => None,
            },
            _ => None,
        });

        match (&module.content, path) {
            (Some((_, inline)), _) => {
                let nested = children.join(name);
                declared_modules(inline, &nested, &nested, pending);
            }
            (None, Some(path)) => pending.push((path_base.join(path), true)),
            (None, None) => {
                let file = children.join(format!("{name}.rs"));
                if file.exists() {
                    pending.push((file, false));
                } else {
                    pending.push((children.join(name).join("mod.rs"), true));
                }
            }
        }
    }
}

fn file_holds_test(file: &Path, holds_test: &mut BTreeMap<PathBuf, bool>) -> Result<bool> {
    if let Some(known) = holds_test.get(file) {
        return Ok(*known);
    }

    let source =
        std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?;
    let tokens = TokenStream::from_str(&source)
        .map_err(|error| anyhow::anyhow!("lexing {}: {error}", file.display()))?;
    let found = tokens_hold_test(tokens);
    holds_test.insert(file.to_owned(), found);
    Ok(found)
}

/// Whether `tokens` contain a test attribute or a `proptest!` invocation,
/// looking inside every group so `macro_rules!` bodies and inline modules count.
fn tokens_hold_test(tokens: TokenStream) -> bool {
    let tokens: Vec<TokenTree> = tokens.into_iter().collect();
    for (index, token) in tokens.iter().enumerate() {
        let next = tokens.get(index + 1);
        match (token, next) {
            (TokenTree::Punct(pound), Some(TokenTree::Group(attribute)))
                if pound.as_char() == '#'
                    && attribute.delimiter() == Delimiter::Bracket
                    && is_test_attribute(attribute.stream()) =>
            {
                return true;
            }
            (TokenTree::Ident(name), Some(TokenTree::Punct(bang)))
                if name == "proptest" && bang.as_char() == '!' =>
            {
                return true;
            }
            (TokenTree::Group(group), _) if tokens_hold_test(group.stream()) => return true,
            _ => {}
        }
    }
    false
}

/// `test`, `tokio::test(...)`, `wasm_bindgen_test` and the like: an attribute
/// path whose last segment is `test` or ends in `_test`.
fn is_test_attribute(attribute: TokenStream) -> bool {
    let mut last_segment = None;
    for token in attribute {
        match token {
            TokenTree::Ident(segment) => last_segment = Some(segment.to_string()),
            TokenTree::Punct(colon) if colon.as_char() == ':' => {}
            TokenTree::Group(arguments) if arguments.delimiter() == Delimiter::Parenthesis => {
                break;
            }
            _ => return false,
        }
    }
    last_segment.is_some_and(|segment| segment == "test" || segment.ends_with("_test"))
}
