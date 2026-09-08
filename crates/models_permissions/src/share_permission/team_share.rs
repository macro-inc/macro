//! Transport-independent policy for explicit sharing with an entity owner's team.
//!
//! Entity services supply the verified acting identity and repository-derived facts.
//! An authorized command is conditional, not a durable authorization token: adapters
//! must reload and compare **all** expected facts under the shared transaction guard
//! before changing canonical state or grants. These types are internal, not wire models.

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use super::access_level::AccessLevel;

#[cfg(test)]
mod test;

/// Access levels permitted for an explicit team grant; ownership cannot be granted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamShareLevel {
    /// Read access.
    View,
    /// Read and comment access.
    Comment,
    /// Read, comment, and edit access.
    Edit,
}

impl TryFrom<AccessLevel> for TeamShareLevel {
    type Error = TeamSharePolicyError;

    fn try_from(value: AccessLevel) -> Result<Self, Self::Error> {
        match value {
            AccessLevel::View => Ok(Self::View),
            AccessLevel::Comment => Ok(Self::Comment),
            AccessLevel::Edit => Ok(Self::Edit),
            AccessLevel::Owner => Err(TeamSharePolicyError::InvalidLevel),
        }
    }
}

impl From<TeamShareLevel> for AccessLevel {
    fn from(value: TeamShareLevel) -> Self {
        match value {
            TeamShareLevel::View => Self::View,
            TeamShareLevel::Comment => Self::Comment,
            TeamShareLevel::Edit => Self::Edit,
        }
    }
}

/// A managed direct grant. Keeping team and level together prevents partial NULL state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TeamShareGrant {
    /// The team to which the canonical grant is attributed, even after owner departure.
    pub team_id: Uuid,
    /// The exact level, including any downgrade from an earlier grant.
    pub level: TeamShareLevel,
}

/// Authoritative repository facts for one entity, never inferred from effective access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamShareFacts {
    /// The entity whose ownership and sharing state were loaded.
    pub entity: Entity<'static>,
    /// Persisted actual owner, not an actor with an effective Owner grant.
    pub owner: MacroUserIdStr<'static>,
    /// The actual owner's current team membership, if any.
    pub owner_team_id: Option<Uuid>,
    /// Canonical explicit state; inherited or unexplained grants must not populate this.
    pub current: Option<TeamShareGrant>,
    /// The persisted nonnegative team-share revision (zero for an uninitialized row).
    pub revision: i64,
}

/// Inputs to normalize together before any writes, independent of REST or GraphQL.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TeamShareRequest {
    /// Omitted = preserve; explicit None = clear; explicit level = set exactly.
    pub access_level: Option<Option<AccessLevel>>,
    /// Optional compatibility toggle from an entity's legacy sharing API.
    pub legacy_enabled: Option<bool>,
}

/// A supplied operation approved by actual-owner policy using a snapshot of facts.
///
/// Fields are private so callers cannot construct or modify an authorized edit.
/// Persistence must recheck the entity, owner, membership, state, and revision under
/// the guard and fail on stale facts. It must atomically update the canonical state,
/// attributable grants, and revision, even for same-value updates and repeated clears.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedTeamShareCommand {
    expected: TeamShareFacts,
    target: Option<TeamShareGrant>,
    next_revision: i64,
}

impl AuthorizedTeamShareCommand {
    /// All facts the adapter must compare against a fresh guarded read.
    pub fn expected(&self) -> &TeamShareFacts {
        &self.expected
    }

    /// The desired explicit state. None clears only the previously managed grant.
    pub fn target(&self) -> Option<TeamShareGrant> {
        self.target
    }

    /// The revision to write atomically with this supplied operation.
    pub fn next_revision(&self) -> i64 {
        self.next_revision
    }
}

/// Domain failures; transport adapters decide their HTTP/GraphQL representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TeamSharePolicyError {
    /// The verified authorization context has no acting user identity.
    #[error("team sharing requires an acting user")]
    MissingActor,
    /// Effective access cannot substitute for actual ownership.
    #[error("only the actual owner may update team sharing")]
    NotOwner,
    /// Enabling requires the persisted owner's current team.
    #[error("the owner has no team to share with")]
    MissingTeam,
    /// Owner is not a valid team-share level.
    #[error("owner is not a permitted team-share level")]
    InvalidLevel,
    /// Explicit and legacy inputs disagree about whether sharing should be enabled.
    #[error("legacy and explicit team-share inputs contradict each other")]
    ContradictoryInputs,
    /// Persisted revision is negative or cannot be incremented safely.
    #[error("team-share revision is invalid or exhausted")]
    InvalidRevision,
}

/// Authorize and normalize a user edit, returning None only when both inputs are omitted.
///
/// The entity service supplies `acting_user` from its verified receipt's
/// `acting_user_id()`; it must not substitute the persisted owner for a missing actor.
/// Omission deliberately skips owner/team checks and causes no revision or grant writes.
/// Document legacy enable uses Edit; call legacy enable uses View. When both inputs
/// are supplied, the explicit level wins if their enabled/disabled states agree.
pub fn authorize_team_share(
    acting_user: Option<&MacroUserIdStr<'_>>,
    facts: &TeamShareFacts,
    request: TeamShareRequest,
    legacy_enable_default: TeamShareLevel,
) -> Result<Option<AuthorizedTeamShareCommand>, TeamSharePolicyError> {
    if request.access_level.is_none() && request.legacy_enabled.is_none() {
        return Ok(None);
    }

    let actor = acting_user.ok_or(TeamSharePolicyError::MissingActor)?;
    if actor != &facts.owner {
        return Err(TeamSharePolicyError::NotOwner);
    }

    let level = match request.access_level {
        Some(explicit) => {
            let level = explicit.map(TeamShareLevel::try_from).transpose()?;
            if let Some(enabled) = request.legacy_enabled
                && enabled != level.is_some()
            {
                return Err(TeamSharePolicyError::ContradictoryInputs);
            }
            level
        }
        None => match request.legacy_enabled {
            Some(true) => Some(
                facts
                    .current
                    .map_or(legacy_enable_default, |grant| grant.level),
            ),
            Some(false) | None => None,
        },
    };

    let target = level
        .map(|level| {
            let team_id = facts
                .owner_team_id
                .ok_or(TeamSharePolicyError::MissingTeam)?;
            Ok(TeamShareGrant { team_id, level })
        })
        .transpose()?;
    let next_revision = facts
        .revision
        .checked_add(1)
        .filter(|_| facts.revision >= 0)
        .ok_or(TeamSharePolicyError::InvalidRevision)?;

    Ok(Some(AuthorizedTeamShareCommand {
        expected: facts.clone(),
        target,
        next_revision,
    }))
}

/// Internal creation intent, separate from editing an existing entity as an owner.
///
/// The creation repository resolves this using the persisted creator's membership
/// under the guard and initializes permission state and grants in the same transaction.
/// It must not accept a client-supplied team as authoritative or reuse source consent
/// when copying. This intent must never be used to reshare an existing entity.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum TeamShareCreation {
    /// Ordinary creation and copies initialize NULL explicit sharing.
    #[default]
    Unshared,
    /// An explicitly shared task initializes Comment; missing membership is an error.
    ExplicitTask,
    /// A new call initializes View only if its creator currently belongs to a team.
    Call,
}

impl TeamShareCreation {
    /// Resolve initial state from authoritative membership within the creation transaction.
    pub fn resolve(
        self,
        owner_team_id: Option<Uuid>,
    ) -> Result<Option<TeamShareGrant>, TeamSharePolicyError> {
        match self {
            Self::Unshared => Ok(None),
            Self::ExplicitTask => Ok(Some(TeamShareGrant {
                team_id: owner_team_id.ok_or(TeamSharePolicyError::MissingTeam)?,
                level: TeamShareLevel::Comment,
            })),
            Self::Call => Ok(owner_team_id.map(|team_id| TeamShareGrant {
                team_id,
                level: TeamShareLevel::View,
            })),
        }
    }
}

/// Trusted lifecycle intent, not authenticated user authority and not a public input.
///
/// The lifecycle service establishes why cleanup is required (owner departure, team
/// deletion, or ownership transfer). Persistence rechecks the expected facts under
/// the guard, clears only attributable grants, and increments the revision atomically.
/// No acting identity or current membership is required. Compensation/restoration
/// needs its own guarded snapshot eligibility check, not an authorized user edit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamShareMaintenance {
    /// Clear canonical consent and its managed grant, including after membership is gone.
    Clear {
        /// Snapshot to compare before cleanup, retaining historical team attribution.
        expected: TeamShareFacts,
    },
}
