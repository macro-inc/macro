//! Resolve PR dependencies through the agent-session domain's existing link port, and carry
//! work registration changes to a session's viewers.
use std::sync::Arc;

use crate::domain::models::{Patch, SoupRealtimePatch};
use crate::domain::ports::{PullRequestSessions, SoupRealtimeService};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::pull_request_links::SessionPullRequestLinkRepo;
use agent_session::domain::work_registration::WorkRegistrationSignal;
use model_entity::{Entity, EntityType};
use rootcause::prelude::{Report, ResultExt as _};

/// Uses the owning session repository to look up links without duplicating its SQL.
pub struct AgentSessionPullRequestLookup<R>(pub R);
impl<R: SessionPullRequestLinkRepo> PullRequestSessions for AgentSessionPullRequestLookup<R> {
    async fn linked_sessions(&self, github_key: &str) -> Result<Vec<Entity<'static>>, Report> {
        Ok(self
            .0
            .sessions_for_pull_request(github_key)
            .await
            .context("finding sessions linked to PR")?
            .into_iter()
            .map(|id| EntityType::AgentSession.with_entity_string(id.to_string()))
            .collect())
    }
}

/// Tells a session's current accessors it changed, as a Soup patch on the session. Their
/// `registeredWorkUpdates` streams recompute from it, and their Soup lists refresh the row.
pub struct SoupWorkRegistrationSignal<S>(pub Arc<S>);

impl<S> Clone for SoupWorkRegistrationSignal<S> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<S: SoupRealtimeService> WorkRegistrationSignal for SoupWorkRegistrationSignal<S> {
    async fn session_changed(&self, session: AgentSessionId) -> Result<(), Report> {
        self.0
            .notify_users(vec![SoupRealtimePatch::for_entity(Patch::Updated(
                EntityType::AgentSession.with_entity_string(session.to_string()),
            ))])
            .await
            .map(drop)
    }
}
