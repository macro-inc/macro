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

/// How long a runtime gets to create the session before the request is
/// refused. A daemon that is up answers well inside this; one that is down
/// or too old to know the event never will.
const RUNTIME_ANSWER_TIMEOUT: Duration = Duration::from_secs(180);
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
}

impl<Broker, Sessions, Runtimes> BrokerExternalSessionRequests<Broker, Sessions, Runtimes> {
    /// Publish through `broker`; watch `sessions` for the created row;
    /// address the request to the bot's runtime through `harnesses`.
    pub fn new(broker: Broker, sessions: Sessions, harnesses: Runtimes) -> Self {
        Self {
            broker,
            sessions,
            harnesses,
        }
    }
}

impl<Broker, Sessions, Runtimes> ExternalSessionRequester
    for BrokerExternalSessionRequests<Broker, Sessions, Runtimes>
where
    Broker: MacroEventBroker,
    Sessions: AgentSessionRepo,
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
        let runtime_user = self
            .harnesses
            .runtime_user_for_bot(request.bot_id)
            .await?;
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
        self.broker
            .send_event(&event)
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?
            .await
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?
            .map_err(|error| AgentSessionError::Unknown(anyhow::anyhow!(error)))?;

        // The runtime creates the row; there is no other signal to wait on.
        let deadline = tokio::time::Instant::now() + RUNTIME_ANSWER_TIMEOUT;
        loop {
            match self.sessions.get(session_id).await {
                Ok(session) => {
                    // The id is the caller's, so the row may be a session
                    // someone else already holds. Never touch or return it.
                    if session.bot_id != request.bot_id
                        || session.owner_id != Owner::User(request.owner.clone())
                    {
                        return Err(AgentSessionError::SessionIdTaken(session_id));
                    }
                    if request.model.is_none() && origin.is_none() {
                        return Ok(session);
                    }
                    // The runtime created the row on the persona's default.
                    // The choice goes on the row now, ahead of the first
                    // prompt - which the caller cannot send before this
                    // answers - so the session binds on it, exactly as it
                    // would on the persona's own.
                    if let Some(model) = &request.model {
                        self.sessions.set_model(session_id, model).await?;
                    }
                    // The runtime does not know who started it, or where it is
                    // shown, either.
                    if let Some((source, visibility)) = origin {
                        self.sessions
                            .set_origin(session_id, source, visibility)
                            .await?;
                    }
                    return self.sessions.get(session_id).await;
                }
                Err(error) => {
                    if tokio::time::Instant::now() >= deadline {
                        // Warn: the caller has waited the whole timeout and
                        // gets an error, and nothing else records why.
                        tracing::warn!(
                            %session_id,
                            bot_id = %request.bot_id,
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
}
