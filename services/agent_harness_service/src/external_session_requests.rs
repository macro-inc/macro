//! Composer requests for sessions on a bot's own runtime.
//!
//! Composition-root adapter: the request goes out on the agent-trigger topic
//! the same way a mention does, the runtime creates the session under the id
//! it was handed, and this side waits for that row to appear so the caller
//! gets the session back the way every other create does.

use std::time::Duration;

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSession;
use agent_session::domain::ports::{
    AgentSessionRepo, ExternalSessionRequester, RequestedExternalSession,
};
use agent_trigger::domain::broker_events::{AgentSessionMacroEvent, AgentSessionRequestedEvent};
use macro_event_broker::MacroEventBroker;

/// How long a runtime gets to create the session before the request is
/// refused. A daemon that is up answers well inside this; one that is down
/// or too old to know the event never will.
const RUNTIME_ANSWER_TIMEOUT: Duration = Duration::from_secs(8);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// [`ExternalSessionRequester`] over the trigger topic and the session table.
pub struct BrokerExternalSessionRequests<Broker, Sessions> {
    broker: Broker,
    sessions: Sessions,
}

impl<Broker, Sessions> BrokerExternalSessionRequests<Broker, Sessions> {
    /// Publish through `broker`; watch `sessions` for the created row.
    pub fn new(broker: Broker, sessions: Sessions) -> Self {
        Self { broker, sessions }
    }
}

impl<Broker, Sessions> ExternalSessionRequester for BrokerExternalSessionRequests<Broker, Sessions>
where
    Broker: MacroEventBroker,
    Sessions: AgentSessionRepo,
{
    async fn request(
        &self,
        request: RequestedExternalSession,
    ) -> agent_session::domain::error::Result<AgentSession> {
        let session_id = request.session_id;
        let event = AgentSessionMacroEvent::requested_event(AgentSessionRequestedEvent {
            bot_id: request.bot_id,
            session_id,
            owner: request.owner.as_ref().to_owned(),
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
                    let Some(model) = request.model else {
                        return Ok(session);
                    };
                    // The runtime created the row on the persona's default.
                    // The choice goes on the row now, ahead of the first
                    // prompt - which the caller cannot send before this
                    // answers - so the session binds on it, exactly as it
                    // would on the persona's own.
                    self.sessions.set_model(session_id, &model).await?;
                    return self.sessions.get(session_id).await;
                }
                Err(error) => {
                    if tokio::time::Instant::now() >= deadline {
                        tracing::info!(
                            %session_id,
                            bot_id = %request.bot_id,
                            last_error = %error,
                            "no runtime created the requested session in time"
                        );
                        return Err(AgentSessionError::RuntimeUnavailable(
                            "this agent's runtime did not open the session; make sure macrod is running and up to date",
                        ));
                    }
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }
}
