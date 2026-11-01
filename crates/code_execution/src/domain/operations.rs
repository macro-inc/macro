//! The generated catalog of SDK operations and the declarations stored code is
//! type-checked against, both from `packages/code-mode-sdk`.

use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

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
    serde_json::from_str(include_str!("operations.json")).expect("generated operation catalog")
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
pub(crate) const SDK_TYPES: &str = include_str!("../outbound/deno/sdk-types.json");

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
