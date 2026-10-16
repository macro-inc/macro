//! Secret-bearing types and the envelope-encryption port.

use zeroize::Zeroizing;

/// An encrypted Microsoft refresh-token envelope suitable for persistence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedMicrosoftToken {
    pub refresh_token_ciphertext: Vec<u8>,
    pub encrypted_data_key: Vec<u8>,
    pub nonce: Vec<u8>,
    pub encryption_version: i16,
    pub kms_key_id: String,
}

/// A Microsoft refresh token that clears its allocation when dropped.
pub struct MicrosoftRefreshToken(Zeroizing<String>);

impl MicrosoftRefreshToken {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Encrypts and decrypts Microsoft refresh-token envelopes.
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait MicrosoftTokenCipher: Send + Sync {
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

#[derive(Debug, thiserror::Error)]
pub enum MicrosoftTokenCipherError {
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
pub enum DataKeyProviderError {
    #[error("KMS GenerateDataKey failed")]
    GenerateFailed,
    #[error("KMS Decrypt failed")]
    DecryptFailed,
    #[error("KMS returned a malformed data key")]
    MalformedResponse,
}
