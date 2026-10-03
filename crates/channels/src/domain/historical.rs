//! Trusted archive operations, separate from live channel side effects.
//!
//! The importing domain must authorize the team and any reused target before writing.
//! These persistence commands do not grant import authorization or record provenance.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::dm::DmPair;

/// Archive channels are never globally public. Private provenance lives in the importer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoricalChannelKind {
    /// Explicit-membership team channel, with auto-join disabled on creation.
    Team(Uuid),
    /// Private channel without a team foreign key.
    Private,
}

/// Creation with a durable, importer-reserved UUIDv7. Reuse must preserve settings.
#[derive(Debug, Clone)]
pub struct HistoricalChannel {
    /// Stable reservation ID, reused after crashes.
    pub id: Uuid,
    /// Name used only on initial creation.
    pub name: String,
    /// Target type and optional team identity.
    pub kind: HistoricalChannelKind,
    /// Importing administrator, used as owner only on initial creation.
    pub owner: MacroUserIdStr<'static>,
    /// Explicit source memberships, in addition to the new channel's owner.
    pub participants: HashSet<MacroUserIdStr<'static>>,
    /// Resolved source creation time, used only on initial creation.
    pub created_at: DateTime<Utc>,
}

/// Whether an atomic ensure operation actually created a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnsuredChannel {
    /// Canonical channel ID, which may differ from a proposed DM ID.
    pub id: Uuid,
    /// Only the creator may dispatch live creation effects.
    pub created: bool,
}

/// Creation policy for the shared, pair-locked DM primitive.
#[derive(Debug, Clone)]
pub enum DmCreation {
    /// Present-day creation with ordinary activity, owned by one member of the pair.
    Live(MacroUserIdStr<'static>),
    /// Silent historical creation. The normalized pair's first member owns the DM.
    Historical {
        /// Caller-reserved UUIDv7, used only when no exact pair already exists.
        id: Uuid,
        /// Source creation time; existing timestamps and memberships are untouched.
        created_at: DateTime<Utc>,
    },
}

impl DmCreation {
    /// Resolve ownership without ever introducing a third participant.
    pub fn owner<'a>(&'a self, pair: &'a DmPair) -> anyhow::Result<&'a MacroUserIdStr<'static>> {
        match self {
            Self::Live(owner) if owner == pair.lo() || owner == pair.hi() => Ok(owner),
            Self::Live(_) => anyhow::bail!("DM owner must belong to the pair"),
            Self::Historical { .. } => Ok(pair.lo()),
        }
    }
}
