//! Mailbox credentials encrypted with AWS KMS.
//!
//! Direct `kms:Encrypt`, as `cursor_api_key` does: a scoped provider key is
//! well under KMS's 4 KB direct limit, so an envelope would add a data key,
//! a nonce and local AES for nothing. KMS gates every decrypt, and the
//! encryption context binds each ciphertext to one mailbox and one agent: a
//! row copied to another mailbox or account does not decrypt.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use aws_sdk_kms::primitives::Blob;
use macro_user_id::user_id::MacroUserIdStr;
use zeroize::Zeroizing;

use crate::domain::models::{AgentMailboxId, EncryptedMailboxKey, MailboxKey};
use crate::domain::ports::MailboxKeyCipher;

/// The scheme this module writes, stored on every row.
pub const ENCRYPTION_VERSION: i16 = 1;

/// Names the purpose in the encryption context, so another feature's
/// ciphertext never decrypts as a mailbox credential under the same key.
const ENCRYPTION_PURPOSE: &str = "agent-mailbox-key";

/// A KMS call failed. Opaque on purpose: why KMS refused belongs in
/// CloudTrail, not in a response a caller could probe.
#[derive(Debug, thiserror::Error)]
#[error("agent mailbox key kms operation failed")]
pub struct MailboxKmsError;

/// Why a credential could not be encrypted or decrypted.
#[derive(Debug, thiserror::Error)]
pub enum MailboxKeyCipherError {
    /// The KMS call failed, including on a context mismatch.
    #[error(transparent)]
    Kms(#[from] MailboxKmsError),
    /// The row was written by a scheme this build does not read.
    #[error("agent mailbox key uses unsupported encryption version {0}")]
    UnsupportedVersion(i16),
    /// The decrypted bytes are not text.
    #[error("agent mailbox key plaintext is malformed")]
    MalformedPlaintext,
}

/// The KMS operations the cipher needs, as a seam tests stand in for.
pub trait MailboxKms: Send + Sync + 'static {
    /// Encrypt under the configured key; returns the ciphertext and the key used.
    fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> impl Future<Output = Result<(Vec<u8>, String), MailboxKmsError>> + Send;

    /// Decrypt, which KMS refuses unless the context matches.
    fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> impl Future<Output = Result<Zeroizing<Vec<u8>>, MailboxKmsError>> + Send;
}

/// The one place the encryption context is built: a context that differs
/// at all is a ciphertext nothing can decrypt again.
fn encryption_context(
    mailbox: AgentMailboxId,
    agent: &MacroUserIdStr<'_>,
) -> HashMap<String, String> {
    HashMap::from([
        ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
        (
            "macro:encryption-version".to_owned(),
            ENCRYPTION_VERSION.to_string(),
        ),
        ("macro:mailbox-id".to_owned(), mailbox.to_string()),
        (
            "macro:user-id".to_owned(),
            AsRef::<str>::as_ref(&**agent).to_owned(),
        ),
    ])
}

/// [`MailboxKeyCipher`] over KMS.
#[derive(Clone)]
pub struct KmsMailboxKeyCipher<Kms> {
    kms: Kms,
}

impl<Kms> KmsMailboxKeyCipher<Kms> {
    /// Wrap the KMS operations.
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

impl<Kms: MailboxKms> MailboxKeyCipher for KmsMailboxKeyCipher<Kms> {
    type Err = MailboxKeyCipherError;

    async fn encrypt(
        &self,
        mailbox: AgentMailboxId,
        agent: &MacroUserIdStr<'_>,
        key: &MailboxKey,
    ) -> Result<EncryptedMailboxKey, Self::Err> {
        let (ciphertext, kms_key_id) = self
            .kms
            .encrypt(encryption_context(mailbox, agent), key.expose().as_bytes())
            .await?;
        Ok(EncryptedMailboxKey {
            ciphertext,
            kms_key_id,
            encryption_version: ENCRYPTION_VERSION,
        })
    }

    async fn decrypt(
        &self,
        mailbox: AgentMailboxId,
        agent: &MacroUserIdStr<'_>,
        key: &EncryptedMailboxKey,
    ) -> Result<MailboxKey, Self::Err> {
        // Checked before KMS: an unknown scheme is our bug, not worth a KMS call.
        if key.encryption_version != ENCRYPTION_VERSION {
            return Err(MailboxKeyCipherError::UnsupportedVersion(
                key.encryption_version,
            ));
        }
        let plaintext = self
            .kms
            .decrypt(
                &key.kms_key_id,
                &key.ciphertext,
                encryption_context(mailbox, agent),
            )
            .await?;
        let text = std::str::from_utf8(&plaintext)
            .map_err(|_| MailboxKeyCipherError::MalformedPlaintext)?;
        Ok(MailboxKey::new(text.to_owned()))
    }
}

/// [`MailboxKms`] over a real KMS client and the feature's own key.
#[derive(Clone)]
pub struct AwsMailboxKms {
    client: aws_sdk_kms::Client,
    kms_key_id: String,
}

/// Longest one KMS call may take, retries included, so a provisioning step
/// stays well inside the mailbox lease (`LEASE_TTL`).
pub const KMS_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

impl AwsMailboxKms {
    /// Encrypt under `kms_key_id`, a key used for nothing else, and decrypt.
    /// Every call gives up after [`KMS_CALL_TIMEOUT`].
    pub fn new(client: aws_sdk_kms::Client, kms_key_id: String) -> Self {
        let config = client
            .config()
            .to_builder()
            .timeout_config(
                aws_sdk_kms::config::timeout::TimeoutConfig::builder()
                    .operation_timeout(KMS_CALL_TIMEOUT)
                    .build(),
            )
            .build();
        Self {
            client: aws_sdk_kms::Client::from_conf(config),
            kms_key_id,
        }
    }
}

impl MailboxKms for AwsMailboxKms {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), MailboxKmsError> {
        let response = self
            .client
            .encrypt()
            .key_id(&self.kms_key_id)
            .plaintext(Blob::new(plaintext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(error = %aws_sdk_kms::error::DisplayErrorContext(&error), "agent mailbox kms encrypt failed");
                MailboxKmsError
            })?;
        let ciphertext = response.ciphertext_blob.ok_or(MailboxKmsError)?;
        // The response names the full key ARN even when configured by alias.
        let kms_key_id = response.key_id.unwrap_or_else(|| self.kms_key_id.clone());
        Ok((ciphertext.into_inner(), kms_key_id))
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, MailboxKmsError> {
        let response = self
            .client
            .decrypt()
            // Named explicitly, so a blob under some other key never decrypts here.
            .key_id(kms_key_id)
            .ciphertext_blob(Blob::new(ciphertext))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(error = %aws_sdk_kms::error::DisplayErrorContext(&error), "agent mailbox kms decrypt failed");
                MailboxKmsError
            })?;
        let plaintext = response.plaintext.ok_or(MailboxKmsError)?;
        Ok(Zeroizing::new(plaintext.into_inner()))
    }
}

/// No KMS key is configured: every operation fails. Only composed where no
/// provisioning key is configured either, so nothing reaches it.
impl<Kms: MailboxKms> MailboxKms for Option<Kms> {
    async fn encrypt(
        &self,
        encryption_context: HashMap<String, String>,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, String), MailboxKmsError> {
        match self {
            Some(kms) => kms.encrypt(encryption_context, plaintext).await,
            None => Err(MailboxKmsError),
        }
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, MailboxKmsError> {
        match self {
            Some(kms) => {
                kms.decrypt(kms_key_id, ciphertext, encryption_context)
                    .await
            }
            None => Err(MailboxKmsError),
        }
    }
}
