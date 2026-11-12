//! One error type for every Slack call, with Slack's `error` strings typed.

use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::method::SlackMethod;

/// Slack's `error` string from an `ok: false` response. Codes this client
/// acts on are variants; anything else is kept verbatim in `Other`.
#[derive(Clone, PartialEq, Eq, Hash, Debug, strum::EnumString, strum::IntoStaticStr, Serialize, Deserialize)]
#[strum(serialize_all = "snake_case")]
#[serde(from = "String", into = "String")]
pub enum SlackErrorCode {
    /// The token or cookie is invalid.
    InvalidAuth,
    /// No token was sent.
    NotAuthed,
    /// The session was signed out.
    TokenRevoked,
    /// The session expired.
    TokenExpired,
    /// The user's account was deactivated.
    AccountInactive,
    /// The workspace was disabled.
    TeamDisabled,
    /// The user was removed from the workspace.
    UserRemovedFromTeam,
    /// An Enterprise Grid policy blocks this client or method.
    EnterpriseIsRestricted,
    /// Too many requests.
    Ratelimited,
    /// Too many requests (login endpoints spell it this way).
    RateLimited,
    /// The conversation doesn't exist or isn't visible.
    ChannelNotFound,
    /// The user isn't a member of the conversation.
    NotInChannel,
    /// The conversation is archived.
    IsArchived,
    /// The message doesn't exist.
    MessageNotFound,
    /// The thread doesn't exist.
    ThreadNotFound,
    /// The user doesn't exist.
    UserNotFound,
    /// The file doesn't exist.
    FileNotFound,
    /// The file was deleted.
    FileDeleted,
    /// The message can't be edited.
    CantUpdateMessage,
    /// The message can't be deleted.
    CantDeleteMessage,
    /// The edit window has passed.
    EditWindowClosed,
    /// The message text is too long.
    MsgTooLong,
    /// Neither text nor blocks were sent.
    NoText,
    /// The reaction is already there.
    AlreadyReacted,
    /// The reaction isn't there.
    NoReaction,
    /// The emoji name is unknown.
    InvalidName,
    /// Posting is restricted in this conversation.
    RestrictedAction,
    /// The Slack Connect conversation was disconnected.
    ChannelIsFrozen,
    /// The token lacks a permission.
    MissingScope,
    /// The method doesn't accept this kind of token.
    NotAllowedTokenType,
    /// Slack failed internally.
    InternalError,
    /// Slack failed internally.
    FatalError,
    /// Slack is unavailable.
    ServiceUnavailable,
    /// Slack timed out.
    RequestTimeout,
    /// Login: Slack wants a CAPTCHA first.
    CaptchaRequired,
    /// Login: the CAPTCHA solution was rejected.
    CaptchaFailed,
    /// Login: the CAPTCHA solution was rejected.
    InvalidCaptcha,
    /// Login: the email address was rejected.
    InvalidEmail,
    /// Login: too many code requests.
    CodeRequestLimitReached,
    /// Login: the emailed code is wrong.
    InvalidCode,
    /// Login: the emailed code is wrong.
    InvalidEmailCode,
    /// Login: the emailed code was used already.
    CodeAlreadyUsed,
    /// Login: the emailed code expired.
    ExpiredCode,
    /// Login: the emailed code expired.
    CodeExpired,
    /// Login: the workspace needs single sign-on.
    SsoRequired,
    /// Login: the workspace needs a two-factor code.
    TwoFactorRequired,
    /// Login: a two-factor code is needed (authenticator app).
    MissingPin,
    /// Login: a two-factor code is needed (authenticator app).
    MissingPinApp,
    /// Login: a two-factor code is needed (SMS).
    MissingPinSms,
    /// Login: the two-factor code is wrong.
    InvalidPin,
    /// Login: the two-factor code is wrong.
    #[strum(serialize = "invalid_2fa_code")]
    Invalid2faCode,
    /// Login: the two-factor code is wrong.
    InvalidTwoFactorCode,
    /// Login: the two-factor challenge expired.
    TwoFactorExpired,
    /// Login: the two-factor challenge expired.
    TwoFactorStateExpired,
    /// Any other code, verbatim.
    #[strum(default)]
    Other(String),
}

impl SlackErrorCode {
    /// The code as Slack writes it.
    pub fn as_str(&self) -> &str {
        match self {
            Self::Other(code) => code,
            known => known.into(),
        }
    }

    /// The session is gone for good: sign in again.
    pub fn is_session_ended(&self) -> bool {
        matches!(
            self,
            Self::InvalidAuth
                | Self::NotAuthed
                | Self::TokenRevoked
                | Self::TokenExpired
                | Self::AccountInactive
                | Self::TeamDisabled
                | Self::UserRemovedFromTeam
        )
    }

    /// A Slack-side failure worth retrying later.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::Ratelimited
                | Self::RateLimited
                | Self::InternalError
                | Self::FatalError
                | Self::ServiceUnavailable
                | Self::RequestTimeout
        )
    }
}

impl From<String> for SlackErrorCode {
    fn from(value: String) -> Self {
        match Self::from_str(&value) {
            Ok(code) => code,
            Err(_) => Self::Other(value),
        }
    }
}

impl From<SlackErrorCode> for String {
    fn from(value: SlackErrorCode) -> String {
        value.as_str().to_owned()
    }
}

impl std::fmt::Display for SlackErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A failed Slack call.
#[derive(Debug, thiserror::Error)]
pub enum SlackError {
    /// Slack answered `ok: false`.
    #[error("slack {method} failed: {code}")]
    Api {
        /// The call.
        method: SlackMethod,
        /// Slack's `error` string.
        code: SlackErrorCode,
    },
    /// Slack kept answering 429 after the client's retries.
    #[error("slack {method} rate limited; retry after {retry_after:?}")]
    RateLimited {
        /// The call.
        method: SlackMethod,
        /// Slack's `Retry-After`.
        retry_after: Duration,
    },
    /// A non-success HTTP status without a Slack error body.
    #[error("slack {method} answered HTTP {status}")]
    HttpStatus {
        /// The call.
        method: SlackMethod,
        /// The status code.
        status: u16,
    },
    /// The request didn't reach Slack or the body couldn't be read.
    #[error("slack {method} request failed")]
    Transport {
        /// The call.
        method: SlackMethod,
        /// The transport error.
        #[source]
        source: reqwest::Error,
    },
    /// Slack's response didn't have the expected shape.
    #[error("slack {method} response could not be decoded")]
    Decode {
        /// The call.
        method: SlackMethod,
        /// The decode error.
        #[source]
        source: serde_json::Error,
    },
    /// A request couldn't be built (bad URL or unencodable body).
    #[error("slack {method} request could not be built: {reason}")]
    InvalidRequest {
        /// The call.
        method: SlackMethod,
        /// What was wrong.
        reason: String,
    },
}

impl SlackError {
    /// The Slack error code, when Slack sent one.
    pub fn code(&self) -> Option<&SlackErrorCode> {
        match self {
            Self::Api { code, .. } => Some(code),
            Self::RateLimited { .. }
            | Self::HttpStatus { .. }
            | Self::Transport { .. }
            | Self::Decode { .. }
            | Self::InvalidRequest { .. } => None,
        }
    }

    /// The session is gone for good: sign in again.
    pub fn is_session_ended(&self) -> bool {
        self.code().is_some_and(SlackErrorCode::is_session_ended)
    }

    /// Worth retrying later: rate limits, Slack outages, network errors.
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Api { code, .. } => code.is_transient(),
            Self::RateLimited { .. } | Self::Transport { .. } => true,
            Self::HttpStatus { status, .. } => *status >= 500 || *status == 429,
            Self::Decode { .. } | Self::InvalidRequest { .. } => false,
        }
    }

    /// How long Slack asked the caller to wait, if it did.
    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::RateLimited { retry_after, .. } => Some(*retry_after),
            Self::Api { .. }
            | Self::HttpStatus { .. }
            | Self::Transport { .. }
            | Self::Decode { .. }
            | Self::InvalidRequest { .. } => None,
        }
    }
}
