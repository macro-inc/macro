//! AES-256-GCM envelopes with a fresh owner-bound KMS data key per write.

use crate::domain::{ConnectionError, ConnectionState, EncryptedState, StateCipher};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use async_trait::async_trait;
use aws_sdk_kms::{primitives::Blob, types::DataKeySpec};
use std::collections::HashMap;
use zeroize::Zeroizing;

const VERSION: u8 = 1;
const PURPOSE: &str = "codex-oauth-connection";
const MAX_PLAINTEXT_BYTES: usize = 512 * 1024;

/// KMS envelope cipher; data keys are never cached between operations.
pub struct EnvelopeCipher {
    keys: Box<dyn DataKeys>,
}
impl EnvelopeCipher {
    /// Create a cipher with a dedicated CMK. Requires GenerateDataKey and Decrypt.
    pub fn new(client: aws_sdk_kms::Client, key_id: String) -> Result<Self, ConnectionError> {
        if key_id.trim().is_empty() {
            return Err(ConnectionError::InvalidInput);
        }
        Ok(Self {
            keys: Box::new(KmsDataKeys { client, key_id }),
        })
    }
}
fn context(owner: &str) -> HashMap<String, String> {
    HashMap::from([
        ("purpose".into(), PURPOSE.into()),
        ("owner".into(), owner.into()),
        ("version".into(), VERSION.to_string()),
    ])
}
fn aad(owner: &str) -> Vec<u8> {
    // JSON encodes boundaries unambiguously even if an owner contains punctuation.
    serde_json::to_vec(&(PURPOSE, VERSION, owner)).expect("string tuple serialization cannot fail")
}
#[async_trait]
impl StateCipher for EnvelopeCipher {
    async fn encrypt(
        &self,
        owner: &str,
        state: &ConnectionState,
    ) -> Result<EncryptedState, ConnectionError> {
        let plaintext =
            Zeroizing::new(serde_json::to_vec(state).map_err(|_| ConnectionError::Encryption)?);
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(ConnectionError::Encryption);
        }
        let key = self.keys.generate(context(owner)).await?;
        let cipher =
            Aes256Gcm::new_from_slice(&key.plaintext).map_err(|_| ConnectionError::Encryption)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &aad(owner),
                },
            )
            .map_err(|_| ConnectionError::Encryption)?;
        Ok(EncryptedState {
            version: VERSION,
            ciphertext,
            encrypted_data_key: key.encrypted,
            nonce: nonce.to_vec(),
            kms_key_id: key.key_id,
        })
    }
    async fn decrypt(
        &self,
        owner: &str,
        envelope: &EncryptedState,
    ) -> Result<ConnectionState, ConnectionError> {
        if envelope.version != VERSION
            || envelope.nonce.len() != 12
            || envelope.ciphertext.len() > MAX_PLAINTEXT_BYTES + 16
            || envelope.ciphertext.len() < 16
            || envelope.encrypted_data_key.is_empty()
            || envelope.encrypted_data_key.len() > 16 * 1024
            || envelope.kms_key_id.is_empty()
        {
            return Err(ConnectionError::Encryption);
        }
        let key = self
            .keys
            .decrypt(
                &envelope.kms_key_id,
                &envelope.encrypted_data_key,
                context(owner),
            )
            .await?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| ConnectionError::Encryption)?;
        let nonce_bytes: [u8; 12] = envelope
            .nonce
            .as_slice()
            .try_into()
            .map_err(|_| ConnectionError::Encryption)?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    &Nonce::from(nonce_bytes),
                    Payload {
                        msg: &envelope.ciphertext,
                        aad: &aad(owner),
                    },
                )
                .map_err(|_| ConnectionError::Encryption)?,
        );
        serde_json::from_slice(&plaintext).map_err(|_| ConnectionError::Encryption)
    }
}
struct DataKey {
    plaintext: Zeroizing<Vec<u8>>,
    encrypted: Vec<u8>,
    key_id: String,
}
#[async_trait]
trait DataKeys: Send + Sync {
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, ConnectionError>;
    async fn decrypt(
        &self,
        key_id: &str,
        ciphertext: &[u8],
        context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, ConnectionError>;
}
struct KmsDataKeys {
    client: aws_sdk_kms::Client,
    key_id: String,
}
#[async_trait]
impl DataKeys for KmsDataKeys {
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, ConnectionError> {
        let output = self
            .client
            .generate_data_key()
            .key_id(&self.key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(context))
            .send()
            .await
            .map_err(|_| ConnectionError::Encryption)?;
        Ok(DataKey {
            plaintext: Zeroizing::new(
                output
                    .plaintext
                    .ok_or(ConnectionError::Encryption)?
                    .into_inner(),
            ),
            encrypted: output
                .ciphertext_blob
                .ok_or(ConnectionError::Encryption)?
                .into_inner(),
            key_id: output.key_id.ok_or(ConnectionError::Encryption)?,
        })
    }
    async fn decrypt(
        &self,
        key_id: &str,
        ciphertext: &[u8],
        context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, ConnectionError> {
        let output = self
            .client
            .decrypt()
            .key_id(key_id)
            .ciphertext_blob(Blob::new(ciphertext))
            .set_encryption_context(Some(context))
            .send()
            .await
            .map_err(|_| ConnectionError::Encryption)?;
        Ok(Zeroizing::new(
            output
                .plaintext
                .ok_or(ConnectionError::Encryption)?
                .into_inner(),
        ))
    }
}

#[cfg(test)]
mod test;
