//! Adapters for background jobs: which turns may detach one, the session
//! facts a running job watches, and the session log its updates go to.

use agent_code_mode::domain::{CodeModeError, Detach, ExecutionIdentity, JobSessions};
use agent_runtime_protocol::domain::job::JobUpdatedNotification;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, PrompterKind, TurnPrompter};
use agent_session::domain::ports::AgentSessionRepo;
use agent_session::domain::service::AgentSessionService;
use async_trait::async_trait;
use feature_flags::FeatureFlags;
use futures::future::BoxFuture;
use std::future::Future;
use std::sync::{Arc, OnceLock};

#[cfg(test)]
mod test;

/// The PostHog flag that lets a session owner's agent start background jobs.
pub const BACKGROUND_JOBS_FLAG: &str = "enable-background-code-jobs";

fn storage(error: impl std::fmt::Display) -> CodeModeError {
    CodeModeError::Storage(rootcause::report!("{error}"))
}

/// Why a job may not start, told to the agent with the foreground result.
const NOT_ENABLED: &str =
    "Background jobs are not enabled for this account, so this ran in the foreground.";
const NOT_OWNER: &str = "Background jobs start only in a turn the session owner prompted, so this ran in the foreground.";
const UNATTENDED: &str = "This session runs unattended, so this ran in the foreground.";
const STALE_TURN: &str =
    "The turn that made this call is no longer active, so this ran in the foreground.";

/// Decides whether an execution may detach (MVP rule: the owner prompted the
/// launching turn and acts as themselves, so a job never needs an approval
/// after its turn), and whether the owner has the rollout flag.
pub struct DetachPolicy<Sessions, Flags = feature_flags::outbound::posthog::PostHogFeatureFlags> {
    pub sessions: Sessions,
    pub flags: Option<Flags>,
}

impl<Sessions: AgentSessionRepo, Flags: FeatureFlags> DetachPolicy<Sessions, Flags> {
    pub async fn decide(&self, identity: &ExecutionIdentity) -> Result<Detach, CodeModeError> {
        // The flag first: the turn facts are read last, so a turn replaced
        // during the flag read is seen.
        let enabled = match &self.flags {
            Some(flags) => match flags.load(&identity.owner).await {
                Ok(snapshot) => snapshot.is_enabled(BACKGROUND_JOBS_FLAG),
                Err(error) => {
                    tracing::warn!(?error, "could not read the background jobs flag");
                    false
                }
            },
            None => false,
        };
        let session = self.sessions.get(identity.session).await.map_err(storage)?;
        let prompter = self
            .sessions
            .turn_prompter(identity.session)
            .await
            .map_err(storage)?;
        if let Some(refused) = refusal(session.is_background(), prompter.as_ref(), identity) {
            return Ok(Detach::Refused(refused.into()));
        }
        if !enabled {
            return Ok(Detach::Refused(NOT_ENABLED.into()));
        }
        Ok(Detach::Allowed)
    }
}

/// Why an execution in this turn may not detach, if it may not: only a turn
/// the session owner prompted, still running, in a session someone watches.
fn refusal(
    background_session: bool,
    prompter: Option<&TurnPrompter>,
    identity: &ExecutionIdentity,
) -> Option<&'static str> {
    if background_session {
        return Some(UNATTENDED);
    }
    let Some(prompter) = prompter else {
        return Some(STALE_TURN);
    };
    if prompter.action_id.as_uuid() != identity.turn {
        return Some(STALE_TURN);
    }
    if prompter.kind != PrompterKind::User || prompter.user.as_ref() != Some(&identity.owner) {
        return Some(NOT_OWNER);
    }
    None
}

/// [`DetachPolicy`] behind a trait object, so [`super::RunCredentials`]
/// stays one type.
pub trait MayDetach: Send + Sync + 'static {
    fn decide<'a>(
        &'a self,
        identity: &'a ExecutionIdentity,
    ) -> BoxFuture<'a, Result<Detach, CodeModeError>>;
}

impl<Sessions: AgentSessionRepo + 'static, Flags: FeatureFlags + 'static> MayDetach
    for DetachPolicy<Sessions, Flags>
{
    fn decide<'a>(
        &'a self,
        identity: &'a ExecutionIdentity,
    ) -> BoxFuture<'a, Result<Detach, CodeModeError>> {
        Box::pin(DetachPolicy::decide(self, identity))
    }
}

/// The log a job's updates are recorded in: the session service, built after
/// code mode and filled in once it exists.
pub trait JobLog: Send + Sync + 'static {
    fn record(
        &self,
        session: AgentSessionId,
        update: JobUpdatedNotification,
    ) -> BoxFuture<'_, Result<(), AgentSessionError>>;
}

impl<Service: AgentSessionService> JobLog for Service {
    fn record(
        &self,
        session: AgentSessionId,
        update: JobUpdatedNotification,
    ) -> BoxFuture<'_, Result<(), AgentSessionError>> {
        Box::pin(self.record_unprojected_frame(session, update.to_server_message()))
    }
}

/// Session facts from the session repository; updates to the session log.
pub struct HarnessJobSessions<Sessions> {
    pub sessions: Sessions,
    pub log: Arc<OnceLock<Arc<dyn JobLog>>>,
}

#[async_trait]
impl<Sessions: AgentSessionRepo + 'static> JobSessions for HarnessJobSessions<Sessions> {
    async fn open(&self, session: AgentSessionId) -> Result<bool, CodeModeError> {
        match self.sessions.get(session).await {
            Ok(session) => Ok(!session.is_archived()),
            Err(AgentSessionError::NotFound(_)) => Ok(false),
            Err(error) => Err(storage(error)),
        }
    }

    async fn announce(
        &self,
        session: AgentSessionId,
        update: &JobUpdatedNotification,
    ) -> Result<(), CodeModeError> {
        let log = self
            .log
            .get()
            .ok_or_else(|| storage("the session log is not wired yet"))?;
        log.record(session, update.clone()).await.map_err(storage)
    }
}

/// The harness's per-prompt job list, read from code mode.
pub struct SessionJobList(pub Arc<dyn agent_code_mode::domain::SessionCodeMode>);

impl agent_harness::domain::service::jobs::BackgroundJobs for SessionJobList {
    fn listing(
        &self,
        session: AgentSessionId,
    ) -> std::pin::Pin<
        Box<
            dyn Future<
                    Output = anyhow::Result<
                        Vec<agent_runtime_protocol::domain::job::BackgroundJobSummary>,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            self.0
                .jobs(session)
                .await
                .map_err(|error| anyhow::anyhow!("{error}"))
        })
    }
}
