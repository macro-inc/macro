//! `POST /internal/code-mode/user-executions`: run one program for a user on
//! behalf of an in-process Macro host that has no Deno runtime of its own (the
//! channel-mention bot in document storage).
//!
//! Only the internal key is accepted. The program runs with exactly the
//! identity the caller's direct tools use: the named user, attributed to the
//! Macro AI bot. The caller cannot choose another agent, a session, or a
//! client label, so the route grants nothing the internal key does not
//! already grant on every other `UserOrInternal` route. Its token is signed
//! with the mention (`channel_mention_id`), which email refuses to send for:
//! the bot's direct tools never could.

use crate::domain::{
    CodeModeError, MentionExecutionCredentials, UserCodeMode, UserCodeModeService,
    UserExecutionCredentials, UserExecutionReceipt,
};
use crate::user_executions::{USER_EXECUTIONS_PATH, UserExecutionCommand, UserExecutionFailure};
use ai_toolset::ToolCaller;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use code_execution::domain::{ExecuteRequest, ProgramExecutor, RunEnvironment};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The source limit plus room for the envelope.
const MAX_REQUEST_BYTES: usize = 128 * 1024;

impl IntoResponse for UserExecutionFailure {
    fn into_response(self) -> Response {
        (self.status(), Json(self)).into_response()
    }
}

/// The executor and mention credentials, and the shared internal authentication.
pub struct UserExecutionsState<Auth> {
    executor: Arc<dyn ProgramExecutor>,
    credentials: Arc<dyn MentionExecutionCredentials>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Auth> UserExecutionsState<Auth> {
    /// Bind the executor this route runs on and how its runs are credentialed.
    pub fn new(
        executor: Arc<dyn ProgramExecutor>,
        credentials: Arc<dyn MentionExecutionCredentials>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            executor,
            credentials,
            authorization,
        }
    }
}

impl<Auth> Clone for UserExecutionsState<Auth> {
    fn clone(&self) -> Self {
        Self {
            executor: self.executor.clone(),
            credentials: self.credentials.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Auth> FromRef<UserExecutionsState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &UserExecutionsState<Auth>) -> Self {
        state.authorization.clone()
    }
}

/// One request's credentials: always the mention's, whatever the caller.
struct ForMention {
    credentials: Arc<dyn MentionExecutionCredentials>,
    mention: Uuid,
}

#[async_trait::async_trait]
impl UserExecutionCredentials for ForMention {
    async fn issue(
        &self,
        user: &MacroUserIdStr<'static>,
        _caller: &ToolCaller,
        _session: Option<Uuid>,
    ) -> Result<RunEnvironment, CodeModeError> {
        self.credentials.issue(user, self.mention).await
    }
}

/// Mount [`USER_EXECUTIONS_PATH`].
pub fn user_executions_router<Auth: MacroAuthorizationService>(
    state: UserExecutionsState<Auth>,
) -> Router {
    Router::new()
        .route(USER_EXECUTIONS_PATH, post(execute::<Auth>))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

#[tracing::instrument(
    name = "code_mode.internal_user_execution",
    skip_all,
    fields(
        message_id = tracing::field::Empty,
        root_id = tracing::field::Empty,
    )
)]
async fn execute<Auth: MacroAuthorizationService>(
    State(state): State<UserExecutionsState<Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<UserExecutionCommand>, JsonRejection>,
) -> Result<Json<UserExecutionReceipt>, UserExecutionFailure> {
    let Json(command) = command.map_err(|_| UserExecutionFailure::BadRequest)?;
    let span = tracing::Span::current();
    span.record(
        "message_id",
        tracing::field::display(command.mention.message_id),
    );
    span.record("root_id", tracing::field::display(command.mention.root_id));
    // A caller that hangs up stops the program.
    let cancel = CancellationToken::new();
    let _stop_on_drop = cancel.clone().drop_guard();
    let service = UserCodeModeService::new(
        state.executor.clone(),
        Arc::new(ForMention {
            credentials: state.credentials.clone(),
            mention: command.mention.message_id,
        }),
    );
    service
        .execute(
            &command.user_id,
            &ToolCaller::Agent(bot_id::MACRO_AI_BOT_ID),
            None,
            ExecuteRequest {
                source: command.source,
                timeout_ms: command.timeout_ms,
            },
            cancel,
        )
        .await
        .map(Json)
        .map_err(UserExecutionFailure::from)
}
