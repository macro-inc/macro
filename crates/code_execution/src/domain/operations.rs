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
}

static FINGERPRINT: LazyLock<String> = LazyLock::new(|| {
    serde_json::from_str::<SdkTypes>(SDK_TYPES)
        .expect("generated SDK declarations")
        .fingerprint
});

/// The SDK declarations as generated: `{"fingerprint": …, "files": {path: text}}`.
pub(crate) const SDK_TYPES: &str = include_str!("../outbound/deno/sdk-types.json");

/// Identifies the SDK's API shape: its version plus a hash of its
/// declarations. Code type-checked against one fingerprint stays valid until
/// the fingerprint changes.
pub fn sdk_fingerprint() -> &'static str {
    &FINGERPRINT
}
