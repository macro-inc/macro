//! Keeps workspace crates declared once, in the root `[workspace.dependencies]`.
//!
//! Every member gets a root entry `name = { path = "<dir>" }`, and members
//! depend on each other with `name = { workspace = true }` instead of a
//! relative `path`. Moving a crate then changes one root line, which this step
//! writes itself. Regenerate mode adds missing entries, corrects their paths,
//! sorts `members` one per line and rewrites any relative path dependency on a
//! member; check mode reports the root and each member manifest it would
//! change as drift.
//!
//! hakari writes the `workspace-hack` dependency lines, so they keep their
//! relative path and the hack crate gets no root entry.
//!
//! Inherited dependencies cannot turn default features off unless the root
//! entry does, so a root entry gets `default-features = false` when a
//! dependent disables the defaults of a crate that has any, and the dependents
//! that keep the defaults say `default-features = true`.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use guppy::graph::PackageGraph;
use toml_edit::{Array, DocumentMut, InlineTable, Item, Table, Value};

const ROOT_MANIFEST: &str = "Cargo.toml";

const MEMBER_BLOCK_COMMENT: &str = "\n# Workspace crates. `cargo x deps` keeps one entry per member, at its current\n# path; depend on them with `name = { workspace = true }`.\n";

const DEPENDENCY_TABLES: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];

/// A workspace member's manifest, with its directory relative to the root.
pub struct Member {
    pub name: String,
    pub dir: String,
    pub manifest: DocumentMut,
}

/// Normalizes the root and member manifests on disk (or, in check mode,
/// records the ones that would change). Returns whether any file changed.
pub fn run(graph: &PackageGraph, check: bool, drift: &mut Vec<String>) -> Result<bool> {
    let workspace = graph.workspace();
    let root_dir = workspace.root();
    let hack = workspace_hack_name(root_dir.as_std_path())?;

    let root_path = root_dir.join(ROOT_MANIFEST);
    let root_before =
        std::fs::read_to_string(&root_path).with_context(|| format!("reading {root_path}"))?;
    let mut root: DocumentMut = root_before
        .parse()
        .with_context(|| format!("parsing {root_path}"))?;

    let mut members = Vec::new();
    let mut before = Vec::new();
    for package in workspace.iter() {
        let path = package.manifest_path();
        let contents = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
        let dir = path
            .parent()
            .and_then(|dir| dir.strip_prefix(root_dir).ok())
            .with_context(|| format!("{path} is outside the workspace root"))?;
        members.push(Member {
            name: package.name().to_owned(),
            dir: dir.as_str().to_owned(),
            manifest: contents
                .parse()
                .with_context(|| format!("parsing {path}"))?,
        });
        before.push(contents);
    }

    normalize(&mut root, &mut members, &hack)?;

    let mut changed = false;
    let mut outputs = vec![(ROOT_MANIFEST.to_owned(), root_before, root.to_string())];
    for (member, contents) in members.iter().zip(before) {
        outputs.push((
            format!("{}/Cargo.toml", member.dir),
            contents,
            member.manifest.to_string(),
        ));
    }
    for (relative, contents, new_contents) in outputs {
        if contents == new_contents {
            continue;
        }
        changed = true;
        if check {
            drift.push(format!("{relative} (workspace crate dependencies)"));
        } else {
            let path = root_dir.join(&relative);
            std::fs::write(&path, new_contents).with_context(|| format!("writing {path}"))?;
            println!("updated {relative}");
        }
    }
    Ok(changed && !check)
}

fn workspace_hack_name(root_dir: &std::path::Path) -> Result<String> {
    let path = root_dir.join(hakari::summaries::DEFAULT_CONFIG_PATH);
    let contents =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let config: toml::Value =
        toml::from_str(&contents).with_context(|| format!("parsing {}", path.display()))?;
    config
        .get("hakari-package")
        .and_then(toml::Value::as_str)
        .map(str::to_owned)
        .with_context(|| format!("{} has no hakari-package", path.display()))
}

/// One relative path dependency of a member on another member.
struct PathDependency {
    key: String,
    target: String,
    default_features: bool,
}

/// Rewrites `root` and `members` in memory; see the module docs.
pub fn normalize(root: &mut DocumentMut, members: &mut [Member], hack: &str) -> Result<()> {
    let name_by_dir: BTreeMap<String, String> = members
        .iter()
        .map(|m| (m.dir.clone(), m.name.clone()))
        .collect();
    let dir_by_name: BTreeMap<String, String> = members
        .iter()
        .map(|m| (m.name.clone(), m.dir.clone()))
        .collect();
    let has_default_features: BTreeMap<String, bool> = members
        .iter()
        .map(|m| (m.name.clone(), declares_default_features(&m.manifest)))
        .collect();

    let mut path_dependencies = Vec::new();
    for member in members.iter() {
        for table in dependency_tables(&member.manifest) {
            for (key, item) in table.iter() {
                let Some(path) = dependency_path(item) else {
                    continue;
                };
                let resolved = join_relative(&member.dir, path);
                let Some(target) = name_by_dir.get(&resolved) else {
                    continue;
                };
                if target == hack {
                    continue;
                }
                let default_features = item
                    .get("default-features")
                    .or_else(|| item.get("default_features"))
                    .and_then(Item::as_bool)
                    .unwrap_or(true);
                path_dependencies.push(PathDependency {
                    key: key.to_owned(),
                    target: target.clone(),
                    default_features,
                });
            }
        }
    }

    // Root entry key → package. A key differs from its package only where a
    // dependent renames the crate.
    let mut entries: BTreeMap<String, String> = members
        .iter()
        .filter(|m| m.name != hack)
        .map(|m| (m.name.clone(), m.name.clone()))
        .collect();
    if let Some(existing) = root
        .get("workspace")
        .and_then(|workspace| workspace.get("dependencies"))
        .and_then(Item::as_table)
    {
        for (key, item) in existing.iter() {
            let package = item.get("package").and_then(Item::as_str).unwrap_or(key);
            if dependency_path(item).is_some()
                && dir_by_name.contains_key(package)
                && package != hack
            {
                entries.insert(key.to_owned(), package.to_owned());
            }
        }
    }
    let mut disables_defaults: BTreeSet<String> = BTreeSet::new();
    for dependency in &path_dependencies {
        if let Some(existing) = entries.insert(dependency.key.clone(), dependency.target.clone())
            && existing != dependency.target
        {
            bail!(
                "dependency key `{}` names both `{existing}` and `{}`",
                dependency.key,
                dependency.target
            );
        }
        if !dependency.default_features && has_default_features[&dependency.target] {
            disables_defaults.insert(dependency.key.clone());
        }
    }

    let workspace_dependencies = root
        .get_mut("workspace")
        .and_then(Item::as_table_mut)
        .context("root Cargo.toml has no [workspace]")?
        .entry("dependencies")
        .or_insert_with(|| Item::Table(Table::new()))
        .as_table_mut()
        .context("[workspace.dependencies] is not a table")?;
    write_root_entries(
        workspace_dependencies,
        &entries,
        &dir_by_name,
        &disables_defaults,
    )?;
    let root_disables_defaults: BTreeSet<String> = entries
        .keys()
        .filter(|key| {
            workspace_dependencies
                .get(key)
                .and_then(|entry| entry.get("default-features"))
                .and_then(Item::as_bool)
                == Some(false)
        })
        .cloned()
        .collect();

    sort_members(root)?;

    for member in members.iter_mut() {
        let dir = member.dir.clone();
        for table in dependency_tables_mut(&mut member.manifest) {
            let keys: Vec<String> = table.iter().map(|(key, _)| key.to_owned()).collect();
            for key in keys {
                let item = &table[key.as_str()];
                let Some(path) = dependency_path(item) else {
                    continue;
                };
                let resolved = join_relative(&dir, path);
                let Some(target) = name_by_dir.get(&resolved) else {
                    continue;
                };
                if target == hack {
                    continue;
                }
                let Some(original) = item.as_inline_table() else {
                    bail!(
                        "{dir}/Cargo.toml: write `{key}` as an inline table (`{key} = {{ path = ... }}`) so it can be rewritten"
                    );
                };
                let rewritten = inherited_dependency(
                    original,
                    has_default_features[target],
                    root_disables_defaults.contains(&key),
                )
                .with_context(|| format!("{dir}/Cargo.toml: dependency `{key}`"))?;
                table[key.as_str()] = Item::Value(Value::InlineTable(rewritten));
            }
        }
    }
    Ok(())
}

fn write_root_entries(
    workspace_dependencies: &mut Table,
    entries: &BTreeMap<String, String>,
    dir_by_name: &BTreeMap<String, String>,
    disables_defaults: &BTreeSet<String>,
) -> Result<()> {
    let mut block = Vec::new();
    for (key, package) in entries {
        let dir = &dir_by_name[package];
        let entry = match workspace_dependencies.remove(key) {
            Some(Item::Value(Value::InlineTable(mut entry))) if entry.contains_key("path") => {
                entry.insert("path", Value::from(dir.as_str()));
                entry
            }
            Some(_) => bail!(
                "[workspace.dependencies] `{key}` is not a path entry, but a workspace crate needs that key"
            ),
            None => {
                let mut entry = InlineTable::new();
                if key != package {
                    entry.insert("package", Value::from(package.as_str()));
                }
                entry.insert("path", Value::from(dir.as_str()));
                if disables_defaults.contains(key) {
                    entry.insert("default-features", Value::from(false));
                }
                entry
            }
        };
        block.push((key.clone(), entry));
    }
    for (index, (key, mut entry)) in block.into_iter().enumerate() {
        entry.fmt();
        workspace_dependencies.insert(&key, Item::Value(Value::InlineTable(entry)));
        let prefix = if index == 0 { MEMBER_BLOCK_COMMENT } else { "" };
        workspace_dependencies
            .key_mut(&key)
            .context("inserted key")?
            .leaf_decor_mut()
            .set_prefix(prefix);
    }
    Ok(())
}

fn inherited_dependency(
    original: &InlineTable,
    has_default_features: bool,
    root_disables_defaults: bool,
) -> Result<InlineTable> {
    let default_features = original
        .get("default-features")
        .or_else(|| original.get("default_features"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut rewritten = InlineTable::new();
    rewritten.insert("workspace", Value::from(true));
    if has_default_features && root_disables_defaults && default_features {
        rewritten.insert("default-features", Value::from(true));
    }
    if has_default_features && !root_disables_defaults && !default_features {
        bail!(
            "it turns default features off, but the root entry keeps them on; set `default-features = false` there"
        );
    }
    for (key, value) in original.iter() {
        if !matches!(
            key,
            "path" | "package" | "version" | "default-features" | "default_features"
        ) {
            rewritten.insert(key, value.clone());
        }
    }
    rewritten.fmt();
    *rewritten.decor_mut() = original.decor().clone();
    Ok(rewritten)
}

fn sort_members(root: &mut DocumentMut) -> Result<()> {
    let members = root["workspace"]
        .get_mut("members")
        .and_then(Item::as_array_mut)
        .context("[workspace] has no members array")?;
    let mut sorted: Vec<String> = members
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    if sorted.len() != members.len() {
        bail!("[workspace] members must all be strings");
    }
    sorted.sort();
    sorted.dedup();
    let mut array = Array::new();
    for member in sorted {
        let mut value = Value::from(member);
        value.decor_mut().set_prefix("\n  ");
        value.decor_mut().set_suffix("");
        array.push_formatted(value);
    }
    array.set_trailing_comma(true);
    array.set_trailing("\n");
    *members = array;
    Ok(())
}

fn declares_default_features(manifest: &DocumentMut) -> bool {
    manifest
        .get("features")
        .and_then(|features| features.get("default"))
        .and_then(Item::as_array)
        .is_some_and(|default| !default.is_empty())
}

fn dependency_path(item: &Item) -> Option<&str> {
    item.get("path").and_then(Item::as_str)
}

fn dependency_tables(manifest: &DocumentMut) -> Vec<&Table> {
    let mut tables: Vec<&Table> = DEPENDENCY_TABLES
        .iter()
        .filter_map(|name| manifest.get(name).and_then(Item::as_table))
        .collect();
    if let Some(targets) = manifest.get("target").and_then(Item::as_table) {
        for (_, target) in targets.iter() {
            tables.extend(
                DEPENDENCY_TABLES
                    .iter()
                    .filter_map(|name| target.get(name).and_then(Item::as_table)),
            );
        }
    }
    tables
}

fn dependency_tables_mut(manifest: &mut DocumentMut) -> Vec<&mut Table> {
    let mut tables = Vec::new();
    let mut targets = None;
    for (key, item) in manifest.as_table_mut().iter_mut() {
        if DEPENDENCY_TABLES.contains(&key.get()) {
            tables.extend(item.as_table_mut());
        } else if key.get() == "target" {
            targets = item.as_table_mut();
        }
    }
    if let Some(targets) = targets {
        for (_, target) in targets.iter_mut() {
            let Some(target) = target.as_table_mut() else {
                continue;
            };
            for (key, item) in target.iter_mut() {
                if DEPENDENCY_TABLES.contains(&key.get()) {
                    tables.extend(item.as_table_mut());
                }
            }
        }
    }
    tables
}

/// `dir` joined with a relative `path`, resolving `.` and `..` lexically.
fn join_relative(dir: &str, path: &str) -> String {
    let mut parts: Vec<&str> = dir.split('/').filter(|part| !part.is_empty()).collect();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_member_path_dependencies_to_root_entries() {
        let mut root: DocumentMut = r#"[workspace]
resolver = "2"
members = [
  "crates/b", "crates/a",
  "crates/workspace-hack",
  "services/app",
]

[workspace.dependencies]
serde = "1"
"#
        .parse()
        .unwrap();
        let mut members = vec![
            Member {
                name: "a".to_owned(),
                dir: "crates/a".to_owned(),
                manifest: r#"[package]
name = "a"

[features]
default = ["fast"]
fast = []
"#
                .parse()
                .unwrap(),
            },
            Member {
                name: "b".to_owned(),
                dir: "crates/b".to_owned(),
                manifest: r#"[package]
name = "b"

[dependencies]
a = { path = "../a", default-features = false, features = ["fast"] }
serde = { workspace = true }
workspace-hack = { version = "0.1", path = "../workspace-hack" }
"#
                .parse()
                .unwrap(),
            },
            Member {
                name: "workspace-hack".to_owned(),
                dir: "crates/workspace-hack".to_owned(),
                manifest: "[package]\nname = \"workspace-hack\"\n".parse().unwrap(),
            },
            Member {
                name: "app".to_owned(),
                dir: "services/app".to_owned(),
                manifest: r#"[package]
name = "app"

[dependencies]
a = { path = "../../crates/a", optional = true } # keeps its comment
b_renamed = { package = "b", path = "../../crates/b" }
outside = { path = "../../vendor/outside" }

[target.'cfg(unix)'.dev-dependencies]
b = { path = "../../crates/b", features = ["x"] }
"#
                .parse()
                .unwrap(),
            },
        ];

        normalize(&mut root, &mut members, "workspace-hack").unwrap();

        assert_eq!(
            root.to_string(),
            r#"[workspace]
resolver = "2"
members = [
  "crates/a",
  "crates/b",
  "crates/workspace-hack",
  "services/app",
]

[workspace.dependencies]
serde = "1"

# Workspace crates. `cargo x deps` keeps one entry per member, at its current
# path; depend on them with `name = { workspace = true }`.
a = { path = "crates/a", default-features = false }
app = { path = "services/app" }
b = { path = "crates/b" }
b_renamed = { package = "b", path = "crates/b" }
"#
        );
        assert_eq!(
            members[1].manifest.to_string(),
            r#"[package]
name = "b"

[dependencies]
a = { workspace = true, features = ["fast"] }
serde = { workspace = true }
workspace-hack = { version = "0.1", path = "../workspace-hack" }
"#
        );
        assert_eq!(
            members[3].manifest.to_string(),
            r#"[package]
name = "app"

[dependencies]
a = { workspace = true, default-features = true, optional = true } # keeps its comment
b_renamed = { workspace = true }
outside = { path = "../../vendor/outside" }

[target.'cfg(unix)'.dev-dependencies]
b = { workspace = true, features = ["x"] }
"#
        );

        let root_once = root.to_string();
        let members_once: Vec<String> = members.iter().map(|m| m.manifest.to_string()).collect();
        normalize(&mut root, &mut members, "workspace-hack").unwrap();
        assert_eq!(root.to_string(), root_once);
        assert_eq!(
            members
                .iter()
                .map(|m| m.manifest.to_string())
                .collect::<Vec<_>>(),
            members_once
        );
    }

    #[test]
    fn moves_a_root_entry_with_its_crate() {
        let mut root: DocumentMut = r#"[workspace]
members = [
  "crates/group/a",
]

[workspace.dependencies]
a = { path = "crates/a", default-features = false }
"#
        .parse()
        .unwrap();
        let mut members = vec![Member {
            name: "a".to_owned(),
            dir: "crates/group/a".to_owned(),
            manifest: "[package]\nname = \"a\"\n".parse().unwrap(),
        }];

        normalize(&mut root, &mut members, "workspace-hack").unwrap();

        assert_eq!(
            root.to_string(),
            r#"[workspace]
members = [
  "crates/group/a",
]

[workspace.dependencies]

# Workspace crates. `cargo x deps` keeps one entry per member, at its current
# path; depend on them with `name = { workspace = true }`.
a = { path = "crates/group/a", default-features = false }
"#
        );
    }

    #[test]
    fn rejects_disabling_defaults_the_root_entry_keeps() {
        let mut root: DocumentMut = r#"[workspace]
members = ["crates/a", "crates/b"]

[workspace.dependencies]
a = { path = "crates/a" }
"#
        .parse()
        .unwrap();
        let mut members = vec![
            Member {
                name: "a".to_owned(),
                dir: "crates/a".to_owned(),
                manifest: "[package]\nname = \"a\"\n\n[features]\ndefault = [\"fast\"]\nfast = []\n"
                    .parse()
                    .unwrap(),
            },
            Member {
                name: "b".to_owned(),
                dir: "crates/b".to_owned(),
                manifest: "[package]\nname = \"b\"\n\n[dependencies]\na = { path = \"../a\", default-features = false }\n"
                    .parse()
                    .unwrap(),
            },
        ];

        let error = normalize(&mut root, &mut members, "workspace-hack").unwrap_err();

        assert_eq!(
            format!("{error:#}"),
            "crates/b/Cargo.toml: dependency `a`: it turns default features off, but the root entry keeps them on; set `default-features = false` there"
        );
    }
}
