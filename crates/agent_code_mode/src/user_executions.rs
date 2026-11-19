//! The wire contract of the harness's internal user-execution route, shared
//! by its axum handler (`inbound::internal_user_executions`) and its client
//! (`outbound::harness_user_executions`).

use crate::domain::{CodeModeError, MentionContext};
use axum::http::StatusCode;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// Where the route is mounted, relative to the service root.
pub const USER_EXECUTIONS_PATH: &str = "/internal/code-mode/user-executions";

/// One program to run as `user_id`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserExecutionCommand {
    /// The user whose access every SDK call uses: the person who mentioned
    /// the bot, exactly as the bot's direct tools would act.
    pub user_id: MacroUserIdStr<'static>,
    /// The mention this run answers.
    pub mention: MentionContext,
    /// The JavaScript module.
    pub source: String,
    /// Total deadline in milliseconds.
    pub timeout_ms: u64,
}

/// A safe failure, with its HTTP status.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum UserExecutionFailure {
    /// The harness has no Deno runtime.
    Unavailable,
    /// The executor's queue is full.
    Busy,
    /// The program or its deadline was refused before it ran.
    Invalid {
        /// Why, safe to show the model.
        message: String,
    },
    /// The request was malformed.
    BadRequest,
    /// Anything else; details stay in server diagnostics.
    Failed,
}

impl UserExecutionFailure {
    /// The status this failure is answered with.
    pub fn status(&self) -> StatusCode {
        match self {
            Self::Unavailable | Self::Busy => StatusCode::SERVICE_UNAVAILABLE,
            Self::Invalid { .. } | Self::BadRequest => StatusCode::BAD_REQUEST,
            Self::Failed => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl From<CodeModeError> for UserExecutionFailure {
    fn from(error: CodeModeError) -> Self {
        match error {
            CodeModeError::Unavailable => Self::Unavailable,
            CodeModeError::Busy => Self::Busy,
            CodeModeError::Invalid(message) => Self::Invalid { message },
            error => {
                tracing::error!(error = ?error, "internal user execution failed");
                Self::Failed
            }
        }
    }
}

impl From<UserExecutionFailure> for CodeModeError {
    fn from(failure: UserExecutionFailure) -> Self {
        match failure {
            UserExecutionFailure::Busy => Self::Busy,
            UserExecutionFailure::Invalid { message } => Self::Invalid(message),
            UserExecutionFailure::Unavailable | UserExecutionFailure::BadRequest => {
                Self::Unavailable
            }
            // The program may have run before the harness failed.
            UserExecutionFailure::Failed => Self::Unconfirmed,
        }
    }
}
