//! Team-bound AWS KMS credential encryption.

use async_trait::async_trait;
use aws_sdk_kms::primitives::Blob;
use std::collections::HashMap;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::domain::{connection::AccessToken, models::MessagingError, ports::*};

/// Existing KMS infrastructure protects bounded Meta tokens. Encryption context
/// prevents ciphertext copied between teams/connections from being usable.
pub struct KmsCredentialCipher {
    client: aws_sdk_kms::Client,
    key_id: String,
}
impl KmsCredentialCipher {
    /// Require an explicitly configured key; no plaintext or fallback key path.
    pub fn new(client: aws_sdk_kms::Client, key_id: String) -> Result<Self, MessagingError> {
        if key_id.trim().is_empty() {
            return Err(MessagingError::Invalid(
                "Meta credential KMS key is missing",
            ));
        }
        Ok(Self { client, key_id })
    }
}
fn context(team: Uuid, connection: Uuid) -> HashMap<String, String> {
    HashMap::from([
        ("purpose".into(), "meta-business-messaging-v1".into()),
        ("team".into(), team.to_string()),
        ("connection".into(), connection.to_string()),
    ])
}
#[async_trait]
impl CredentialCipher for KmsCredentialCipher {
    async fn encrypt(
        &self,
        team: Uuid,
        connection: Uuid,
        token: &AccessToken,
    ) -> PortResult<Vec<u8>> {
        let result = self
            .client
            .encrypt()
            .key_id(&self.key_id)
            .plaintext(Blob::new(token.expose().as_bytes()))
            .set_encryption_context(Some(context(team, connection)))
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        result
            .ciphertext_blob
            .map(Blob::into_inner)
            .ok_or_else(|| MessagingError::Unavailable.into())
    }
    async fn decrypt(
        &self,
        team: Uuid,
        connection: Uuid,
        sealed: &[u8],
    ) -> PortResult<AccessToken> {
        let result = self
            .client
            .decrypt()
            .key_id(&self.key_id)
            .ciphertext_blob(Blob::new(sealed))
            .set_encryption_context(Some(context(team, connection)))
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        let bytes = Zeroizing::new(
            result
                .plaintext
                .ok_or(MessagingError::Unavailable)?
                .into_inner(),
        );
        let text = std::str::from_utf8(&bytes).map_err(|_| MessagingError::Unavailable)?;
        AccessToken::new(text.to_owned()).map_err(Into::into)
    }
}
