//! Agent permissions' operation registry: every Macro SDK operation a JS
//! tools program can call, keyed by its service (the spec name, e.g.
//! `storage`) and operationId (e.g. `create_task_handler`), the key the JS
//! tools analyzer reports, with the permission group it belongs to, its
//! action and a label a person reads.
//!
//! The data is `registry.json` in this crate. The web app reads the same file
//! (`@agent-permission-registry`), and the JS tools catalog
//! (`packages/code-mode-sdk/src/js-tools/catalog.test.ts`) fails when one of
//! the catalog's tools is missing from it or it names an operation that is
//! not a tool.

#![deny(missing_docs)]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::LazyLock};

#[cfg(test)]
mod test;

/// What an operation does to its group's data, the unit a person allows,
/// asks about or refuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize, Serialize)]
#[cfg_attr(
    feature = "openapi",
    derive(utoipa::ToSchema, schemars::JsonSchema),
    schema(as = PermissionAction)
)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    /// Makes something new.
    Create,
    /// Reads, lists or searches; changes nothing.
    Read,
    /// Changes something that exists.
    Update,
    /// Deletes or permanently removes something.
    Destroy,
    /// Reaches other people: sends a message or email, invites, shares,
    /// changes what guests see.
    Send,
}

impl Action {
    /// Every action, in declaration order: for iterating, not showing.
    pub const ALL: [Action; 5] = [
        Action::Create,
        Action::Read,
        Action::Update,
        Action::Destroy,
        Action::Send,
    ];

    /// Every action, in the order a person sees them: Read, Create, Edit
    /// (`update`), Send, Delete (`destroy`).
    pub const DISPLAY: [Action; 5] = [
        Action::Read,
        Action::Create,
        Action::Update,
        Action::Send,
        Action::Destroy,
    ];

    /// The action's stored name, e.g. `destroy`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Action::Create => "create",
            Action::Read => "read",
            Action::Update => "update",
            Action::Destroy => "destroy",
            Action::Send => "send",
        }
    }

    /// The action named `name` (its stored name), if there is one.
    pub fn parse(name: &str) -> Option<Action> {
        Action::ALL
            .into_iter()
            .find(|action| action.as_str() == name)
    }
}

/// A user-facing area, e.g. Email.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    /// Stable id, e.g. `email`; what settings are stored under.
    pub id: String,
    /// Display name, e.g. "Email".
    pub name: String,
    /// One sentence on what the group covers.
    pub description: String,
}

/// One operation's classification.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    /// The [`Group::id`] it belongs to.
    pub group: String,
    /// What it does to the group's data.
    pub action: Action,
    /// What it does, e.g. "Send email".
    pub label: String,
    /// No setting applies to it: it is always allowed and not offered as a
    /// setting. Only for an operation that can only ever restrict the agent
    /// itself, which a setting could turn from always safe into gated.
    #[serde(default)]
    pub always_allowed: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    groups: Vec<Group>,
    /// service -> operationId -> classification
    operations: BTreeMap<String, BTreeMap<String, Operation>>,
}

const REGISTRY_JSON: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/registry.json"));

// The file is compiled in and its tests parse it, so a build that passes
// them cannot fail here.
static REGISTRY: LazyLock<Registry> = LazyLock::new(|| {
    serde_json::from_str(REGISTRY_JSON).expect("registry.json is checked by its tests")
});

/// Every group, in display order.
pub fn groups() -> &'static [Group] {
    &REGISTRY.groups
}

/// The group with this id.
pub fn group(id: &str) -> Option<&'static Group> {
    REGISTRY.groups.iter().find(|group| group.id == id)
}

/// The classification of `service`'s operation `operation_id`, or `None` for
/// an operation the registry does not know.
pub fn operation(service: &str, operation_id: &str) -> Option<&'static Operation> {
    REGISTRY.operations.get(service)?.get(operation_id)
}

/// Every operation as `(service, operation_id, classification)`, sorted by
/// service then operationId.
pub fn operations() -> impl Iterator<Item = (&'static str, &'static str, &'static Operation)> {
    REGISTRY
        .operations
        .iter()
        .flat_map(|(service, operations)| {
            operations.iter().map(move |(operation_id, operation)| {
                (service.as_str(), operation_id.as_str(), operation)
            })
        })
}

static VERSION: LazyLock<String> = LazyLock::new(|| {
    let digest = Sha256::digest(REGISTRY_JSON.as_bytes());
    digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect()
});

/// Which registry this build carries: the first 12 hex characters of the
/// sha256 of `registry.json`. It changes whenever a classification does.
pub fn version() -> &'static str {
    &VERSION
}
