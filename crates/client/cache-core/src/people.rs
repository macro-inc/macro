//! Bounded, context-aware person ranking. Local facts never establish directory membership.

use crate::{engine::HydrationScope, value::EntityKey};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) const CONTEXT_FIELD: &str = "__contact_search_context_v1";
pub(crate) const CONTEXT_META: &str = "__meta:contact-search-context-v1";
/// Hard limit on context patches, excluded people, and returned people.
pub const MAX_PEOPLE_BATCH: usize = 500;

/// The one-to-one conversation a command result opens, with its visible name
/// and viewed-first recency. Group DMs do not occupy this slot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectMessageFacts {
    /// Conversation identity.
    pub id: Uuid,
    /// Visible conversation label, independent of the contact's private name.
    pub name: String,
    /// Viewed-first command ordering timestamp.
    pub timestamp_ms: i64,
}

/// Client-owned ranking facts from the existing channels and email-link sources.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonFacts {
    /// Legacy user/recipient interaction timestamp, not relationship updated_at.
    pub last_interaction_ms: Option<i64>,
    /// Optional command-row substitution.
    pub direct_message: Option<DirectMessageFacts>,
    /// Connected secondary inboxes do not appear as recipient/person suggestions.
    pub secondary_inbox: bool,
}

/// One bounded, explicit fact update. The server still owns contact names/membership.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonFactPatch {
    /// Canonical target user identity.
    pub user_id: MacroUserIdStr<'static>,
    /// Complete replacement of this person's local facts.
    pub facts: PersonFacts,
}

/// Publication is separate from batching, so incomplete snapshots never look ready.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ContextAction {
    /// Start a full snapshot. Old per-record epochs are ignored after publication.
    Begin {
        /// Compare-and-set predecessor; a delayed begin cannot supersede newer work.
        #[serde(rename = "previousEpoch")]
        previous_epoch: Option<Uuid>,
    },
    /// Apply at most 500 updates. Ready epochs also accept serial incremental patches.
    Patch {
        /// Explicit bounded updates.
        updates: Vec<PersonFactPatch>,
    },
    /// Publish the complete snapshot.
    Commit,
}

/// A serial producer must start a new epoch after an uncertain write outcome.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextUpdate {
    /// Account/storage admission fence.
    pub scope: HydrationScope,
    /// Producer snapshot identity; stale patches cannot change a newer snapshot.
    pub epoch: Uuid,
    /// Snapshot lifecycle operation.
    pub action: ContextAction,
}

/// Surface-specific priorities applied before limiting results.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PeopleMode {
    /// Exact/prefix labels, then deterministic relevance/recency and DM boosts.
    Command,
    /// Exact addresses, address prefixes, word prefixes, then recipient weights.
    Recipient,
    /// Name/email relevance and user interaction recency for mentions.
    Mention,
}

/// Cursorless top-K query over the current cached directory, not a corpus-completeness claim.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeopleSearch {
    /// Account/storage fence.
    pub scope: HydrationScope,
    /// Surface ranking policy.
    pub mode: PeopleMode,
    /// Shared subsequence input, capped at 512 UTF-8 bytes.
    pub query: String,
    /// Explicit exclusions, applied before ranking (for example self).
    pub excluded: Vec<MacroUserIdStr<'static>>,
    /// Sending-account domain for recipient/mention preference.
    pub sender_domain: Option<String>,
    /// At most 500 winners.
    pub limit: usize,
    /// Injected wall clock for reproducible scoring.
    pub now_ms: i64,
}

/// Fully materialized winning person; neither the cache key nor DM id replaces user_id.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonHit {
    /// Viewer-scoped normalized key.
    pub record_key: EntityKey<'static>,
    /// Target user identity.
    pub user_id: MacroUserIdStr<'static>,
    /// Visible resolved contact name, with local-part email fallback.
    pub name: String,
    /// Target email address.
    pub email: String,
    /// User interaction timestamp for non-command surfaces.
    pub last_interaction_ms: Option<i64>,
    /// One-to-one command target, when present.
    pub direct_message: Option<DirectMessageFacts>,
    /// Priority tier; larger ranks precede smaller ones.
    pub match_rank: u8,
    /// Corpus-independent blended score within a priority tier.
    pub score: f64,
    /// Final recency tie-breaker.
    pub timestamp_ms: i64,
}

/// Local search can be temporarily unavailable without asserting an empty directory.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PeopleSearchResult {
    /// No complete local ranking-context snapshot is published.
    ContextPending,
    /// Bounded ranked results from the cache snapshot.
    Page {
        /// Fully materialized winners only.
        people: Vec<PersonHit>,
        /// Additional matches were seen; refining the query may reveal them.
        truncated: bool,
    },
}

/// Invalid input/state is rejected before changing stored facts.
#[derive(Debug, thiserror::Error)]
pub enum PeopleError {
    /// Input exceeds a public bound or contains an invalid label/domain.
    #[error("invalid bounded people request")]
    InvalidInput,
    /// The update belongs to a superseded context snapshot.
    #[error("contact search context changed")]
    StaleContext,
    /// Private metadata must decode rather than silently weaken exclusions.
    #[error("invalid contact context encoding: {0}")]
    Encoding(#[from] serde_json::Error),
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredFacts {
    pub epoch: Uuid,
    pub facts: PersonFacts,
}
/// Publication state of the cache-local context snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContextState {
    /// No context has been written in this storage generation.
    Missing,
    /// A full snapshot is being assembled in bounded batches.
    Building {
        /// Snapshot identity.
        epoch: Uuid,
    },
    /// A complete snapshot is available for ranking.
    Ready {
        /// Snapshot identity.
        epoch: Uuid,
    },
}
impl ContextState {
    /// Current snapshot identity, if one exists.
    pub fn epoch(&self) -> Option<Uuid> {
        match self {
            Self::Missing => None,
            Self::Building { epoch } | Self::Ready { epoch } => Some(*epoch),
        }
    }
}

pub(crate) fn contact_key(viewer: &str, user: &str) -> EntityKey<'static> {
    let namespace = Uuid::new_v5(&Uuid::NAMESPACE_OID, viewer.as_bytes());
    EntityKey::entity(
        "GraphqlContact",
        &[&Uuid::new_v5(&namespace, user.as_bytes()).to_string()],
    )
}

pub(crate) mod ranking;
