//! KMS encryption with context binding and zeroized plaintext buffers.
use crate::domain::{models::*, ports::CredentialCipher};
use aws_sdk_kms::{Client, primitives::Blob};
use std::collections::HashMap;
use uuid::Uuid;
use zeroize::Zeroizing;

/// Direct KMS encryption for the small endpoint/credential document.
pub struct KmsCipher {
    client: Client,
    key_id: String,
}
impl KmsCipher {
    /// Bind all operations to one service-owned KMS key.
    pub fn new(client: Client, key_id: String) -> Self {
        Self { client, key_id }
    }
}
fn context(id: Uuid, owner: &str) -> HashMap<String, String> {
    HashMap::from([
        ("purpose".into(), "imap-credentials-v1".into()),
        ("object_id".into(), id.to_string()),
        ("user_id".into(), owner.into()),
    ])
}
#[async_trait::async_trait]
impl CredentialCipher for KmsCipher {
    async fn encrypt(&self, id: Uuid, owner: &str, value: &Credentials) -> Result<Vec<u8>, Error> {
        let bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| Error::Invalid)?);
        if bytes.len() > 4096 {
            return Err(Error::Invalid);
        }
        let result = self
            .client
            .encrypt()
            .key_id(&self.key_id)
            .set_encryption_context(Some(context(id, owner)))
            .plaintext(Blob::new(bytes.as_slice()))
            .send()
            .await
            .map_err(|_| Error::CredentialsUnavailable)?;
        result
            .ciphertext_blob
            .map(|b| b.into_inner())
            .ok_or(Error::CredentialsUnavailable)
    }
    async fn decrypt(
        &self,
        id: Uuid,
        owner: &str,
        ciphertext: &[u8],
    ) -> Result<Credentials, Error> {
        let result = self
            .client
            .decrypt()
            .key_id(&self.key_id)
            .set_encryption_context(Some(context(id, owner)))
            .ciphertext_blob(Blob::new(ciphertext))
            .send()
            .await
            .map_err(|_| Error::CredentialsUnavailable)?;
        let bytes = Zeroizing::new(
            result
                .plaintext
                .ok_or(Error::CredentialsUnavailable)?
                .into_inner(),
        );
        serde_json::from_slice(bytes.as_slice()).map_err(|_| Error::CredentialsUnavailable)
    }
}
