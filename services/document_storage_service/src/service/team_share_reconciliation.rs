//! Conservative, transport-independent policy for historical team-share reconciliation.

use model_entity::{Entity, EntityType};
use models_permissions::share_permission::{
    access_level::AccessLevel,
    team_share::{TeamShareFacts, TeamShareGrant, TeamShareLevel},
};

#[cfg(test)]
#[path = "team_share_reconciliation/test.rs"]
mod test;

/// A direct team grant. Inherited contributions are excluded by the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectGrant {
    pub team_id: String,
    pub level: AccessLevel,
}

/// Authoritative evidence read together under the canonical transaction guard.
/// Link sharing deliberately is not evidence of explicit sharing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub entity: Entity<'static>,
    pub facts: Option<TeamShareFacts>,
    pub direct_grants: Vec<DirectGrant>,
    /// Includes both active and archived rows, so disagreements cannot be hidden.
    pub call_flags: Vec<bool>,
    /// One extant current team and, for calls, consistent creator/permission rows.
    pub unambiguous_owner_team: bool,
}

/// Findings are independent: unknown extra grants remain visible on canonical roots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Finding {
    MissingOrInvalidFacts,
    OwnerGrant(DirectGrant),
    StaleTeamGrant(DirectGrant),
    UnknownDirectGrant(DirectGrant),
    CallFlagDisagreement,
    AmbiguousOwnerTeam,
    ProtectedRevision,
    StaleCanonicalTeam,
    CanonicalVerified,
    CanonicalGrantMismatch,
    ManagedDocumentCandidate,
    ManagedCallCandidate,
    LegacyCallMissingGrant,
}

/// Maintenance intent; never an authenticated user command or creation request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Adopt(TeamShareGrant),
    RepairLegacyCall(TeamShareGrant),
    RepairCanonical(TeamShareGrant),
}

impl Action {
    pub fn grant(self) -> TeamShareGrant {
        match self {
            Self::Adopt(grant) | Self::RepairLegacyCall(grant) | Self::RepairCanonical(grant) => {
                grant
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub findings: Vec<Finding>,
    pub action: Option<Action>,
}

/// Classify without mutating. Document provenance cannot be recovered from a team
/// grant alone: operators must verify IDs against historical writer/audit evidence.
/// A newer clear is authoritative even if unexplained historical grants remain.
pub fn classify(snapshot: &Snapshot, reviewed_document: bool) -> Classification {
    let mut result = Classification {
        findings: Vec::new(),
        action: None,
    };
    let Some(facts) = &snapshot.facts else {
        result.findings.push(Finding::MissingOrInvalidFacts);
        result
            .findings
            .extend(snapshot.direct_grants.iter().cloned().map(|grant| {
                if grant.level == AccessLevel::Owner {
                    Finding::OwnerGrant(grant)
                } else {
                    Finding::UnknownDirectGrant(grant)
                }
            }));
        return result;
    };
    let current_team = facts.owner_team_id.map(|id| id.to_string());
    let managed_team = facts.current.map(|grant| grant.team_id.to_string());
    for grant in &snapshot.direct_grants {
        if grant.level == AccessLevel::Owner {
            result.findings.push(Finding::OwnerGrant(grant.clone()));
        } else if Some(&grant.team_id) != current_team.as_ref() {
            result.findings.push(Finding::StaleTeamGrant(grant.clone()));
        } else if Some(&grant.team_id) != managed_team.as_ref() {
            result
                .findings
                .push(Finding::UnknownDirectGrant(grant.clone()));
        }
    }
    let is_call = snapshot.entity.entity_type == EntityType::Call;
    let flags_true =
        !snapshot.call_flags.is_empty() && snapshot.call_flags.iter().all(|flag| *flag);
    let flags_disagree = is_call
        && (snapshot.call_flags.is_empty()
            || snapshot
                .call_flags
                .iter()
                .any(|flag| *flag != snapshot.call_flags[0])
            || (facts.current.is_some() && !flags_true)
            || (facts.current.is_none() && !snapshot.direct_grants.is_empty() && !flags_true)
            || (facts.current.is_none() && facts.revision > 0 && flags_true));
    if flags_disagree {
        result.findings.push(Finding::CallFlagDisagreement);
    }

    if let Some(canonical) = facts.current {
        let direct = snapshot
            .direct_grants
            .iter()
            .find(|g| g.team_id == canonical.team_id.to_string());
        if direct.is_some_and(|g| g.level == AccessLevel::from(canonical.level)) {
            result.findings.push(Finding::CanonicalVerified);
        } else {
            result.findings.push(Finding::CanonicalGrantMismatch);
            if snapshot.unambiguous_owner_team
                && facts.owner_team_id == Some(canonical.team_id)
                && !flags_disagree
                && direct.is_none_or(|g| g.level != AccessLevel::Owner)
            {
                result.action = Some(Action::RepairCanonical(canonical));
            }
        }
        if facts.owner_team_id != Some(canonical.team_id) {
            result.findings.push(Finding::StaleCanonicalTeam);
        }
        return result;
    }
    if facts.revision != 0 {
        result.findings.push(Finding::ProtectedRevision);
        return result;
    }
    if !snapshot.unambiguous_owner_team {
        result.findings.push(Finding::AmbiguousOwnerTeam);
        return result;
    }
    let Some(team_id) = facts.owner_team_id else {
        return result;
    };
    if flags_disagree {
        return result;
    }
    let verified_kind = match snapshot.entity.entity_type {
        EntityType::Document => reviewed_document,
        EntityType::Call => flags_true,
        _ => false,
    };
    if !verified_kind {
        return result;
    }
    // A second/stale grant makes provenance ambiguous, even if one matches today.
    if let [direct] = snapshot.direct_grants.as_slice() {
        if direct.team_id == team_id.to_string()
            && let Ok(level) = TeamShareLevel::try_from(direct.level)
        {
            result
                .findings
                .retain(|f| !matches!(f, Finding::UnknownDirectGrant(_)));
            result.findings.push(if is_call {
                Finding::ManagedCallCandidate
            } else {
                Finding::ManagedDocumentCandidate
            });
            result.action = Some(Action::Adopt(TeamShareGrant { team_id, level }));
        }
    } else if snapshot.direct_grants.is_empty() && is_call {
        result.findings.push(Finding::LegacyCallMissingGrant);
        result.action = Some(Action::RepairLegacyCall(TeamShareGrant {
            team_id,
            level: TeamShareLevel::View,
        }));
    }
    result
}

/// Narrow port: guarded evidence, bounded keyset scan, and conditional maintenance.
#[allow(async_fn_in_trait)]
pub trait ReconciliationRepository {
    async fn scan(
        &self,
        after: &str,
        limit: i64,
    ) -> Result<Vec<Entity<'static>>, rootcause::Report>;
    async fn inspect(&self, entity: &Entity<'_>) -> Result<Snapshot, rootcause::Report>;
    /// False means evidence changed since inspection; no writes may be committed.
    async fn apply(&self, expected: &Snapshot, action: Action) -> Result<bool, rootcause::Report>;
}

pub struct Options {
    pub apply: bool,
    pub after: String,
    pub batch_size: i64,
    pub reviewed_documents: Vec<uuid::Uuid>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            apply: false,
            after: String::new(),
            batch_size: 100,
            reviewed_documents: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct Record {
    pub cursor: String,
    pub classification: Classification,
    pub applied: bool,
    pub changed_since_review: bool,
}

/// Stable lexical key used for checkpointing; restart from the beginning to verify.
pub fn cursor(entity: &Entity<'_>) -> String {
    format!("{}/{}", entity.entity_type.as_ref(), entity.entity_id)
}

/// Process at most one batch. Replaying a batch after a crash is safe.
pub async fn reconcile_batch(
    repository: &impl ReconciliationRepository,
    options: &Options,
) -> Result<Vec<Record>, rootcause::Report> {
    if !(1..=1000).contains(&options.batch_size) {
        return Err(rootcause::report!("batch size must be between 1 and 1000"));
    }
    let entities = repository.scan(&options.after, options.batch_size).await?;
    let mut records = Vec::with_capacity(entities.len());
    for entity in entities {
        let snapshot = repository.inspect(&entity).await?;
        let reviewed = options
            .reviewed_documents
            .iter()
            .any(|id| id.to_string() == entity.entity_id);
        let classification = classify(&snapshot, reviewed);
        let mut applied = false;
        let mut changed_since_review = false;
        if options.apply
            && let Some(action) = classification.action
        {
            applied = repository.apply(&snapshot, action).await?;
            changed_since_review = !applied;
        }
        records.push(Record {
            cursor: cursor(&entity),
            classification,
            applied,
            changed_since_review,
        });
    }
    Ok(records)
}
