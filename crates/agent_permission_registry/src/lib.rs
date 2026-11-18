//! Agent permissions' operation registry: every Macro SDK operation, keyed by
//! its service (the spec name, e.g. `storage`) and operationId (e.g.
//! `create_task_handler`), the key the OCaml call analyzer reports, with the
//! permission group it belongs to, its action and a label a person reads.
//!
//! The data is `registry.json` in this crate. The web app reads the same file
//! (`@agent-permission-registry`), and the OCaml SDK's
//! `analyzer/test/test_registry.ml` fails when an operation of the generated
//! SDK is missing from it or it names one that no longer exists.

use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

#[cfg(test)]
mod test;

/// What an operation does to its group's data, the unit a person allows,
/// asks about or refuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Create,
    Read,
    Update,
    /// Deletes or permanently removes something.
    Destroy,
    /// Reaches other people: sends a message or email, invites, shares,
    /// changes what guests see.
    Send,
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
    pub action: Action,
    /// What it does, e.g. "Send email".
    pub label: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    groups: Vec<Group>,
    /// service -> operationId -> classification
    operations: BTreeMap<String, BTreeMap<String, Operation>>,
}

const REGISTRY_JSON: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/registry.json"));

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
