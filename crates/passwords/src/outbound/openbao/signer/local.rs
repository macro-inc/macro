use super::{JwtSigner, SignError};
use async_trait::async_trait;
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::DecodePrivateKey,
};

/// An in-memory P-256 key, for tests and disposable local fixtures only.
/// Deployed services sign with [`super::KmsJwtSigner`].
pub struct LocalJwtSigner {
    key: SigningKey,
}

impl LocalJwtSigner {
    /// Parses a PKCS#8 PEM P-256 private key (`openssl genpkey -algorithm EC
    /// -pkeyopt ec_paramgen_curve:P-256`).
    pub fn from_pkcs8_pem(pem: &str) -> Result<Self, SignError> {
        SigningKey::from_pkcs8_pem(pem)
            .map(Self::new)
            .map_err(|_| SignError::InvalidKey)
    }

    /// Wraps an existing key.
    pub fn new(key: SigningKey) -> Self {
        Self { key }
    }
}

#[async_trait]
impl JwtSigner for LocalJwtSigner {
    fn kind(&self) -> &'static str {
        "local"
    }

    async fn sign(&self, signing_input: &[u8]) -> Result<[u8; 64], SignError> {
        // RFC 6979 deterministic ECDSA over SHA-256 of the input.
        let signature: Signature = self.key.sign(signing_input);
        let mut raw = [0u8; 64];
        raw.copy_from_slice(&signature.to_bytes());
        Ok(raw)
    }
}
