//! The generated catalog of SDK operations and the declarations stored code is
//! type-checked against, both built from `packages/code-mode-sdk` by
//! `code_mode_assets`.

use serde::Deserialize;
use std::{collections::BTreeMap, ops::Bound, sync::LazyLock};

/// One generated SDK operation.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    /// Generic label, e.g. "Archive Thread". Never carries arguments.
    pub label: String,
    /// HTTP method, uppercase.
    pub method: String,
    /// Path template, e.g. `/email/threads/{id}`.
    pub path: String,
    /// Whether it can change anything: every operation except GET and the
    /// catalog's known reads.
    pub write: bool,
}

static OPERATIONS: LazyLock<BTreeMap<String, Operation>> = LazyLock::new(|| {
    serde_json::from_str(code_mode_assets::OPERATIONS).expect("generated operation catalog")
});

/// Every SDK operation, keyed `service.operation`.
pub fn operations() -> &'static BTreeMap<String, Operation> {
    &OPERATIONS
}

#[derive(Deserialize)]
struct SdkTypes {
    fingerprint: String,
    files: BTreeMap<String, String>,
}

static SDK: LazyLock<SdkTypes> =
    LazyLock::new(|| serde_json::from_str(SDK_TYPES).expect("generated SDK declarations"));

/// The SDK declarations as generated: `{"fingerprint": …, "files": {path: text}}`.
pub(crate) const SDK_TYPES: &str = code_mode_assets::SDK_TYPES;

/// Identifies the SDK's API shape: its version plus a hash of its
/// declarations. Code type-checked against one fingerprint stays valid until
/// the fingerprint changes.
pub fn sdk_fingerprint() -> &'static str {
    &SDK.fingerprint
}

/// The SDK declaration files that declare any of `names` as a class,
/// interface or type, in the order the names come, as `(path, text)` and
/// within `budget` bytes in all: what a model fixing code against the SDK
/// needs to read.
pub fn sdk_declarations(names: &[&str], budget: usize) -> Vec<(&'static str, &'static str)> {
    let mut found: Vec<(&'static str, &'static str)> = Vec::new();
    let mut used = 0;
    for name in names {
        let patterns: Vec<String> = ["class ", "interface ", "type "]
            .iter()
            .flat_map(|kind| [" ", "<", " ="].map(|end| format!("{kind}{name}{end}")))
            .collect();
        let declares = |text: &str| patterns.iter().any(|pattern| text.contains(pattern));
        for (path, text) in &SDK.files {
            if found.iter().any(|(seen, _)| *seen == path.as_str()) || !declares(text) {
                continue;
            }
            if used + text.len() <= budget {
                used += text.len();
                found.push((path.as_str(), text.as_str()));
            }
        }
    }
    found
}

/// The SDK declaration files directly in `directory`, such as
/// `src/entities/tasks/`, by path, without its tests' declarations.
pub fn sdk_declaration_files(directory: &str) -> Vec<(&'static str, &'static str)> {
    SDK.files
        .range::<str, _>((Bound::Included(directory), Bound::Unbounded))
        .map_while(|(path, text)| Some((path, path.strip_prefix(directory)?, text)))
        .filter(|(_, rest, _)| !rest.contains('/') && !rest.ends_with(".test.d.ts"))
        .map(|(path, _, text)| (path.as_str(), text.as_str()))
        .collect()
}

/// The public members of the SDK class or interface `name`, its own in
/// declaration order and then those it inherits, or `None` when the SDK
/// declares no class or interface by that name.
pub fn sdk_members(name: &str) -> Option<Vec<&'static str>> {
    let mut members = Vec::new();
    let mut next = Some(name.to_owned());
    // A short chain: `Task` extends `Document`, which extends a base.
    for depth in 0..4 {
        let Some(current) = next.take() else { break };
        let Some((own, base)) = declared_members(&current) else {
            if depth == 0 {
                return None;
            }
            break;
        };
        for member in own {
            if !members.contains(&member) {
                members.push(member);
            }
        }
        next = base;
    }
    Some(members)
}

/// The members `name`'s own declaration lists, and the class or interface
/// it extends, if any.
fn declared_members(name: &str) -> Option<(Vec<&'static str>, Option<String>)> {
    let headers = [
        format!("declare class {name} "),
        format!("declare class {name}<"),
        format!("interface {name} "),
        format!("interface {name}<"),
    ];
    SDK.files.values().find_map(|text| {
        let mut lines = text.lines();
        let header = lines.find(|line| {
            let line = line.trim_start_matches("export ");
            headers
                .iter()
                .any(|header| line.starts_with(header.as_str()))
        })?;
        let base = header.split_once(" extends ").and_then(|(_, rest)| {
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(rest.len());
            (end > 0).then(|| rest[..end].to_owned())
        });
        let mut members: Vec<&'static str> = Vec::new();
        for line in lines.take_while(|line| !line.starts_with('}')) {
            let Some(member) = line.strip_prefix("    ") else {
                continue;
            };
            if member.starts_with(' ')
                || ["private ", "protected ", "constructor("]
                    .iter()
                    .any(|hidden| member.starts_with(hidden))
            {
                continue;
            }
            let member = ["static ", "readonly ", "get ", "set ", "async "]
                .iter()
                .fold(member, |member, modifier| {
                    member.strip_prefix(modifier).unwrap_or(member)
                });
            let end = member
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$'))
                .unwrap_or(member.len());
            let identifier = &member[..end];
            if !identifier.is_empty() && !members.contains(&identifier) {
                members.push(identifier);
            }
        }
        Some((members, base))
    })
}

#[cfg(test)]
mod test;
