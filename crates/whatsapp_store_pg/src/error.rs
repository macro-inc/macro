//! Store failures, and how they reach whatsmeow.

use whatsmeow::store::StoreError;

use crate::kms::WhatsAppKmsError;

/// Why a store operation failed.
///
/// Carries no stored values or keys: these errors end up in logs.
#[derive(Debug, thiserror::Error)]
pub enum WhatsAppStoreError {
    /// The account's lease epoch is no longer the one this store was opened
    /// with: another replica took the account over, so this one must stop.
    /// Nothing was written.
    #[error("whatsapp account lease was taken over; this store is fenced out")]
    Fenced,
    /// The linked account does not exist (or was deleted).
    #[error("whatsapp linked account not found")]
    AccountNotFound,
    /// The device was deleted (logged out) after this store was opened.
    #[error("whatsapp device was deleted")]
    DeviceDeleted,
    /// Wrapping or unwrapping the data key failed, including because the
    /// encryption context did not match.
    #[error(transparent)]
    Kms(#[from] WhatsAppKmsError),
    /// The device row was written by a scheme this build does not know.
    #[error("whatsapp store uses unsupported encryption version {0}")]
    UnsupportedVersion(i16),
    /// A stored value did not decrypt: it was tampered with, or moved from
    /// another row, store or account.
    #[error("a stored whatsapp value failed to decrypt")]
    Decrypt,
    /// A value could not be encrypted.
    #[error("a whatsapp value failed to encrypt")]
    Encrypt,
    /// A stored value decrypted but is not what its store holds.
    #[error("a stored whatsapp value is malformed")]
    Malformed,
    /// The call was invalid.
    #[error("{0}")]
    InvalidArgument(String),
    /// Postgres failed.
    #[error("whatsapp store database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl From<WhatsAppStoreError> for StoreError {
    fn from(error: WhatsAppStoreError) -> Self {
        match error {
            WhatsAppStoreError::InvalidArgument(message) => StoreError::InvalidArgument(message),
            WhatsAppStoreError::DeviceDeleted => StoreError::DeviceDeleted,
            error => StoreError::Internal(rootcause::Report::new(error).into_dynamic()),
        }
    }
}

/// Whether a whatsmeow store failure is this store being fenced out, after
/// which the caller must stop using the account instead of retrying.
pub fn is_fenced(error: &StoreError) -> bool {
    match error {
        StoreError::Internal(report) => matches!(
            report.downcast_current_context::<WhatsAppStoreError>(),
            Some(WhatsAppStoreError::Fenced)
        ),
        _ => false,
    }
}
