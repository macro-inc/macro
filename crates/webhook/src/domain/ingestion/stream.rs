//! Stream candidates from the shared, exposure-driven event normalization.

use super::{WebhookEventIngestionError, normalize};
use crate::domain::ports::WebhookWorkspaceResolver;
use crate::domain::stream::{StreamAudience, StreamCandidateEvent};
use macro_event_broker::exposure::{Audience, MinTeamRole};
use macro_event_broker::{Event, TopicEvent};
use macro_user_id::user_id::MacroUserIdStr;

/// Normalize one broker event into a stream candidate.
///
/// `None` means the event is not exposed to subscribers, exactly as webhook
/// ingestion skips it. `workspace_resolver` expands `TeamsOf` audiences once
/// per event, not once per subscriber.
pub(crate) async fn stream_candidate<E: TopicEvent, R: WebhookWorkspaceResolver>(
    event: &Event<E>,
    workspace_resolver: &R,
) -> Result<Option<StreamCandidateEvent>, WebhookEventIngestionError> {
    let Some((normalized, audience)) = normalize(event)? else {
        return Ok(None);
    };
    let audience = stream_audience(&audience, workspace_resolver).await?;
    Ok(Some(StreamCandidateEvent {
        event: normalized,
        audience,
    }))
}

/// The per-subscriber check for one audience.
///
/// Addressed people and owners match the person's own stream; team audiences
/// match team-scoped streams of that team.
async fn stream_audience<R: WebhookWorkspaceResolver>(
    audience: &Audience,
    workspace_resolver: &R,
) -> Result<StreamAudience, WebhookEventIngestionError> {
    Ok(match audience {
        Audience::Entity {
            entity_type,
            entity_id,
        } => StreamAudience::Entity {
            entity_id: entity_id.clone(),
            entity_type: *entity_type,
        },
        Audience::Recipient { user_id } => StreamAudience::User {
            user_id: user_id.to_string(),
        },
        Audience::Owner { user_id } => StreamAudience::Workspace {
            workspace_id: user_id.to_string(),
        },
        Audience::Workspace { workspace_id } => StreamAudience::Workspace {
            workspace_id: workspace_id.clone(),
        },
        Audience::ContactsOf { user_id } => StreamAudience::ContactsOf {
            user_id: user_id.to_string(),
        },
        Audience::Snapshot { user_ids } => StreamAudience::Any(
            user_ids
                .iter()
                .map(|user_id| StreamAudience::User {
                    user_id: user_id.to_string(),
                })
                .collect(),
        ),
        Audience::Team {
            team_id,
            min_role: MinTeamRole::Member,
        } => StreamAudience::Workspace {
            workspace_id: team_id.to_string(),
        },
        Audience::Team {
            min_role: MinTeamRole::Admin,
            ..
        } => {
            return Err(WebhookEventIngestionError::UnsupportedAudience(
                "team admins",
            ));
        }
        Audience::GithubInstallation { .. } => {
            return Err(WebhookEventIngestionError::UnsupportedAudience(
                "GitHub installation",
            ));
        }
        Audience::TeamsOf { user_id } => {
            StreamAudience::Any(team_workspaces(workspace_resolver, user_id).await)
        }
        Audience::Any(audiences) => {
            let mut members = Vec::with_capacity(audiences.len());
            for audience in audiences {
                match audience {
                    // Splice the user's teams into the union rather than
                    // nesting a second one.
                    Audience::TeamsOf { user_id } => {
                        members.extend(team_workspaces(workspace_resolver, user_id).await);
                    }
                    other => {
                        members.push(Box::pin(stream_audience(other, workspace_resolver)).await?);
                    }
                }
            }
            StreamAudience::Any(members)
        }
    })
}

/// One workspace audience per team of `user`.
async fn team_workspaces<R: WebhookWorkspaceResolver>(
    workspace_resolver: &R,
    user: &MacroUserIdStr<'static>,
) -> Vec<StreamAudience> {
    user_team_workspace_ids(workspace_resolver, user.clone())
        .await
        .into_iter()
        .map(|workspace_id| StreamAudience::Workspace { workspace_id })
        .collect()
}

/// The user's team workspaces, excluding their personal workspace (the user id).
///
/// A resolution failure degrades to the rest of the audience: SSE is
/// best-effort, and persisted webhooks still deliver durably.
#[tracing::instrument(name = "webhook.stream.resolve_user_teams", skip_all, fields(user_id = %user))]
async fn user_team_workspace_ids<R: WebhookWorkspaceResolver>(
    workspace_resolver: &R,
    user: MacroUserIdStr<'static>,
) -> Vec<String> {
    let personal = user.as_ref().to_string();
    match workspace_resolver.resolve_workspace_ids(vec![user]).await {
        Ok(mut workspace_ids) => {
            workspace_ids.retain(|id| *id != personal);
            workspace_ids
        }
        Err(error) => {
            let error: anyhow::Error = error.into();
            tracing::warn!(error = ?error, "failed to resolve user team workspaces for stream");
            Vec::new()
        }
    }
}
