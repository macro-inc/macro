//! Wrapping an account's data key with AWS KMS.
//!
//! Envelope encryption, as `microsoft_oauth_grant_db_utils` does, not the
//! direct KMS calls of `cursor_api_key`: a device store is thousands of small
//! values written on every message, far too many for a KMS call each. KMS is
//! called once per account to generate the data key (`GenerateDataKey`) and
//! once each time a replica takes the account's lease (`Decrypt`); everything
//! else is local AES-GCM under that key (see [`crate::cipher`]).
//!
//! The wrapped key is bound by its encryption context to one user and one
//! account, and KMS enforces it: a `whatsapp_device` row copied to another
//! account does not unwrap.

#[cfg(any(test, feature = "fake-kms"))]
mod fake;
#[cfg(test)]
mod test;

use std::collections::HashMap;

use aws_sdk_kms::primitives::Blob;
use aws_sdk_kms::types::DataKeySpec;
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(any(test, feature = "fake-kms"))]
pub use fake::FakeWhatsAppKms;

use crate::cipher::ENCRYPTION_VERSION;

/// Names the purpose in the encryption context, so a data key from another
/// feature cannot be unwrapped as a WhatsApp one even under the same KMS key.
const ENCRYPTION_PURPOSE: &str = "whatsapp-session";

/// A freshly generated data key.
pub struct GeneratedDataKey {
    /// The plaintext key. Only for sealing values in memory.
    pub plaintext: Zeroizing<Vec<u8>>,
    /// The key wrapped by KMS, to store.
    pub ciphertext: Vec<u8>,
    /// The KMS key that wrapped it.
    pub kms_key_id: String,
}

impl std::fmt::Debug for GeneratedDataKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GeneratedDataKey")
            .field("kms_key_id", &self.kms_key_id)
            .finish_non_exhaustive()
    }
}

/// A KMS operation failed.
///
/// Deliberately opaque about why KMS refused: the AWS error can tell "wrong
/// encryption context" from "no permission", and a caller that can tell them
/// apart can probe. The detail belongs in CloudTrail. It only says whether
/// trying again can help.
#[derive(Debug, thiserror::Error)]
#[error("whatsapp data key kms operation failed")]
pub struct WhatsAppKmsError {
    retryable: bool,
}

impl WhatsAppKmsError {
    /// KMS answered and refused (wrong key or context, key gone or disabled,
    /// no permission): the same call fails again.
    pub const fn refused() -> Self {
        Self { retryable: false }
    }

    /// KMS could not be reached or asked to slow down: the call can succeed
    /// later.
    pub const fn unavailable() -> Self {
        Self { retryable: true }
    }

    /// Whether the same call can succeed later.
    pub const fn is_retryable(&self) -> bool {
        self.retryable
    }

    /// Classifies an AWS SDK failure: throttling, KMS-side outages and
    /// transport failures are retryable; every other service error is a
    /// refusal.
    fn from_sdk<Error, Response>(error: &aws_sdk_kms::error::SdkError<Error, Response>) -> Self
    where
        Error: aws_sdk_kms::error::ProvideErrorMetadata,
    {
        use aws_sdk_kms::error::SdkError;
        match error {
            SdkError::ServiceError(service) => match service.err().code() {
                Some(
                    "ThrottlingException"
                    | "KMSInternalException"
                    | "DependencyTimeoutException"
                    | "KeyUnavailableException",
                ) => Self::unavailable(),
                _ => Self::refused(),
            },
            _ => Self::unavailable(),
        }
    }
}

/// The KMS operations the store needs, as a seam tests can stand in for.
pub trait WhatsAppKms: Send + Sync {
    /// Generates a 256-bit data key wrapped under the configured KMS key and
    /// `encryption_context`.
    fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<GeneratedDataKey, WhatsAppKmsError>> + Send;

    /// Unwraps a data key, which KMS refuses unless `encryption_context`
    /// matches the one it was generated with. `kms_key_id` is the key the row
    /// recorded; the AWS adapter ignores it and only ever uses its configured
    /// key, so changing that key means relinking the accounts.
    fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<Zeroizing<Vec<u8>>, WhatsAppKmsError>> + Send;
}

/// The encryption context of an account's data key.
///
/// The one place it is built, so it cannot be built two slightly different
/// ways: a context that differs at all is a key nothing can unwrap again.
pub(crate) fn encryption_context(user_id: &str, account_id: Uuid) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        ("macro:user-id".to_owned(), user_id.to_owned()),
        ("macro:account-id".to_owned(), account_id.to_string()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
    ])
}

/// [`WhatsAppKms`] over a real AWS KMS client.
///
/// The key must be separate from the Cursor and Microsoft ones: whatever can
/// unwrap WhatsApp data keys can read every linked account's sessions.
#[derive(Clone)]
pub struct AwsWhatsAppKms {
    client: aws_sdk_kms::Client,
    kms_key_id: String,
}

impl AwsWhatsAppKms {
    /// Generates data keys under `kms_key_id`, and unwraps them.
    pub fn new(client: aws_sdk_kms::Client, kms_key_id: String) -> Self {
        Self { client, kms_key_id }
    }
}

impl WhatsAppKms for AwsWhatsAppKms {
    #[tracing::instrument(skip_all, err)]
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, WhatsAppKmsError> {
        let response = self
            .client
            .generate_data_key()
            .key_id(&self.kms_key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|error| WhatsAppKmsError::from_sdk(&error))?;
        let plaintext = response.plaintext.ok_or(WhatsAppKmsError::refused())?;
        let ciphertext = response
            .ciphertext_blob
            .ok_or(WhatsAppKmsError::refused())?;
        Ok(GeneratedDataKey {
            plaintext: Zeroizing::new(plaintext.into_inner()),
            ciphertext: ciphertext.into_inner(),
            // The response names the fully qualified ARN even when the
            // configured id is an alias, which is what the row records.
            kms_key_id: response.key_id.ok_or(WhatsAppKmsError::refused())?,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn decrypt(
        &self,
        _kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, WhatsAppKmsError> {
        let response = self
            .client
            .decrypt()
            // Always the configured key, never the id stored with the row: a
            // blob wrapped under any other key is refused, even if this role
            // could use that key.
            .key_id(&self.kms_key_id)
            .ciphertext_blob(Blob::new(ciphertext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|error| WhatsAppKmsError::from_sdk(&error))?;
        let plaintext = response.plaintext.ok_or(WhatsAppKmsError::refused())?;
        Ok(Zeroizing::new(plaintext.into_inner()))
    }
}
