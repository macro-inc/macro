//! Human review of agent access: list pending requests, resolve, revoke.
//! Reviewers are the item's current human creator or current team
//! administrators; the agent's responsible human gains no authority here.
use super::{AgentVaultService, SEARCH_MAX_LIMIT};
use crate::domain::{
    agent::{
        AgentAccessRequestPage, AgentAccessRequestState, AgentAccessRow, AgentAction, AgentError,
        AgentItemAccess, AgentPolicy, ResolveRequest, RevokeBody, RevokeScope, StoredRequestStatus,
        ports::*, request_state,
    },
    models::{Actor, Grant, GranteeKind, ItemId, Record, TeamId},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Review page parameters, parsed after admission.
pub enum ReviewQuery {
    /// The team's pending queue, by request id.
    Pending {
        /// Page size.
        limit: u8,
        /// Last request of the previous page.
        after: Option<Uuid>,
    },
    /// Every agent's access to one item, by agent id, for managing it.
    Item {
        /// Managed item.
        item: ItemId,
        /// Page size.
        limit: u8,
        /// Last agent of the previous page.
        after: Option<MacroUserIdStr<'static>>,
    },
}
impl ReviewQuery {
    /// Validate raw query parameters.
    pub fn parse(
        item: Option<String>,
        limit: Option<String>,
        cursor: Option<String>,
    ) -> Result<Self, AgentError> {
        let limit = match limit {
            None => super::SEARCH_DEFAULT_LIMIT,
            Some(limit) => limit.parse::<u8>().map_err(|_| AgentError::Invalid)?,
        };
        if limit == 0 || limit > SEARCH_MAX_LIMIT {
            return Err(AgentError::Invalid);
        }
        let Some(item) = item else {
            let after = cursor
                .map(|cursor| Uuid::parse_str(&cursor))
                .transpose()
                .map_err(|_| AgentError::Invalid)?;
            return Ok(Self::Pending { limit, after });
        };
        let item = Uuid::parse_str(&item)
            .map(ItemId)
            .map_err(|_| AgentError::Invalid)?;
        let after = cursor
            .map(|cursor| {
                MacroUserIdStr::parse_from_str(&cursor)
                    .map(macro_user_id::cowlike::CowLike::into_owned)
            })
            .transpose()
            .map_err(|_| AgentError::Invalid)?;
        Ok(Self::Item { item, limit, after })
    }
}

impl AgentVaultService {
    /// Human v1 admission plus the reviewer's own agent-vault rollout.
    async fn reviewer(&self, actor: &Actor, team: TeamId) -> Result<bool, AgentError> {
        self.vault.membership(actor, team).await?;
        if !self.availability.agent_vault_enabled(&actor.user_id).await {
            return Err(AgentError::NotFound);
        }
        Ok(self
            .vault
            .repository
            .is_team_admin(&actor.user_id, team)
            .await?)
    }

    /// The item, when this human may manage it now.
    async fn managed(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Record, AgentError> {
        let record = self.vault.access(actor, team, item, false).await?;
        let admin = self
            .vault
            .repository
            .is_team_admin(&actor.user_id, team)
            .await?;
        if record.user_id != actor.user_id && !admin {
            return Err(AgentError::Forbidden);
        }
        Ok(record)
    }

    /// Pending requests on items this human may manage, or, for one managed
    /// item, every agent holding an Agent grant or an access row on it (so a
    /// reviewer can revoke with the current permission revision after reload).
    #[tracing::instrument(skip_all, err, name = "passwords.agent.review.list", fields(team_id = %team.0))]
    pub async fn pending_requests(
        &self,
        actor: &Actor,
        team: TeamId,
        query: Result<ReviewQuery, AgentError>,
    ) -> Result<AgentAccessRequestPage, AgentError> {
        let admin = self.reviewer(actor, team).await?;
        let (limit, after) = match query? {
            ReviewQuery::Pending { limit, after } => (limit, after),
            ReviewQuery::Item { item, limit, after } => {
                return self.item_states(actor, team, item, limit, after).await;
            }
        };
        let creator = (!admin).then_some(&actor.user_id);
        let mut pending = self
            .agents
            .pending(team, creator, after, limit.saturating_add(1))
            .await?;
        let query_limit = limit;
        let next_cursor = if pending.len() > usize::from(query_limit) {
            pending.truncate(usize::from(query_limit));
            pending
                .last()
                .and_then(|request| request.row.request.as_ref())
                .map(|request| request.id.to_string())
        } else {
            None
        };
        let requests = pending
            .iter()
            .map(|request| {
                let policy = AgentPolicy::of(&request.record, &request.agent, Some(&request.row));
                request_state(
                    request.record.metadata.id,
                    &request.agent,
                    Some(&request.row),
                    &policy,
                )
            })
            .collect();
        Ok(AgentAccessRequestPage {
            requests,
            next_cursor,
        })
    }

    async fn item_states(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        limit: u8,
        after: Option<MacroUserIdStr<'static>>,
    ) -> Result<AgentAccessRequestPage, AgentError> {
        let record = self.managed(actor, team, item).await?;
        let mut agents: Vec<(MacroUserIdStr<'static>, Option<AgentAccessRow>)> = self
            .agents
            .item_access(team, item, after.as_ref(), limit.saturating_add(1))
            .await?
            .into_iter()
            .map(|(agent, row)| (agent, Some(row)))
            .collect();
        // Only a creator's grant exists without an access row: approval creates one.
        let rowless_creator = record.grants.iter().any(|grant| {
            matches!(grant.kind, GranteeKind::Agent) && grant.id == record.user_id.as_ref()
        }) && after
            .as_ref()
            .is_none_or(|after| record.user_id.as_ref() > after.as_ref())
            && !agents
                .iter()
                .any(|(agent, _)| agent.as_ref() == record.user_id.as_ref());
        if rowless_creator {
            agents.push((record.user_id.clone(), None));
            agents.sort_by(|left, right| left.0.as_ref().cmp(right.0.as_ref()));
        }
        let next_cursor = if agents.len() > usize::from(limit) {
            agents.truncate(usize::from(limit));
            agents.last().map(|(agent, _)| agent.to_string())
        } else {
            None
        };
        let requests = agents
            .iter()
            .map(|(agent, row)| {
                let policy = AgentPolicy::of(&record, agent, row.as_ref());
                request_state(item, agent, row.as_ref(), &policy)
            })
            .collect();
        Ok(AgentAccessRequestPage {
            requests,
            next_cursor,
        })
    }

    /// Approve (grant and standing approval together) or deny a pending request.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.review.resolve", fields(team_id = %team.0, item_id = %item.0, request_id = %request))]
    pub async fn resolve(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        request: Uuid,
        body: Result<ResolveRequest, AgentError>,
    ) -> Result<AgentAccessRequestState, AgentError> {
        self.reviewer(actor, team).await?;
        let body = body?;
        let _lock = self.vault.repository.lock(team, item).await?;
        let mut record = self.managed(actor, team, item).await?;
        let (agent, row) = self
            .agents
            .find_request(team, item, request)
            .await?
            .ok_or(AgentError::NotFound)?;
        let (revision, transition) = match body {
            ResolveRequest::Approve {
                revision,
                permission,
            } => {
                Self::set_agent_grant(&mut record, &agent, Some(permission));
                (
                    revision,
                    (
                        true,
                        StoredRequestStatus::Approved,
                        AgentAction::AgentAccessApprove,
                    ),
                )
            }
            ResolveRequest::Deny { revision } => (
                revision,
                (
                    row.approved,
                    StoredRequestStatus::Denied,
                    AgentAction::AgentAccessDeny,
                ),
            ),
        };
        let (approved, status, action) = transition;
        let row = self
            .agents
            .transition(AccessTransition {
                record: record.clone(),
                agent: agent.clone(),
                approved,
                expected: Expected::Request {
                    id: request,
                    revision,
                },
                request_status: Some(status),
                permission_changed: status == StoredRequestStatus::Approved,
                reviewer: actor.user_id.clone(),
                action,
            })
            .await?;
        let current = self.vault.repository.get(team, item).await?;
        let policy = AgentPolicy::of(&current, &agent, Some(&row));
        Ok(request_state(item, &agent, Some(&row), &policy))
    }

    /// Remove standing approval, or the Agent grant with its approval.
    #[tracing::instrument(skip_all, err, name = "passwords.agent.review.revoke", fields(team_id = %team.0, item_id = %item.0))]
    pub async fn revoke(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        agent: Result<MacroUserIdStr<'static>, AgentError>,
        body: Result<RevokeBody, AgentError>,
    ) -> Result<AgentItemAccess, AgentError> {
        self.reviewer(actor, team).await?;
        let agent = agent?;
        let body = body?;
        let _lock = self.vault.repository.lock(team, item).await?;
        let mut record = self.managed(actor, team, item).await?;
        let row = self
            .agents
            .access(team, &[item], &agent)
            .await?
            .into_iter()
            .next()
            .map(|(_, row)| row)
            .unwrap_or_default();
        if body.scope == RevokeScope::GrantAndApproval {
            Self::set_agent_grant(&mut record, &agent, None);
        }
        let request_status = row
            .request
            .as_ref()
            .filter(|request| request.status == StoredRequestStatus::Approved)
            .map(|_| StoredRequestStatus::Revoked);
        let row = self
            .agents
            .transition(AccessTransition {
                record: record.clone(),
                agent: agent.clone(),
                approved: false,
                expected: Expected::PermissionRevision(body.expected_permission_revision),
                request_status,
                permission_changed: true,
                reviewer: actor.user_id.clone(),
                action: AgentAction::AgentAccessRevoke,
            })
            .await?;
        let current = self.vault.repository.get(team, item).await?;
        Ok(AgentPolicy::of(&current, &agent, Some(&row)).access())
    }

    /// Replace this agent's Agent grant; `None` removes it.
    fn set_agent_grant(
        record: &mut Record,
        agent: &MacroUserIdStr<'_>,
        permission: Option<crate::domain::models::Permission>,
    ) {
        record.grants.retain(|grant| {
            !(matches!(grant.kind, GranteeKind::Agent) && grant.id == agent.as_ref())
        });
        if let Some(permission) = permission {
            record.grants.push(Grant {
                kind: GranteeKind::Agent,
                id: agent.to_string(),
                permission,
            });
        }
    }
}
