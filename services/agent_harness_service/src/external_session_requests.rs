//! Composer requests for sessions on a bot's own runtime.
//!
//! Composition-root adapter: the request goes out on the agent-trigger topic
//! the same way a mention does, the runtime creates the session under the id
//! it was handed, and this side waits for that row to appear so the caller
//! gets the session back the way every other create does.

#[cfg(test)]
mod test;

use std::time::Duration;

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSession, SessionSource, SessionVisibility};
use agent_session::domain::ports::{
    AgentSessionRepo, ExternalSessionRequester, RequestedExternalSession,
};
use agent_trigger::domain::broker_events::{AgentSessionMacroEvent, AgentSessionRequestedEvent};
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use macro_event_broker::MacroEventBroker;
use model_owner::Owner;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

/// How long a runtime gets to create the session before the request is
/// refused. A daemon that is up answers well inside this; one that is down
/// or too old to know the event never will.
const RUNTIME_ANSWER_TIMEOUT: Duration = Duration::from_secs(180);

/// How long shutdown waits for requested sessions still settling. It runs
/// beside the sandboxes' stop, inside the 120 s ECS gives a stopping task
/// before it kills it, and leaves the rest of that for the shutdown steps
/// before and after the stop. A session still settling then may stay listed.
pub(crate) const SHUTDOWN_DRAIN: Duration = Duration::from_secs(60);

/// The longest a requested session is waited on and given its model and
/// origin, its database calls included: past the runtime's answer, with a
/// margin.
const SETTLE_TIMEOUT: Duration = Duration::from_secs(210);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// The user each bot's runtime authenticates its event stream as.
pub trait RuntimeUsers: Send + Sync + 'static {
    /// The user `bot`'s runtime answers to; `None` when it has none.
    fn runtime_user_for_bot(
        &self,
        bot: bot_id::BotId,
    ) -> impl Future<Output = agent_session::domain::error::Result<Option<String>>> + Send;
}

impl RuntimeUsers for PgHarnessRepo {
    async fn runtime_user_for_bot(
        &self,
        bot: bot_id::BotId,
    ) -> agent_session::domain::error::Result<Option<String>> {
        PgHarnessRepo::runtime_user_for_bot(self, bot)
            .await
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))
    }
}

/// Who started the session and where it is shown, when either differs from
/// what a runtime records on a session it creates: a person's, listed. The
/// requester records them on the row once it exists, so a hidden background
/// session, such as a routine draft's, is hidden and deletable on a
/// runtime's agent as it is on a managed one.
fn origin_to_record(
    request: &RequestedExternalSession,
) -> Option<(SessionSource, SessionVisibility)> {
    (request.source != SessionSource::User || request.visibility != SessionVisibility::default())
        .then_some((request.source, request.visibility))
}

/// [`ExternalSessionRequester`] over the trigger topic and the session table.
pub struct BrokerExternalSessionRequests<Broker, Sessions, Runtimes = PgHarnessRepo> {
    broker: Broker,
    sessions: Sessions,
    harnesses: Runtimes,
    tasks: TaskTracker,
}

impl<Broker, Sessions, Runtimes> BrokerExternalSessionRequests<Broker, Sessions, Runtimes> {
    /// Publish through `broker`; watch `sessions` for the created row;
    /// address the request to the bot's runtime through `harnesses`; wait
    /// for the row on `tasks`, which shutdown drains.
    pub fn new(
        broker: Broker,
        sessions: Sessions,
        harnesses: Runtimes,
        tasks: TaskTracker,
    ) -> Self {
        Self {
            broker,
            sessions,
            harnesses,
            tasks,
        }
    }
}

impl<Broker, Sessions, Runtimes> ExternalSessionRequester
    for BrokerExternalSessionRequests<Broker, Sessions, Runtimes>
where
    Broker: MacroEventBroker,
    Sessions: AgentSessionRepo + Clone,
    Runtimes: RuntimeUsers,
{
    async fn request(
        &self,
        request: RequestedExternalSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        let session_id = request.session_id;
        // What the runtime does not record on the row it creates.
        let origin = origin_to_record(&request);
        // A caller-named id that already holds a session is taken, whoever's
        // it is: answering with it would hand a retry or a racing create a
        // session this request did not open, and its first prompt with it.
        match self.sessions.get(session_id).await {
            Ok(_) => return Err(AgentSessionError::SessionIdTaken(session_id)),
            Err(AgentSessionError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
        // The runtime's stream authenticates as its harness's owner, not as
        // whichever teammate asked, so the request names both.
        let runtime_user = self.harnesses.runtime_user_for_bot(request.bot_id).await?;
        let event = AgentSessionMacroEvent::requested_event(AgentSessionRequestedEvent {
            bot_id: request.bot_id,
            repo_url: request.repo_url,
            session_id,
            owner: request.owner.as_ref().to_owned(),
            origin: request.origin,
            // The requester's first prompt follows through the session's
            // control path once it exists; nothing composes it with this event.
            context: None,
            runtime_user,
        });
        // The broker publishes on a task of its own, so the event can reach
        // the runtime even if this request is dropped while it waits.
        let publication = self
            .broker
            .send_event(&event)
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?;

        // The runtime creates the row; there is no other signal to wait on.
        // Waiting for the publication, waiting for the row, and what the row
        // is given once it appears all run on in a task of their own: a
        // caller that stops waiting (a route's timeout, a dropped
        // connection) at any of them must not leave a hidden session listed.
        // A publication that fails ends the task: no runtime was asked.
        // Giving the row its model and origin twice changes nothing. The
        // task is bounded, publication and database calls and all, and its
        // failure is logged there: its caller may be gone.
        let sessions = self.sessions.clone();
        let settling = async move {
            let settled = tokio::time::timeout(SETTLE_TIMEOUT, async move {
                publication
                    .await
                    .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?
                    .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?;
                settle(
                    sessions,
                    Settle {
                        session_id,
                        bot_id: request.bot_id,
                        owner: request.owner,
                        model: request.model,
                        origin,
                    },
                )
                .await
            })
            .await
            .unwrap_or_else(|_| {
                Err(AgentSessionError::Unknown(anyhow::anyhow!(
                    "settling the requested session took over {}s",
                    SETTLE_TIMEOUT.as_secs()
                )))
            });
            if let Err(error) = &settled {
                tracing::warn!(%session_id, ?error, "a requested session was not settled");
            }
            settled
        }
        .instrument(tracing::info_span!("settle_requested_session", %session_id));
        // No cancellation token: the task is bounded and runs once, and
        // cancelling it would leave a hidden session listed.
        self.tasks
            .spawn(settling)
            .await
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?
    }
}

/// What a requested session's row is checked against and given once the
/// runtime creates it.
struct Settle {
    session_id: agent_session::domain::model::AgentSessionId,
    bot_id: bot_id::BotId,
    owner: macro_user_id::user_id::MacroUserIdStr<'static>,
    model: Option<String>,
    origin: Option<(SessionSource, SessionVisibility)>,
}

/// Wait up to `within` for the requested sessions settling on `tasks`;
/// whether they all finished.
pub(crate) async fn drain(tasks: &TaskTracker, within: Duration) -> bool {
    tasks.close();
    tokio::time::timeout(within, tasks.wait()).await.is_ok()
}

/// Wait up to [`RUNTIME_ANSWER_TIMEOUT`] for the runtime to create the
/// session's row, then give it the requested model and origin.
async fn settle<Sessions: AgentSessionRepo>(
    sessions: Sessions,
    request: Settle,
) -> agent_session::domain::error::Result<AgentSession> {
    let Settle {
        session_id,
        bot_id,
        owner,
        model,
        origin,
    } = request;
    let deadline = tokio::time::Instant::now() + RUNTIME_ANSWER_TIMEOUT;
    loop {
        match sessions.get(session_id).await {
            Ok(session) => {
                // The id is the caller's, so the row may be a session
                // someone else already holds. Never touch or return it.
                if session.bot_id != bot_id || session.owner_id != Owner::User(owner.clone()) {
                    return Err(AgentSessionError::SessionIdTaken(session_id));
                }
                if model.is_none() && origin.is_none() {
                    return Ok(session);
                }
                // The runtime created the row on the persona's default.
                // The choice goes on the row now, ahead of the first
                // prompt - which the caller cannot send before this
                // answers - so the session binds on it, exactly as it
                // would on the persona's own.
                if let Some(model) = &model {
                    sessions.set_model(session_id, model).await?;
                }
                // The runtime does not know who started it, or where it is
                // shown, either.
                if let Some((source, visibility)) = origin {
                    sessions.set_origin(session_id, source, visibility).await?;
                }
                return sessions.get(session_id).await;
            }
            Err(error) => {
                if tokio::time::Instant::now() >= deadline {
                    // Warn: the caller has waited the whole timeout and
                    // gets an error, and nothing else records why.
                    tracing::warn!(
                        %session_id,
                        %bot_id,
                        waited_secs = RUNTIME_ANSWER_TIMEOUT.as_secs(),
                        last_error = %error,
                        "no runtime created the requested session in time"
                    );
                    return Err(AgentSessionError::RuntimeUnavailable(
                        "this agent's machine did not open the session; make sure macrod is running and up to date",
                    ));
                }
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}
