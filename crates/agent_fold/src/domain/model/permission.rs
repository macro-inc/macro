//! Permission requests: the options offered and how the request resolved.

use serde::Serialize;
use specta::Type;

/// One choice offered for a permission request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    /// The id to report back when this option is chosen.
    pub id: String,
    /// Label to show.
    pub name: String,
    /// What kind of choice this is.
    pub kind: PermissionOptionKind,
}

/// What kind of choice a [`PermissionOption`] offers, mirroring ACP's
/// `PermissionOptionKind`.
///
/// ACP's enum is `#[non_exhaustive]`, but unlike [`StopReason`] there is no
/// wire string worth preserving for a variant this fold does not model: the
/// fold only ever sees one of these once the whole permission request has
/// already deserialized successfully, and a wire value ACP added after this
/// was written would have failed that deserialize already - so an unmatched
/// kind here cannot happen in practice, not "happens and is rendered
/// unlabeled."
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKind {
    /// Allow this operation only this time.
    AllowOnce,
    /// Allow this operation and remember the choice.
    AllowAlways,
    /// Reject this operation only this time.
    RejectOnce,
    /// Reject this operation and remember the choice.
    RejectAlways,
}

/// How a permission request has resolved so far.
///
/// Not just "chosen or not": nothing chosen has more than one cause, and a
/// reader deciding whether to still show the options needs to tell them
/// apart. [`Self::Pending`] may still resolve; [`Self::Errored`] and
/// [`Self::Unrecognized`] have already resolved, just not into anything this
/// fold can show as a choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionOutcome {
    /// No response has arrived yet - the request is still outstanding.
    Pending,
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        #[serde(rename = "optionId")]
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
    /// The response was a JSON-RPC error rather than a result: the harness
    /// failed to answer the request rather than resolving it.
    Errored,
    /// A result arrived, but this fold could not make sense of it - a
    /// payload that did not match ACP's response shape, or an outcome ACP
    /// added after this was written.
    Unrecognized,
}
