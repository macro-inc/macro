//! The daemon's client for the agent-harness service: open sessions, drive
//! them. Both calls act as the harness, and control calls additionally act
//! for the user whose mention they forward.

use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::{
    ControlRequest, CreateAgentSessionRequest, CreateAgentSessionResponse,
    ThreadSessionExistsResponse,
};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;

use crate::config::MacroApi;
use crate::outbound::credentials::HarnessCredentials;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";
const HARNESS_ACTING_USER_HEADER: &str = "x-macro-harness-for-macro-user-id";

/// A failure calling the agent-harness service.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// The request could not be sent or the response not read.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// A bound agent already has a session for the thread.
    #[error("this agent already has a session for this thread")]
    ThreadSessionExists {
        /// The existing session, when the service could name it.
        session: Option<AgentSessionId>,
    },
    /// The service refused the request.
    #[error("the service answered {status}: {message}")]
    Refused {
        /// The status the service answered with.
        status: StatusCode,
        /// The response body, verbatim.
        message: String,
    },
}

/// Client for the agent-harness service, acting as one harness.
pub struct HarnessApi {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl HarnessApi {
    /// Build a client from the daemon's config and paired credentials.
    pub fn new(config: &MacroApi, credentials: &HarnessCredentials) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: config.api_url.trim_end_matches('/').to_owned(),
            token: credentials.token.clone(),
        }
    }

    /// Open an external session for one of this harness's bound agents,
    /// acting for the user who mentioned the agent.
    ///
    /// The acting-user header is what the service verifies the session's owner
    /// against (owner for a private harness, a team member for a team one), so
    /// it carries the sender the way the control calls do - the body's `owner`
    /// is not trusted for a harness caller.
    ///
    /// A thread routes to at most one of a bot's sessions, so a redelivered
    /// mention lands on [`ApiError::ThreadSessionExists`] carrying the
    /// session already serving it.
    pub async fn create_session(
        &self,
        request: &CreateAgentSessionRequest,
        acting_user: &MacroUserIdStr<'static>,
    ) -> Result<CreateAgentSessionResponse, ApiError> {
        let response = self
            .http
            .post(format!("{}/agent-sessions", self.base))
            .header(HARNESS_TOKEN_HEADER, &self.token)
            .header(HARNESS_ACTING_USER_HEADER, acting_user.as_ref())
            .json(request)
            .send()
            .await?;
        if response.status() == StatusCode::CONFLICT {
            let session = response
                .json::<ThreadSessionExistsResponse>()
                .await
                .ok()
                .and_then(|conflict| conflict.session_id);
            return Err(ApiError::ThreadSessionExists { session });
        }
        let response = refuse_errors(response).await?;
        Ok(response.json().await?)
    }

    /// Ask a session to do something, acting for the user who asked.
    ///
    /// Announcing the result into its channel is not this call's business:
    /// the harness service posts the chip from the trigger event it observed.
    pub async fn control(
        &self,
        session: AgentSessionId,
        actor: &MacroUserIdStr<'static>,
        action: AgentAction,
    ) -> Result<(), ApiError> {
        let response = self
            .http
            .post(format!("{}/agent-sessions/{session}/control", self.base))
            .header(HARNESS_TOKEN_HEADER, &self.token)
            .header(HARNESS_ACTING_USER_HEADER, actor.as_ref())
            .json(&ControlRequest { action })
            .send()
            .await?;
        refuse_errors(response).await?;
        Ok(())
    }

    /// Deliver a prompt to a session, acting for the user who sent it.
    pub async fn prompt(
        &self,
        session: AgentSessionId,
        sender: &MacroUserIdStr<'static>,
        text: &str,
    ) -> Result<(), ApiError> {
        self.control(session, sender, AgentAction::prompt(text))
            .await
    }
}

async fn refuse_errors(response: reqwest::Response) -> Result<reqwest::Response, ApiError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let message = response.text().await.unwrap_or_default();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        tracing::error!(
            %status,
            "the server refused this harness's credentials; press p to re-pair"
        );
    }
    Err(ApiError::Refused { status, message })
}
