//! KMS encryption with context binding and zeroized plaintext buffers.
use crate::domain::{models::*, ports::CredentialCipher};
use aws_sdk_kms::{Client, primitives::Blob};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};
mod health;
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum DecryptOutcome {
    Available,
    Unreadable,
    Unavailable,
}

/// Direct KMS encryption for the small endpoint/credential document.
pub struct KmsCipher {
    client: Client,
    key_id: String,
    health: Mutex<health::Health>,
}
impl KmsCipher {
    /// Bind all operations to one service-owned KMS key.
    pub fn new(client: Client, key_id: String) -> Self {
        Self {
            client,
            key_id,
            health: Mutex::default(),
        }
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
    #[tracing::instrument(name = "imap.credentials.decrypt", skip_all, fields(credentials.outcome = tracing::field::Empty), err)]
    async fn decrypt(
        &self,
        id: Uuid,
        owner: &str,
        ciphertext: &[u8],
    ) -> Result<Credentials, Error> {
        let result = async {
            let context = context(id, owner);
            let ordered = BTreeMap::from_iter(context.iter());
            let fingerprint: [u8; 32] = Sha256::digest(
                serde_json::to_vec(&ordered).map_err(|_| Error::CredentialsUnavailable)?,
            )
            .into();
            match self.decrypt_document(context.clone(), ciphertext).await {
                Ok((credentials, key_arn)) => {
                    // Verification documents have no permanent binding. They
                    // must not inflate the distinct-account fleet sample.
                    if credentials
                        .binding
                        .is_some_and(|binding| binding.link_id == id)
                        && credentials.user_id == owner
                    {
                        self.health
                            .lock()
                            .map_err(|_| Error::CredentialsUnavailable)?
                            .success(id, fingerprint, key_arn, ciphertext);
                    }
                    Ok(credentials)
                }
                Err(DecryptFailure::Unavailable) => Err(Error::CredentialsUnavailable),
                Err(DecryptFailure::InvalidCiphertext) => {
                    let canary = self
                        .health
                        .lock()
                        .map_err(|_| Error::CredentialsUnavailable)?
                        .canary(id, fingerprint, ciphertext)
                        .ok_or(Error::CredentialsUnavailable)?;
                    // A previously readable ciphertext must STILL work through the
                    // current alias and identical context. Key/context/policy drift
                    // cannot be diagnosed as one user's damaged saved credential.
                    let (decoded, key_arn) = self
                        .decrypt_document(context, &canary.ciphertext)
                        .await
                        .map_err(|_| Error::CredentialsUnavailable)?;
                    drop(decoded);
                    if key_arn.as_deref() != Some(canary.key_arn.as_str()) {
                        return Err(Error::CredentialsUnavailable);
                    }
                    if self
                        .health
                        .lock()
                        .map_err(|_| Error::CredentialsUnavailable)?
                        .unreadable(id)
                    {
                        Err(Error::CredentialsUnreadable)
                    } else {
                        Err(Error::CredentialsUnavailable)
                    }
                }
            }
        }
        .await;
        let outcome = match &result {
            Ok(_) => DecryptOutcome::Available,
            Err(Error::CredentialsUnreadable) => DecryptOutcome::Unreadable,
            Err(_) => DecryptOutcome::Unavailable,
        };
        tracing::Span::current().record("credentials.outcome", outcome.as_ref());
        result
    }
}

#[cfg(test)]
mod test;

enum DecryptFailure {
    InvalidCiphertext,
    Unavailable,
}

impl KmsCipher {
    async fn decrypt_document(
        &self,
        context: HashMap<String, String>,
        ciphertext: &[u8],
    ) -> Result<(Credentials, Option<String>), DecryptFailure> {
        let result = self
            .client
            .decrypt()
            .key_id(&self.key_id)
            .set_encryption_context(Some(context))
            .ciphertext_blob(Blob::new(ciphertext))
            .send()
            .await
            .map_err(|error| {
                if error
                    .as_service_error()
                    .is_some_and(|error| error.is_invalid_ciphertext_exception())
                {
                    DecryptFailure::InvalidCiphertext
                } else {
                    DecryptFailure::Unavailable
                }
            })?;
        let bytes = Zeroizing::new(
            result
                .plaintext
                .ok_or(DecryptFailure::Unavailable)?
                .into_inner(),
        );
        // A valid decrypt with a newer document schema may be an ordinary rollback.
        let credentials =
            serde_json::from_slice(bytes.as_slice()).map_err(|_| DecryptFailure::Unavailable)?;
        Ok((credentials, result.key_id))
    }
}
