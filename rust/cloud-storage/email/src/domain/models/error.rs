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
    /// The caller's team has `team_crm_settings.crm_enabled = false` (or no
    /// row at all), so no CRM-scoped query is allowed.
    #[error("CRM is disabled for this team")]
    CrmDisabledForTeam,
    /// A CRM-scoped query referenced a domain that does not have a matching
    /// `crm_domains` row for the caller's team.
    #[error("CRM domain {0} not found for this team")]
    CrmDomainNotFound(String),
    /// A CRM-scoped query referenced a domain whose company is hidden or
    /// has `email_sync = false`.
    #[error("CRM domain {0} is not permitted for CRM-scoped queries")]
    CrmDomainNotPermitted(String),
    /// A CRM-scoped query referenced an address with no matching
    /// `crm_contacts` row for the caller's team.
    #[error("CRM address {0} not found for this CRM scope")]
    CrmAddressNotFound(String),
    /// A CRM-scoped query referenced an address whose contact or company
    /// is hidden, or whose company has `email_sync = false`.
    #[error("CRM address {0} is not permitted for CRM-scoped queries")]
    CrmAddressNotPermitted(String),
}
