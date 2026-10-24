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
/// Deliberately opaque: the AWS error can tell "wrong encryption context"
/// from "no permission", and a caller that can tell them apart can probe. The
/// detail belongs in CloudTrail.
#[derive(Debug, thiserror::Error)]
#[error("whatsapp data key kms operation failed")]
pub struct WhatsAppKmsError;

/// The KMS operations the store needs, as a seam tests can stand in for.
pub trait WhatsAppKms: Send + Sync {
    /// Generates a 256-bit data key wrapped under the configured KMS key and
    /// `encryption_context`.
    fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<GeneratedDataKey, WhatsAppKmsError>> + Send;

    /// Unwraps a data key, which KMS refuses unless `encryption_context`
    /// matches the one it was generated with.
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
            .map_err(|_| WhatsAppKmsError)?;
        let plaintext = response.plaintext.ok_or(WhatsAppKmsError)?;
        let ciphertext = response.ciphertext_blob.ok_or(WhatsAppKmsError)?;
        Ok(GeneratedDataKey {
            plaintext: Zeroizing::new(plaintext.into_inner()),
            ciphertext: ciphertext.into_inner(),
            // The response names the fully qualified ARN even when the
            // configured id is an alias, which is what the row should record.
            kms_key_id: response.key_id.unwrap_or_else(|| self.kms_key_id.clone()),
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, WhatsAppKmsError> {
        let response = self
            .client
            .decrypt()
            // Named explicitly, so a blob wrapped under another key cannot be
            // unwrapped here just because this role can use that key.
            .key_id(kms_key_id)
            .ciphertext_blob(Blob::new(ciphertext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|_| WhatsAppKmsError)?;
        let plaintext = response.plaintext.ok_or(WhatsAppKmsError)?;
        Ok(Zeroizing::new(plaintext.into_inner()))
    }
}
