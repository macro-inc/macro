use email_api_client::domain::models::EmailApiError;

/// Why a gmail_ops operation did not finish.
#[derive(Debug)]
pub enum OperationError {
    Gmail(EmailApiError),
    /// Recording the operation's outcome failed. Gmail writes are idempotent,
    /// so the operation runs again.
    Database(anyhow::Error),
    /// A newer label write on one of the operation's messages is still on its
    /// way. If Gmail rejects it, this one has to send after all.
    WaitingForNewerWrite,
}

impl From<EmailApiError> for OperationError {
    fn from(error: EmailApiError) -> Self {
        Self::Gmail(error)
    }
}
