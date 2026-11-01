//! Read-only view of coding sessions awaiting their owner.

use agent_fold::domain::model::FoldedMessage;
use agent_fold::domain::{
    lifecycle::LifecycleFold,
    model::{MessagePart, PendingInteraction, ToolDetail},
};
use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    coding_agents::CodingAgentError,
    model::{AgentSessionId, StoredAgentSessionLog},
};

#[cfg(test)]
mod test;

const MAX_SESSIONS: usize = 25;

/// Session facts selected by the persistence port, newest activity first.
#[derive(Debug, Clone)]
pub struct UpdateCandidate {
    pub id: AgentSessionId,
    pub name: String,
    pub harness: String,
    pub pull_request_url: Option<String>,
    pub turn_state: UpdateTurnState,
    pub is_archived: bool,
    pub last_activity: DateTime<Utc>,
}

/// States eligible for the updates query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateTurnState {
    /// A pending interaction may need the owner.
    Blocked,
    /// An active turn may have stopped making progress.
    Running,
}

/// Owner-scoped listing and effective log reads.
pub trait CodingAgentUpdatesRepo: Send + Sync + 'static {
    fn candidates(
        &self,
        owner: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<UpdateCandidate>, CodingAgentError>> + Send;
    fn log(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<StoredAgentSessionLog>, CodingAgentError>> + Send;
}

impl CodingAgentUpdatesRepo for () {
    async fn candidates(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<UpdateCandidate>, CodingAgentError> {
        Ok(Vec::new())
    }
    async fn log(&self, _: AgentSessionId) -> Result<Vec<StoredAgentSessionLog>, CodingAgentError> {
        Ok(Vec::new())
    }
}

/// A kind of action or inactivity the user should see.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum AgentUpdateKind {
    Permission,
    Elicitation,
    ToolApproval,
    Stalled,
}

/// One pending interaction, or one stalled session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdate {
    pub session_id: Uuid,
    pub session_name: String,
    pub harness: String,
    pub pull_request_url: Option<String>,
    pub kind: AgentUpdateKind,
    pub summary: String,
    pub since: DateTime<Utc>,
    pub options: Vec<String>,
}

/// Bounded results; truncation means older qualifying sessions were not folded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdates {
    pub items: Vec<AgentUpdate>,
    pub truncated: bool,
    pub truncation_notice: Option<String>,
}

/// Read the owner's recent blocked or stalled sessions and fold only blocked logs.
#[tracing::instrument(
    name = "agent_session.list_updates",
    skip(repo, owner),
    fields(owner_count = 1, session_count, update_count, truncated),
    err
)]
pub async fn list_updates<R: CodingAgentUpdatesRepo>(
    repo: &R,
    owner: MacroUserIdStr<'static>,
) -> Result<AgentUpdates, CodingAgentError> {
    let mut candidates = repo.candidates(owner).await?;
    let truncated = candidates.len() > MAX_SESSIONS;
    candidates.truncate(MAX_SESSIONS);
    let span = tracing::Span::current();
    span.record("session_count", candidates.len());
    span.record("truncated", truncated);
    let now = Utc::now();
    let mut items = Vec::new();
    for candidate in candidates {
        if candidate.is_archived
            || matches!(candidate.harness.as_str(), "in-memory" | "macro-inmem")
        {
            continue;
        }
        match candidate.turn_state {
            UpdateTurnState::Running => {
                if candidate.last_activity <= now - Duration::minutes(20) {
                    items.push(item(
                        &candidate,
                        AgentUpdateKind::Stalled,
                        "No activity for over 20 minutes".into(),
                        Vec::new(),
                    ));
                }
            }
            UpdateTurnState::Blocked => {
                let mut fold = LifecycleFold::new();
                let mut pending_since: Vec<(PendingInteraction, DateTime<Utc>)> = Vec::new();
                for entry in repo.log(candidate.id).await? {
                    let _ = fold.push(entry.entry);
                    let pending = &fold.inner().metadata().pending_interactions;
                    pending_since.retain(|(interaction, _)| pending.contains(interaction));
                    for interaction in pending {
                        if !pending_since.iter().any(|(seen, _)| seen == interaction) {
                            pending_since.push((interaction.clone(), entry.created_at));
                        }
                    }
                }
                for pending in &fold.inner().metadata().pending_interactions {
                    let since = pending_since
                        .iter()
                        .find_map(|(seen, since)| (seen == pending).then_some(*since))
                        .unwrap_or(candidate.last_activity);
                    items.push(pending_item(
                        &candidate,
                        pending,
                        fold.inner().messages(),
                        since,
                    ));
                }
            }
        }
    }
    span.record("update_count", items.len());
    Ok(AgentUpdates {
        items,
        truncated,
        truncation_notice: truncated.then(|| "Only the 25 most recent qualifying sessions were inspected; older sessions may also need attention.".into()),
    })
}

fn pending_item(
    candidate: &UpdateCandidate,
    pending: &PendingInteraction,
    messages: &[FoldedMessage],
    since: DateTime<Utc>,
) -> AgentUpdate {
    let (kind, summary, options) = match pending {
        PendingInteraction::Permission(permission) => {
            let label = messages
                .iter()
                .filter(|message| message.id.0 == permission.turn)
                .flat_map(|message| message.parts.iter())
                .find_map(|part| match part {
                    MessagePart::ToolUse {
                        id, name, detail, ..
                    } if id == &permission.tool_call => {
                        let command = match detail {
                            ToolDetail::Terminal {
                                command: Some(command),
                                ..
                            } => Some(command.as_str()),
                            _ => None,
                        };
                        Some(command.unwrap_or_else(|| name.display()).to_owned())
                    }
                    _ => None,
                })
                .unwrap_or_else(|| "a tool call".into());
            (
                AgentUpdateKind::Permission,
                format!("Approve {label}"),
                permission
                    .options
                    .iter()
                    .map(|option| option.name.clone())
                    .collect(),
            )
        }
        PendingInteraction::Elicitation(question) => (
            AgentUpdateKind::Elicitation,
            question.message.clone(),
            Vec::new(),
        ),
        PendingInteraction::ToolApproval(approval) => (
            AgentUpdateKind::ToolApproval,
            format!("Approve {} on {}", approval.tool_name, approval.server_name),
            Vec::new(),
        ),
    };
    let summary: String = summary
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect();
    let mut update = item(candidate, kind, summary, options);
    update.since = since;
    update
}

fn item(
    candidate: &UpdateCandidate,
    kind: AgentUpdateKind,
    summary: String,
    options: Vec<String>,
) -> AgentUpdate {
    AgentUpdate {
        session_id: candidate.id.as_uuid(),
        session_name: candidate.name.clone(),
        harness: candidate.harness.clone(),
        pull_request_url: candidate.pull_request_url.clone(),
        kind,
        summary,
        since: candidate.last_activity,
        options,
    }
}
