//! Wrapping data keys with AWS KMS.

#[cfg(any(test, feature = "fake"))]
mod fake;
#[cfg(test)]
mod test;

use std::collections::HashMap;

use aws_sdk_kms::primitives::Blob;
use aws_sdk_kms::types::DataKeySpec;
use zeroize::Zeroizing;

#[cfg(any(test, feature = "fake"))]
pub use fake::FakeKms;

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
#[error("data key kms operation failed")]
pub struct KmsError {
    retryable: bool,
}

impl KmsError {
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

/// The KMS operations envelope encryption needs, as a seam tests can stand
/// in for.
pub trait EnvelopeKms: Send + Sync {
    /// Generates a 256-bit data key wrapped under the configured KMS key and
    /// `encryption_context`.
    fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<GeneratedDataKey, KmsError>> + Send;

    /// Unwraps a data key, which KMS refuses unless `encryption_context`
    /// matches the one it was generated with. `kms_key_id` is the key the row
    /// recorded; the AWS adapter ignores it and only ever uses its configured
    /// key, so changing that key means sealing everything again.
    fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<Zeroizing<Vec<u8>>, KmsError>> + Send;
}

/// The encryption context of a data key: `macro:purpose`,
/// `macro:encryption-version` and each of `fields` as `macro:<name>`.
///
/// Build a feature's context in exactly one place: a context that differs at
/// all is a key nothing can unwrap again.
pub fn encryption_context(
    purpose: &str,
    encryption_version: i16,
    fields: &[(&str, &str)],
) -> HashMap<String, String> {
    [
        ("purpose", purpose.to_owned()),
        ("encryption-version", encryption_version.to_string()),
    ]
    .into_iter()
    .chain(
        fields
            .iter()
            .map(|(name, value)| (*name, (*value).to_owned())),
    )
    .map(|(name, value)| (format!("macro:{name}"), value))
    .collect()
}

/// [`EnvelopeKms`] over a real AWS KMS client.
#[derive(Clone)]
pub struct AwsKms {
    client: aws_sdk_kms::Client,
    kms_key_id: String,
}

impl AwsKms {
    /// Generates data keys under `kms_key_id`, and unwraps them.
    pub fn new(client: aws_sdk_kms::Client, kms_key_id: String) -> Self {
        Self { client, kms_key_id }
    }
}

impl EnvelopeKms for AwsKms {
    #[tracing::instrument(name = "kms.generate_data_key", skip_all, err)]
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, KmsError> {
        let response = self
            .client
            .generate_data_key()
            .key_id(&self.kms_key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|error| KmsError::from_sdk(&error))?;
        let plaintext = response.plaintext.ok_or(KmsError::refused())?;
        let ciphertext = response.ciphertext_blob.ok_or(KmsError::refused())?;
        Ok(GeneratedDataKey {
            plaintext: Zeroizing::new(plaintext.into_inner()),
            ciphertext: ciphertext.into_inner(),
            // The response names the fully qualified ARN even when the
            // configured id is an alias, which is what the row records.
            kms_key_id: response.key_id.ok_or(KmsError::refused())?,
        })
    }

    #[tracing::instrument(name = "kms.decrypt", skip_all, err)]
    async fn decrypt(
        &self,
        _kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, KmsError> {
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
            .map_err(|error| KmsError::from_sdk(&error))?;
        let plaintext = response.plaintext.ok_or(KmsError::refused())?;
        Ok(Zeroizing::new(plaintext.into_inner()))
    }
}
