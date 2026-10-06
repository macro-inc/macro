//! Composition of workspace capture, cross-replica routing, and PR fallback.

mod github;
mod runtime;
pub(crate) use runtime::{ReviewRuntimeBus, ReviewRuntimeEvent};

use agent_harness::domain::ports::HarnessBindings;
use agent_review::domain::{
    model::{Capture, Comparison, Result, ReviewError},
    ports::ReviewSource,
};
use agent_session::domain::model::AgentSession;
use async_trait::async_trait;
use std::sync::Arc;

/// Source adapter composed from the owning runtime and GitHub capabilities.
pub(crate) struct Sources<B, P, M> {
    pub(crate) bindings: B,
    pub(crate) managed: M,
    pub(crate) runtimes: ReviewRuntimeBus,
    pub(crate) pull_requests: Arc<P>,
}

#[async_trait]
impl<B: HarnessBindings, P: ReviewSource, M: agent_harness::domain::ports::WorkspaceReviewSource>
    ReviewSource for Sources<B, P, M>
{
    async fn capture(&self, session: &AgentSession, comparison: &Comparison) -> Result<Capture> {
        if let Some(harness) = self
            .bindings
            .harness_for(session.bot_id)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
        {
            match self
                .runtimes
                .capture(harness, &session.workspace, comparison)
                .await
            {
                Ok(capture) => return Ok(capture),
                Err(error) if session.pull_request_url.is_none() => return Err(error),
                Err(error) => {
                    tracing::debug!(?error, "workspace unavailable; reading the linked PR")
                }
            }
        }
        match self
            .managed
            .capture_workspace_review(session.id, comparison.base.clone(), comparison.head.clone())
            .await
        {
            Ok(Some(value)) => {
                return serde_json::from_value(value)
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()));
            }
            Err(error) if session.pull_request_url.is_none() => {
                return Err(ReviewError::Unavailable(error.to_string()));
            }
            _ => {}
        }
        if session.pull_request_url.is_none() {
            return Err(ReviewError::Unavailable(
                "Connect an updated macrod runtime or link a pull request to review changes".into(),
            ));
        }
        self.pull_requests.capture(session, comparison).await
    }
}

pub(crate) use github::GithubReviews;

/// Refresh published reviews after an agent turn without blocking its actor.
pub(crate) struct CaptureOnTurnEnd<S> {
    pub(crate) sessions: S,
    pub(crate) reviews: Arc<dyn agent_review::domain::service::Reviews>,
}
impl<S: agent_session::domain::ports::AgentSessionRepo + Clone>
    agent_session::domain::ports::SessionTurnObserver for CaptureOnTurnEnd<S>
{
    fn signal(
        &self,
        id: agent_session::domain::model::AgentSessionId,
        signal: agent_fold::domain::model::TurnSignal,
    ) {
        if !matches!(
            signal,
            agent_fold::domain::model::TurnSignal::TurnEnded { .. }
        ) {
            return;
        }
        let sessions = self.sessions.clone();
        let reviews = self.reviews.clone();
        tokio::spawn(async move {
            let Ok(session) = sessions.get(id).await else {
                return;
            };
            let owner = session.owner_id.to_string();
            let Ok(owner) = macro_user_id::user_id::MacroUserIdStr::parse_from_str(&owner) else {
                return;
            };
            use macro_user_id::cowlike::CowLike;
            let owner = owner.into_owned();
            let access = || agent_review::domain::model::ReviewAccess::Agent {
                session: id,
                owner: owner.clone(),
            };
            if !matches!(reviews.view(access(), None).await, Ok(Some(_))) {
                return;
            }
            if let Err(error) = reviews
                .capture(access(), Comparison::default(), Default::default())
                .await
            {
                tracing::debug!(?error, "turn-end review refresh skipped");
            }
        });
    }
    fn session_stopped(
        &self,
        _: agent_session::domain::model::AgentSessionId,
        _: agent_session::domain::session::StopReason,
    ) {
    }
}
