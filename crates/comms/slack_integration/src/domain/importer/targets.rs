//! Channel capabilities supplied by the worker composition root. Authorization
//! decisions remain in the importer; adapters recheck them under write locks.

use std::{collections::HashSet, future::Future};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{models::*, ports::PortResult};

#[cfg(test)]
mod test;

/// Actual channel visibility, including the deliberately forbidden public kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// Team channel; must belong to the importing team.
    Team(TeamId),
    /// Private channel; team provenance is held by the ledger, not the channel.
    Private,
    /// An exact two-person DM.
    DirectMessage,
    /// Never an acceptable archive target.
    Public,
}

/// Persisted channel facts, not facts claimed by the archive.
#[derive(Debug, Clone)]
pub struct TargetFacts {
    /// Candidate channel identity. Never return rejected facts in public progress.
    pub id: Uuid,
    /// Actual persisted visibility/team.
    pub kind: TargetKind,
    /// Complete membership (including leavers) for a DM; empty for other kinds.
    pub dm_members: HashSet<MacroUserIdStr<'static>>,
}

/// Requester's current active authority on a reused channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetAccess {
    /// No active membership.
    None,
    /// Can participate, but cannot grant new participants access.
    Participant,
    /// Can manage participants (channel owner or administrator).
    ManageParticipants,
}

/// Archive target policy, applied again to locked facts before grants or writes.
/// Provenance never overrides type/team compatibility. Private imports can grant
/// source members access, so ordinary membership alone is insufficient.
pub fn authorize_target(
    team: TeamId,
    source: ConversationKind,
    target: &TargetFacts,
    prior_import: bool,
    access: TargetAccess,
) -> PortResult<()> {
    let allowed = match (source, target.kind) {
        (ConversationKind::PublicChannel, TargetKind::Team(actual)) => actual == team,
        (
            ConversationKind::PrivateChannel | ConversationKind::GroupDirectMessage,
            TargetKind::Private,
        ) => prior_import || access == TargetAccess::ManageParticipants,
        (ConversationKind::DirectMessage, TargetKind::DirectMessage) => {
            target.dm_members.len() == 2 && (prior_import || access != TargetAccess::None)
        }
        _ => false,
    };
    if allowed {
        Ok(())
    } else {
        Err(ImportError::Unavailable.into())
    }
}

/// Silent creation and membership command, after source member resolution.
#[derive(Debug, Clone)]
pub struct TargetPlan {
    /// Canonical reserved identity; creation must not substitute a different DM.
    pub channel_id: Uuid,
    /// Source kind and identity used for authorization rechecks.
    pub metadata: ConversationMetadata,
    /// Import namespace.
    pub team_id: TeamId,
    /// Original requester (not necessarily a participant in a DM).
    pub requested_by: MacroUserIdStr<'static>,
    /// Owner on creation only. For DMs this is one of the exact pair.
    pub owner: MacroUserIdStr<'static>,
    /// Full deduplicated raw-email membership; includes the requesting owner
    /// only on new non-DMs. Reuse does not add an owner absent from source members.
    pub members: HashSet<MacroUserIdStr<'static>>,
    /// Name on creation only; group DMs use source member display names.
    pub name: String,
    /// Historical creation time on creation only.
    pub created_at: DateTime<Utc>,
}

/// Channel discovery and fenced silent persistence, implemented at composition.
/// No method may consult account/roster existence to resolve source membership.
pub trait ImportTargets: Send + Sync + 'static {
    /// Read an exact pair without modifying participants or creating a channel.
    fn find_dm(
        &self,
        pair: &[MacroUserIdStr<'static>; 2],
    ) -> impl Future<Output = PortResult<Option<TargetFacts>>> + Send;

    /// Read actual type/team/membership for a reserved identity.
    fn inspect(
        &self,
        channel: Uuid,
    ) -> impl Future<Output = PortResult<Option<TargetFacts>>> + Send;

    /// Idempotently create ONLY the reserved target, fenced by the lease. Preserve
    /// all existing settings/memberships on reuse. Return whether newly created.
    /// Pair races must fail closed if a different DM wins: never grant provenance
    /// to an unrelated DM or silently retarget a committed reservation.
    fn create(
        &self,
        lease: &Lease,
        plan: &TargetPlan,
    ) -> impl Future<Output = PortResult<(TargetFacts, bool)>> + Send;

    /// Recheck compatibility and authorization under the fence, silently insert
    /// members without demoting/reactivating existing members, and bind progress to
    /// this authorized target. No DM participants may be added or removed here.
    /// Persist warnings idempotently. The channel/ledger operations are recoverable.
    fn bind(
        &self,
        lease: &Lease,
        plan: &TargetPlan,
        warnings: &[ImportWarning],
    ) -> impl Future<Output = PortResult<()>> + Send;

    /// Persist a sanitized resolution warning under the lease without a target ID.
    fn warn(
        &self,
        lease: &Lease,
        warning: ImportWarning,
    ) -> impl Future<Output = PortResult<()>> + Send;
}
