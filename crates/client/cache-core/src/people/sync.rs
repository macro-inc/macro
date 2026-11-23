//! Bounded membership verification for the existing contact backfill lane.
#[cfg(any(test, feature = "schema"))]
use super::MAX_PEOPLE_BATCH;
use crate::{
    engine::HydrationScope,
    value::{CacheValue, EntityKey, Record},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Keyset enumeration of existing normalized records, not a directory snapshot.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct ContactScan {
    /// Raw record-id cursor; never a membership identity.
    pub after: Option<String>,
    /// At most 500 records visited, including malformed/context-only records.
    #[cfg_attr(any(test, feature = "schema"), schemars(range(min = 1, max = MAX_PEOPLE_BATCH)))]
    pub limit: usize,
}
/// Capture write admission, optionally enumerating one bounded cached-ID window.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct ContactSnapshotRequest {
    /// Account/storage generation; this read never binds an account.
    pub scope: HydrationScope,
    /// None captures only the fence, without reading contacts.
    pub scan: Option<ContactScan>,
}
/// No record payloads or private names cross this boundary.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct ContactSnapshot {
    /// Single-use write fence; engine replacement and contact writes invalidate it.
    pub fence: Uuid,
    /// Canonical identities read from viewer-scoped membership records.
    #[cfg_attr(any(test, feature = "schema"), schemars(with = "Vec<String>", length(max = MAX_PEOPLE_BATCH)))]
    pub ids: Vec<MacroUserIdStr<'static>>,
    /// Last raw position when more records remain; empty pages may continue.
    pub next_cursor: Option<String>,
    /// Malformed membership is not evidence of absence or a complete sweep.
    pub incomplete: bool,
}
/// An exact, successful server lookup, never omissions from paged hydration.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct ContactReconcile {
    /// Captured before fetching the authoritative response.
    pub scope: HydrationScope,
    /// Contact-write fence captured with the requested IDs.
    pub fence: Uuid,
    /// Authenticated response identity; cannot differ from scope.identity.
    pub viewer: String,
    /// Exact requested IDs, bounded before deduplication.
    #[cfg_attr(any(test, feature = "schema"), schemars(with = "Vec<String>", length(max = MAX_PEOPLE_BATCH)))]
    pub requested: Vec<MacroUserIdStr<'static>>,
    /// Members returned by that lookup; must be a subset of requested.
    #[cfg_attr(any(test, feature = "schema"), schemars(with = "Vec<String>", length(max = MAX_PEOPLE_BATCH)))]
    pub present: Vec<MacroUserIdStr<'static>>,
}

/// Interpretation of one cached contact record.
pub enum CachedMembership {
    /// A viewer-scoped server membership identity.
    Member(MacroUserIdStr<'static>),
    /// Context stub or another viewer's record, never membership.
    NotMember,
    /// Incomplete membership cannot prove a complete verification pass.
    Incomplete,
}
/// Extract a membership identity; local ranking stubs never become members.
pub fn cached_member(viewer: &str, key: &EntityKey<'_>, record: &Record) -> CachedMembership {
    let Some(CacheValue::String(id)) = record.fields.get("userId") else {
        return if record.fields.contains_key("name") || record.fields.contains_key("email") {
            CachedMembership::Incomplete
        } else {
            CachedMembership::NotMember
        };
    };
    if id.len() > 1024 {
        return CachedMembership::Incomplete;
    }
    let Ok(id) = MacroUserIdStr::parse_from_str(id) else {
        return CachedMembership::Incomplete;
    };
    if super::contact_key(viewer, id.as_ref()).as_ref() != key.as_ref() {
        return CachedMembership::NotMember;
    }
    CachedMembership::Member(id.into_owned())
}
