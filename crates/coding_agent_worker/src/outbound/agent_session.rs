//! The daemon's client for the agent-harness service: open sessions, drive
//! them. Both calls act as the bot, and control calls additionally act for
//! the user whose mention they forward.

use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::model::AgentSessionId;
use agent_session::inbound::axum_router::{
    ControlRequest, CreateAgentSessionRequest, CreateAgentSessionResponse,
    ThreadSessionExistsResponse,
};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;

use crate::config::MacroApi;

const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
const BOT_ACTING_USER_HEADER: &str = "x-macro-bot-for-macro-user-id";

/// A failure calling the agent-harness service.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// The request could not be sent or the response not read.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// This bot already has a session for the thread.
    #[error("this bot already has a session for this thread")]
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

/// Client for the agent-harness service, acting as one bot.
pub struct HarnessApi {
    http: reqwest::Client,
    base: String,
    bot_token: String,
    bot_scope: String,
}

impl HarnessApi {
    /// Build a client from the daemon's config.
    pub fn new(config: &MacroApi) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: config.api_url.trim_end_matches('/').to_owned(),
            bot_token: config.bot_token.clone(),
            bot_scope: config.bot_scope.clone(),
        }
    }

    /// Open an external session for this bot.
    ///
    /// A thread routes to at most one of a bot's sessions, so a redelivered
    /// mention lands on [`ApiError::ThreadSessionExists`] carrying the
    /// session already serving it.
    pub async fn create_session(
        &self,
        request: &CreateAgentSessionRequest,
    ) -> Result<CreateAgentSessionResponse, ApiError> {
        let response = self
            .http
            .post(format!("{}/agent-sessions", self.base))
            .header(BOT_TOKEN_HEADER, &self.bot_token)
            .header(BOT_SCOPE_HEADER, &self.bot_scope)
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
            .header(BOT_TOKEN_HEADER, &self.bot_token)
            .header(BOT_SCOPE_HEADER, &self.bot_scope)
            .header(BOT_ACTING_USER_HEADER, actor.as_ref())
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
    Err(ApiError::Refused { status, message })
}
