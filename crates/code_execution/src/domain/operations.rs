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

/// The SDK root's declarations, what `import … from '@macro-inc/sdk'` reads.
const SDK_ROOT: &str = "src/macro.d.ts";

/// What a name the SDK root exports is, which decides how a program imports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RootExport {
    /// Only a type (`export type { … }`, an interface or a type alias):
    /// `import type`.
    Type,
    /// A value, or a class, which is also a type: a plain `import`.
    Value,
}

/// The names the SDK's root exports: its `export { … }` and
/// `export type { … }` lists, under the names it exports them as, and the
/// classes, interfaces and types it declares itself (`export declare class
/// Macro`).
static ROOT_EXPORTS: LazyLock<Vec<(&'static str, RootExport)>> = LazyLock::new(|| {
    use nom::Parser as _;
    use nom::branch::alt;
    use nom::bytes::complete::{tag, take_until, take_while1};
    use nom::combinator::opt;
    let Some(mut rest) = SDK.files.get(SDK_ROOT).map(String::as_str) else {
        return Vec::new();
    };
    let identifier = || take_while1::<_, &str, ()>(|c: char| c.is_ascii_alphanumeric() || c == '_');
    let mut names = Vec::new();
    while let Ok((after, _)) = take_until::<_, _, ()>("export ").parse(rest) {
        let after = &after["export ".len()..];
        let list = (opt(tag::<_, _, ()>("type ")), tag("{"), take_until("}")).parse(after);
        let declared = (
            opt(tag::<_, _, ()>("declare ")),
            alt((tag("class "), tag("interface "), tag("type "))),
            identifier(),
        )
            .parse(after);
        rest = match (list, declared) {
            (Ok((after_list, (type_only, _, inner))), _) => {
                names.extend(inner.split(',').filter_map(|item| {
                    let item = item.trim();
                    let (item, inline_type) = match item.strip_prefix("type ") {
                        Some(item) => (item, true),
                        None => (item, false),
                    };
                    let name = item.rsplit(" as ").next()?.trim();
                    let kind = if type_only.is_some() || inline_type {
                        RootExport::Type
                    } else {
                        RootExport::Value
                    };
                    (!name.is_empty()).then_some((name, kind))
                }));
                after_list
            }
            (_, Ok((after_name, (_, keyword, name)))) => {
                let kind = if keyword == "class " {
                    RootExport::Value
                } else {
                    RootExport::Type
                };
                names.push((name, kind));
                after_name
            }
            _ => after,
        };
    }
    names
});

/// How the SDK's root exports `name`, or `None` when it doesn't, so a
/// program knows how to import it from `@macro-inc/sdk`.
pub fn sdk_root_export(name: &str) -> Option<RootExport> {
    ROOT_EXPORTS
        .iter()
        .find(|(exported, _)| *exported == name)
        .map(|(_, kind)| *kind)
}

/// The values of the SDK's string-literal union type `name`, such as
/// `SortDirection`, in declaration order.
/// The SDK's own declarations (`src/`) win over a generated type of the same
/// name; `None` when the type is something else or its declarations disagree.
pub fn sdk_string_literals(name: &str) -> Option<Vec<&'static str>> {
    let header = format!("type {name} = ");
    let declared: Vec<(&str, Option<Vec<&'static str>>)> = SDK
        .files
        .iter()
        .flat_map(|(path, text)| {
            text.lines()
                .filter_map(|line| {
                    line.trim_start_matches("export ")
                        .strip_prefix(header.as_str())?
                        .strip_suffix(';')
                })
                .map(|union| (path.as_str(), string_union(union)))
        })
        .collect();
    let own: Vec<_> = declared
        .iter()
        .filter(|(path, _)| path.starts_with("src/"))
        .collect();
    let candidates = if own.is_empty() {
        declared.iter().collect()
    } else {
        own
    };
    let (_, first) = candidates.first()?;
    candidates
        .iter()
        .all(|(_, values)| values == first)
        .then(|| first.clone())
        .flatten()
}

/// `'a' | 'b'` (or `"a" | "b"`) as `["a", "b"]`, or `None` when any member
/// isn't a plain string.
fn string_union(union: &'static str) -> Option<Vec<&'static str>> {
    union
        .split(" | ")
        .map(|member| {
            ['\'', '"'].into_iter().find_map(|quote| {
                member
                    .strip_prefix(quote)?
                    .strip_suffix(quote)
                    .filter(|value| !value.contains(['\'', '"']))
            })
        })
        .collect()
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
