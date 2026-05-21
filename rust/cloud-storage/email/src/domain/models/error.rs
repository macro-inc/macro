use frecency::domain::models::FrecencyQueryErr;
use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur in the email domain.
#[derive(Debug, Error)]
pub enum EmailErr {
    /// A repository/infrastructure error.
    #[error(transparent)]
    RepoErr(#[from] anyhow::Error),
    /// An external provider API error (e.g. Gmail API).
    #[error("Provider error: {0}")]
    ProviderErr(anyhow::Error),
    /// A frecency query error.
    #[error(transparent)]
    Frecency(#[from] FrecencyQueryErr),
    /// The referenced message was not found.
    #[error("Message with id {0} not found")]
    MessageNotFound(Uuid),
    /// The referenced message has already been sent and cannot be modified.
    #[error("Message with id {0} has already been sent")]
    MessageAlreadySent(Uuid),
    /// Cannot reply to a draft message.
    #[error("Cannot reply to a draft")]
    CannotReplyToDraft,
    /// Failed to decode base64 body content.
    #[error("Failed to decode base64 HTML body")]
    Base64DecodeError(#[from] base64::DecodeError),
    /// Decoded bytes are not valid UTF-8.
    #[error("Failed to convert decoded HTML body to UTF-8")]
    Utf8Error(#[from] std::string::FromUtf8Error),
    /// The referenced label was not found.
    #[error("Label not found")]
    LabelNotFound,
    /// The label has an empty provider label ID.
    #[error("Label has empty provider label ID")]
    EmptyProviderLabelId,
    /// No messages found for thread.
    #[error("No messages found for thread")]
    ThreadEmpty,
    /// Thread not found.
    #[error("Thread not found")]
    ThreadNotFound,
    /// The caller does not have permission to perform this action.
    #[error("You do not have permission to perform this action")]
    Unauthorized,
    /// Failed to enqueue a message to a worker queue.
    #[error("Enqueue error: {0}")]
    EnqueueErr(anyhow::Error),
    /// Invalid email filter input.
    #[error("{0}")]
    InvalidEmailFilter(String),
    /// A team-scoped query referenced an email domain that is either not
    /// tracked as a CRM organization for the team, or whose organization
    /// has `email_sync` disabled. Without email_sync, the team has not
    /// opted into sharing emails for that organization across members.
    #[error(
        "Domain {0} is not authorized for team-scoped email queries (no matching CRM organization, or organization has email_sync disabled)"
    )]
    DomainNotPermittedForTeamScope(String),
}
