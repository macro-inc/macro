/// A validated 32-byte AES-256 encryption key.
#[derive(Clone)]
pub struct AesKey([u8; 32]);

impl AesKey {
    /// The raw key bytes.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl TryFrom<Vec<u8>> for AesKey {
    type Error = AesKeyError;

    #[tracing::instrument(skip_all, err)]
    fn try_from(bytes: Vec<u8>) -> Result<Self, Self::Error> {
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|v: Vec<u8>| AesKeyError::InvalidLength(v.len()))?;
        Ok(Self(bytes))
    }
}

impl TryFrom<&str> for AesKey {
    type Error = AesKeyError;

    /// Decode a base64-encoded key string into an [`AesKey`].
    #[tracing::instrument(skip_all, err)]
    fn try_from(b64: &str) -> Result<Self, Self::Error> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(AesKeyError::InvalidBase64)?;
        bytes.try_into()
    }
}

/// Errors when constructing an [`AesKey`].
#[derive(Debug, thiserror::Error)]
pub enum AesKeyError {
    /// Key must be exactly 32 bytes.
    #[error("AES-256 key must be exactly 32 bytes, got {0}")]
    InvalidLength(usize),
    /// Base64 decoding failed.
    #[error("invalid base64: {0}")]
    InvalidBase64(base64::DecodeError),
}
