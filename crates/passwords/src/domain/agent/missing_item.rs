//! In-process authority and decision proof for a teammate's missing-item request.

use macro_authorization::{CredentialAttribution, CredentialOrigin, MacroUserAuthentication};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{AgentKind, AgentPolicy, DirectoryAgent};
use crate::domain::models::{Actor, ItemId, ItemKind, Permission, Record, TeamId};

/// The kind of item a teammate says it needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissingItemKind {
    /// An existing login can be selected by an authorized reviewer.
    Login,
    /// An existing API credential can be selected by an authorized reviewer.
    Api,
    /// The request needs human action. Card is a human-only vault kind.
    Card,
}

impl MissingItemKind {
    fn matches_agent_item(self, kind: &ItemKind) -> bool {
        matches!(
            (self, AgentKind::of(kind)),
            (Self::Login, Ok(AgentKind::Login)) | (Self::Api, Ok(AgentKind::Api))
        )
    }
}

/// Immutable request scope presented at review.
#[derive(Clone, PartialEq, Eq)]
pub struct MissingItemScope {
    /// This request's identifier.
    pub id: Uuid,
    /// Team whose vault is being reviewed.
    pub team: TeamId,
    /// The requesting teammate's account.
    pub agent: MacroUserIdStr<'static>,
    /// The exact requested kind.
    pub kind: MissingItemKind,
}

/// Current authority from the vault's human membership check.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HumanTeamRole {
    /// A current human member with no team-wide item management authority.
    Member,
    /// A current human team owner or administrator.
    Admin,
}

/// Trusted current facts supplied by the caller of this in-process proof.
pub struct CurrentReview<'a> {
    /// The verified user whose current facts were read.
    pub actor: &'a Actor,
    /// Team for which the human membership was checked.
    pub team: TeamId,
    /// Current role, absent if the account is an agent, is gone or lacks membership.
    pub human_role: Option<HumanTeamRole>,
    /// Both vault review flags are currently enabled for this human.
    pub review_enabled: bool,
    /// Fresh directory facts for the requesting teammate.
    pub agent: Option<&'a DirectoryAgent>,
}

/// Personal-session proof bound to one request and reviewer.
pub struct MissingItemReviewReceipt {
    scope: MissingItemScope,
    reviewer: Actor,
}

/// An existing item this reviewer may select.
#[derive(Debug, PartialEq, Eq)]
pub struct MissingItemCandidate {
    /// The item to name explicitly when adding.
    pub item: ItemId,
    /// Display name of this eligible item.
    pub name: String,
}

/// A human's explicit choice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissingItemDecision {
    /// Select an existing item and the intended capability explicitly.
    Add {
        /// Exact selected item.
        item: ItemId,
        /// Capability selected by the human.
        permission: Permission,
    },
    /// Decline this request.
    Decline,
}

/// Request status visible to an authorized reviewer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissingItemStatus {
    /// Waiting for a choice of an existing item or a decline.
    Pending,
    /// Waiting for human handling of a Card request.
    AwaitingHuman,
    /// An explicit choice is already recorded.
    Resolved,
}

/// Acknowledgement of an in-process decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecisionResult {
    /// Recorded this choice.
    Recorded,
    /// The same reviewer and intent already recorded this exact choice.
    Replayed,
}

/// A refused or unavailable operation with no request or item metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("request unavailable")]
pub struct RequestUnavailable;

struct Resolution {
    reviewer: Actor,
    intent: Uuid,
    decision: MissingItemDecision,
}

/// One admitted request and its single in-process decision.
pub struct MissingItemRequest {
    scope: MissingItemScope,
    addressed_to: MacroUserIdStr<'static>,
    resolution: Option<Resolution>,
}

fn matches_agent(scope: &MissingItemScope, facts: &DirectoryAgent) -> bool {
    facts.enabled
        && facts.computer_live
        && facts.team_id == scope.team
        && facts.agent_user_id == scope.agent
}

impl MissingItemRequest {
    /// Open a request from the teammate's own key and fresh directory facts.
    /// `agent_vault_enabled` represents both vault flags for that agent.
    /// The receipt checks the proposed reviewer against current human membership separately.
    pub fn open(
        scope: MissingItemScope,
        key: &MacroUserAuthentication,
        directory: &DirectoryAgent,
        agent_vault_enabled: bool,
        addressed_to: MacroUserIdStr<'static>,
    ) -> Result<Self, RequestUnavailable> {
        if key.origin != CredentialOrigin::UserApiKey
            || key.attribution() != CredentialAttribution::Person
            || key.macro_user_id != scope.agent
            || !agent_vault_enabled
            || !matches_agent(&scope, directory)
        {
            return Err(RequestUnavailable);
        }
        Ok(Self {
            scope,
            addressed_to,
            resolution: None,
        })
    }

    /// Issue a receipt only to a personal session with authority for the presented scope.
    pub fn review(
        &self,
        presented: &MissingItemScope,
        session: &MacroUserAuthentication,
        current: &CurrentReview<'_>,
    ) -> Result<MissingItemReviewReceipt, RequestUnavailable> {
        if !session.is_human_session() || session.attribution() != CredentialAttribution::Person {
            return Err(RequestUnavailable);
        }
        let receipt = MissingItemReviewReceipt {
            scope: presented.clone(),
            reviewer: Actor {
                user_id: session.macro_user_id.clone(),
            },
        };
        self.authorize(&receipt, current)?;
        Ok(receipt)
    }

    fn authorize(
        &self,
        receipt: &MissingItemReviewReceipt,
        current: &CurrentReview<'_>,
    ) -> Result<HumanTeamRole, RequestUnavailable> {
        let role = current.human_role.ok_or(RequestUnavailable)?;
        let reviewer = &receipt.reviewer.user_id;
        if receipt.scope != self.scope
            || current.team != self.scope.team
            || &current.actor.user_id != reviewer
            || reviewer == &self.scope.agent
            || !current.review_enabled
            || !current
                .agent
                .is_some_and(|agent| matches_agent(&self.scope, agent))
            || (role != HumanTeamRole::Admin && &self.addressed_to != reviewer)
        {
            return Err(RequestUnavailable);
        }
        Ok(role)
    }

    fn eligible(&self, record: &Record, reviewer: &Actor, role: HumanTeamRole) -> bool {
        !record.deleting
            && record.metadata.team_id == self.scope.team
            && self.scope.kind.matches_agent_item(&record.metadata.kind)
            && (record.user_id == reviewer.user_id || role == HumanTeamRole::Admin)
            && AgentPolicy::of(record, &self.scope.agent, None)
                .grant
                .is_none()
    }

    /// Read status after checking the viewer's current request authority.
    pub fn status(
        &self,
        receipt: &MissingItemReviewReceipt,
        current: &CurrentReview<'_>,
    ) -> Result<MissingItemStatus, RequestUnavailable> {
        self.authorize(receipt, current)?;
        Ok(match (&self.resolution, self.scope.kind) {
            (Some(_), _) => MissingItemStatus::Resolved,
            (None, MissingItemKind::Card) => MissingItemStatus::AwaitingHuman,
            (None, _) => MissingItemStatus::Pending,
        })
    }

    /// List only current matching items the human manages and the agent lacks.
    pub fn candidates(
        &self,
        receipt: &MissingItemReviewReceipt,
        current: &CurrentReview<'_>,
        records: &[Record],
    ) -> Result<Vec<MissingItemCandidate>, RequestUnavailable> {
        let role = self.authorize(receipt, current)?;
        if self.resolution.is_some() {
            return Ok(Vec::new());
        }
        Ok(records
            .iter()
            .filter(|record| self.eligible(record, &receipt.reviewer, role))
            .map(|record| MissingItemCandidate {
                item: record.metadata.id,
                name: record.metadata.name.clone(),
            })
            .collect())
    }

    /// Record a choice once under current request and item authorization.
    /// For Add, `record` must be the current item snapshot, independently
    /// resolved for this dispatch. The operation records only the decision.
    pub fn decide(
        &mut self,
        receipt: &MissingItemReviewReceipt,
        current: &CurrentReview<'_>,
        intent: Uuid,
        choice: MissingItemDecision,
        record: Option<&Record>,
    ) -> Result<DecisionResult, RequestUnavailable> {
        let role = self.authorize(receipt, current)?;
        match (choice, record) {
            (MissingItemDecision::Decline, None) => {}
            (MissingItemDecision::Add { item, .. }, Some(record))
                if item == record.metadata.id && self.eligible(record, &receipt.reviewer, role) => {
            }
            _ => return Err(RequestUnavailable),
        }

        if let Some(resolution) = &self.resolution {
            if resolution.intent == intent
                && resolution.decision == choice
                && resolution.reviewer.user_id == receipt.reviewer.user_id
            {
                return Ok(DecisionResult::Replayed);
            }
            return Err(RequestUnavailable);
        }
        self.resolution = Some(Resolution {
            intent,
            decision: choice,
            reviewer: receipt.reviewer.clone(),
        });
        Ok(DecisionResult::Recorded)
    }
}
