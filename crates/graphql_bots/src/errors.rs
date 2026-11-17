use async_graphql::ErrorExtensions as _;
use bots::domain::ports::BotError;
use entity_access::domain::models::AccessError;

/// Why a bot read failed, in the terms a GraphQL client acts on.
#[derive(Debug)]
pub(crate) enum BotReadError {
    /// The request itself is wrong; retrying it won't help.
    BadInput(String),
    /// The viewer may not read this channel's bots.
    Forbidden,
    /// A backing service failed; the detail is logged, not returned.
    Unavailable(String),
}

/// The client message for a backing-service failure.
const UNAVAILABLE_MESSAGE: &str = "bots are unavailable";

impl From<BotError> for BotReadError {
    fn from(error: BotError) -> Self {
        match error {
            BotError::BadRequest(message) => Self::BadInput(message),
            BotError::Unauthorized | BotError::NotFound(_) => Self::Forbidden,
            BotError::AgentTeammateComputer | BotError::Unavailable(_) | BotError::Repo(_) => {
                Self::Unavailable(format!("{error:?}"))
            }
        }
    }
}

impl From<AccessError> for BotReadError {
    fn from(error: AccessError) -> Self {
        match error {
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_) => Self::Forbidden,
            AccessError::BadRequest(message) => Self::BadInput(message.to_string()),
            AccessError::Unavailable(_) | AccessError::Internal(_) => {
                Self::Unavailable(format!("{error:?}"))
            }
        }
    }
}

impl From<BotReadError> for async_graphql::Error {
    fn from(error: BotReadError) -> Self {
        let (message, code) = match error {
            BotReadError::BadInput(message) => (message, "BAD_USER_INPUT"),
            BotReadError::Forbidden => ("channel is not accessible".to_string(), "FORBIDDEN"),
            BotReadError::Unavailable(detail) => {
                tracing::error!(error = %detail, "{UNAVAILABLE_MESSAGE}");
                (UNAVAILABLE_MESSAGE.to_string(), "INTERNAL_SERVER_ERROR")
            }
        };
        async_graphql::Error::new(message).extend_with(|_, extensions| {
            extensions.set("code", code);
        })
    }
}
