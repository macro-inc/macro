#![allow(
    dead_code,
    reason = "cipher wiring is consumed by Microsoft grant persistence in the follow-up task"
)]

use std::collections::HashMap;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use aws_sdk_kms::{Client, primitives::Blob, types::DataKeySpec};
use zeroize::Zeroizing;

const ENCRYPTION_VERSION: i16 = 1;
const AES_256_KEY_LENGTH: usize = 32;
const AES_GCM_NONCE_LENGTH: usize = 12;
const AES_GCM_TAG_LENGTH: usize = 16;
const ENCRYPTION_PURPOSE: &str = "microsoft-refresh-token";

/// An encrypted Microsoft refresh-token envelope suitable for persistence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct EncryptedMicrosoftToken {
    pub(crate) refresh_token_ciphertext: Vec<u8>,
    pub(crate) encrypted_data_key: Vec<u8>,
    pub(crate) nonce: Vec<u8>,
    pub(crate) encryption_version: i16,
    pub(crate) kms_key_id: String,
}

/// A Microsoft refresh token that clears its allocation when dropped.
pub(crate) struct MicrosoftRefreshToken(Zeroizing<String>);

impl MicrosoftRefreshToken {
    pub(crate) fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Encrypts and decrypts Microsoft refresh-token envelopes.
#[async_trait::async_trait]
pub(crate) trait MicrosoftTokenCipher: Send + Sync {
    async fn encrypt(
        &self,
        fusionauth_user_id: &str,
        email_address: &str,
        refresh_token: MicrosoftRefreshToken,
    ) -> Result<EncryptedMicrosoftToken, MicrosoftTokenCipherError>;

    async fn decrypt(
        &self,
        fusionauth_user_id: &str,
        email_address: &str,
        envelope: &EncryptedMicrosoftToken,
    ) -> Result<MicrosoftRefreshToken, MicrosoftTokenCipherError>;
}

/// AES-256-GCM envelope cipher backed by an external data-key provider.
pub(crate) struct EnvelopeMicrosoftTokenCipher<P> {
    data_key_provider: P,
}

impl<P> EnvelopeMicrosoftTokenCipher<P> {
    pub(crate) fn new(data_key_provider: P) -> Self {
        Self { data_key_provider }
    }
}

#[async_trait::async_trait]
impl<P> MicrosoftTokenCipher for EnvelopeMicrosoftTokenCipher<P>
where
    P: DataKeyProvider,
{
    async fn encrypt(
        &self,
        fusionauth_user_id: &str,
        email_address: &str,
        refresh_token: MicrosoftRefreshToken,
    ) -> Result<EncryptedMicrosoftToken, MicrosoftTokenCipherError> {
        let identity = EncryptionIdentity::new(fusionauth_user_id, email_address)?;
        let data_key = self
            .data_key_provider
            .generate_data_key(identity.kms_encryption_context())
            .await?;
        validate_plaintext_data_key(&data_key.plaintext)?;

        let cipher = Aes256Gcm::new_from_slice(&data_key.plaintext)
            .map_err(|_| MicrosoftTokenCipherError::InvalidDataKey)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: refresh_token.as_str().as_bytes(),
                    aad: &identity.aad(),
                },
            )
            .map_err(|_| MicrosoftTokenCipherError::EncryptionFailed)?;

        Ok(EncryptedMicrosoftToken {
            refresh_token_ciphertext: ciphertext,
            encrypted_data_key: data_key.encrypted,
            nonce: nonce.to_vec(),
            encryption_version: ENCRYPTION_VERSION,
            kms_key_id: data_key.key_id,
        })
    }

    async fn decrypt(
        &self,
        fusionauth_user_id: &str,
        email_address: &str,
        envelope: &EncryptedMicrosoftToken,
    ) -> Result<MicrosoftRefreshToken, MicrosoftTokenCipherError> {
        validate_envelope(envelope)?;
        let identity = EncryptionIdentity::new(fusionauth_user_id, email_address)?;
        let plaintext_data_key = self
            .data_key_provider
            .decrypt_data_key(
                &envelope.kms_key_id,
                &envelope.encrypted_data_key,
                identity.kms_encryption_context(),
            )
            .await?;
        validate_plaintext_data_key(&plaintext_data_key)?;

        let cipher = Aes256Gcm::new_from_slice(&plaintext_data_key)
            .map_err(|_| MicrosoftTokenCipherError::InvalidDataKey)?;
        let nonce_bytes: [u8; AES_GCM_NONCE_LENGTH] = envelope
            .nonce
            .as_slice()
            .try_into()
            .map_err(|_| MicrosoftTokenCipherError::MalformedEnvelope)?;
        let nonce = Nonce::from(nonce_bytes);
        let plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &envelope.refresh_token_ciphertext,
                    aad: &identity.aad(),
                },
            )
            .map_err(|_| MicrosoftTokenCipherError::DecryptionFailed)?;
        let mut plaintext = Zeroizing::new(plaintext);
        if std::str::from_utf8(&plaintext).is_err() {
            return Err(MicrosoftTokenCipherError::MalformedPlaintext);
        }

        // UTF-8 was validated above. Moving the allocation into String avoids another plaintext
        // copy, and the returned wrapper zeroizes that allocation on drop.
        let plaintext = String::from_utf8(std::mem::take(&mut *plaintext))
            .map_err(|_| MicrosoftTokenCipherError::MalformedPlaintext)?;
        Ok(MicrosoftRefreshToken::new(plaintext))
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum MicrosoftTokenCipherError {
    #[error("Microsoft token data-key operation failed")]
    DataKey(#[from] DataKeyProviderError),
    #[error("Microsoft token identity is malformed")]
    MalformedIdentity,
    #[error("Microsoft token envelope is malformed")]
    MalformedEnvelope,
    #[error("Microsoft token plaintext is malformed")]
    MalformedPlaintext,
    #[error("Microsoft token envelope uses unsupported encryption version {0}")]
    UnsupportedVersion(i16),
    #[error("Microsoft token data key is invalid")]
    InvalidDataKey,
    #[error("Microsoft token encryption failed")]
    EncryptionFailed,
    #[error("Microsoft token decryption failed")]
    DecryptionFailed,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum DataKeyProviderError {
    #[error("KMS GenerateDataKey failed")]
    GenerateFailed,
    #[error("KMS Decrypt failed")]
    DecryptFailed,
    #[error("KMS returned a malformed data key")]
    MalformedResponse,
}

struct GeneratedDataKey {
    plaintext: Zeroizing<Vec<u8>>,
    encrypted: Vec<u8>,
    key_id: String,
}

#[async_trait::async_trait]
trait DataKeyProvider: Send + Sync {
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, DataKeyProviderError>;

    async fn decrypt_data_key(
        &self,
        key_id: &str,
        encrypted_data_key: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, DataKeyProviderError>;
}

/// KMS implementation of the envelope data-key provider.
pub(crate) struct KmsDataKeyProvider {
    client: Client,
    key_id: String,
}

impl KmsDataKeyProvider {
    pub(crate) fn new(client: Client, key_id: String) -> Self {
        Self { client, key_id }
    }
}

#[async_trait::async_trait]
impl DataKeyProvider for KmsDataKeyProvider {
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, DataKeyProviderError> {
        let output = self
            .client
            .generate_data_key()
            .key_id(&self.key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|_| DataKeyProviderError::GenerateFailed)?;

        let plaintext = output
            .plaintext()
            .map(|value| Zeroizing::new(value.as_ref().to_vec()))
            .ok_or(DataKeyProviderError::MalformedResponse)?;
        let encrypted = output
            .ciphertext_blob()
            .map(|value| value.as_ref().to_vec())
            .ok_or(DataKeyProviderError::MalformedResponse)?;
        let key_id = output
            .key_id()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or(DataKeyProviderError::MalformedResponse)?;

        Ok(GeneratedDataKey {
            plaintext,
            encrypted,
            key_id,
        })
    }

    async fn decrypt_data_key(
        &self,
        key_id: &str,
        encrypted_data_key: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, DataKeyProviderError> {
        let output = self
            .client
            .decrypt()
            .key_id(key_id)
            .ciphertext_blob(Blob::new(encrypted_data_key))
            .set_encryption_context(Some(encryption_context))
            .send()
            .await
            .map_err(|_| DataKeyProviderError::DecryptFailed)?;

        output
            .plaintext()
            .map(|value| Zeroizing::new(value.as_ref().to_vec()))
            .ok_or(DataKeyProviderError::MalformedResponse)
    }
}

struct EncryptionIdentity {
    fusionauth_user_id: String,
    email_address: String,
}

impl EncryptionIdentity {
    fn new(
        fusionauth_user_id: &str,
        email_address: &str,
    ) -> Result<Self, MicrosoftTokenCipherError> {
        let fusionauth_user_id = fusionauth_user_id.trim().to_ascii_lowercase();
        let email_address = email_validator::normalize_email(email_address)
            .map(|email| email.into_owned())
            .ok_or(MicrosoftTokenCipherError::MalformedIdentity)?;
        if fusionauth_user_id.is_empty() || fusionauth_user_id.contains('\0') {
            return Err(MicrosoftTokenCipherError::MalformedIdentity);
        }

        Ok(Self {
            fusionauth_user_id,
            email_address,
        })
    }

    fn aad(&self) -> Vec<u8> {
        let mut aad = ENCRYPTION_PURPOSE.as_bytes().to_vec();
        append_length_prefixed(&mut aad, &ENCRYPTION_VERSION.to_be_bytes());
        append_length_prefixed(&mut aad, self.fusionauth_user_id.as_bytes());
        append_length_prefixed(&mut aad, self.email_address.as_bytes());
        aad
    }

    fn kms_encryption_context(&self) -> HashMap<String, String> {
        HashMap::from([
            ("macro:purpose".to_owned(), ENCRYPTION_PURPOSE.to_owned()),
            (
                "macro:encryption-version".to_owned(),
                ENCRYPTION_VERSION.to_string(),
            ),
            (
                "macro:fusionauth-user-id".to_owned(),
                self.fusionauth_user_id.clone(),
            ),
            (
                "macro:microsoft-mailbox".to_owned(),
                self.email_address.clone(),
            ),
        ])
    }
}

fn append_length_prefixed(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u64).to_be_bytes());
    output.extend_from_slice(value);
}

fn validate_plaintext_data_key(data_key: &[u8]) -> Result<(), MicrosoftTokenCipherError> {
    if data_key.len() != AES_256_KEY_LENGTH {
        return Err(MicrosoftTokenCipherError::InvalidDataKey);
    }
    Ok(())
}

fn validate_envelope(envelope: &EncryptedMicrosoftToken) -> Result<(), MicrosoftTokenCipherError> {
    if envelope.encryption_version != ENCRYPTION_VERSION {
        return Err(MicrosoftTokenCipherError::UnsupportedVersion(
            envelope.encryption_version,
        ));
    }
    if envelope.nonce.len() != AES_GCM_NONCE_LENGTH
        || envelope.refresh_token_ciphertext.len() < AES_GCM_TAG_LENGTH
        || envelope.encrypted_data_key.is_empty()
        || envelope.kms_key_id.trim().is_empty()
    {
        return Err(MicrosoftTokenCipherError::MalformedEnvelope);
    }
    Ok(())
}

#[cfg(test)]
mod test;
