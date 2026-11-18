//! ES256 signing of OpenBao login JWTs. The private key never leaves its signer:
//! deployed services sign through KMS, and only tests hold a key in memory.
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Serialize;

mod kms;
mod local;

pub use kms::{KmsJwtSigner, KmsKeyId, KmsKeyIdError};
pub use local::LocalJwtSigner;

/// A signing failure. Carries no key material or provider message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SignError {
    /// The signer could not be reached or refused the request.
    #[error("JWT signer unavailable")]
    Unavailable,
    /// The signer answered with something that is not a P-256 ECDSA signature.
    #[error("JWT signer returned an invalid signature")]
    InvalidSignature,
    /// The local key could not be parsed.
    #[error("invalid local JWT signing key")]
    InvalidKey,
}

/// Signs the JWS signing input of an ES256 JWT. `#[async_trait]` because the
/// provider holds it as `Arc<dyn JwtSigner>`.
#[async_trait]
pub trait JwtSigner: Send + Sync {
    /// Short fixed name recorded on spans (`kms`, `local`).
    fn kind(&self) -> &'static str;

    /// ES256 signature over `signing_input`, as the 64-byte `r || s` a JWS carries.
    async fn sign(&self, signing_input: &[u8]) -> Result<[u8; 64], SignError>;
}

/// Converts a DER `ECDSA-Sig-Value` (what KMS returns) into JWS `r || s`, each
/// left-padded to 32 bytes, with `s` normalized to the low half of the order.
pub(crate) fn der_to_raw(der: &[u8]) -> Result<[u8; 64], SignError> {
    let signature =
        p256::ecdsa::Signature::from_der(der).map_err(|_| SignError::InvalidSignature)?;
    let signature = signature.normalize_s().unwrap_or(signature);
    let mut raw = [0u8; 64];
    raw.copy_from_slice(&signature.to_bytes());
    Ok(raw)
}

/// Builds `header.claims.signature` with header `{"alg":"ES256","typ":"JWT"}`.
#[tracing::instrument(
    skip_all,
    err,
    name = "passwords.jwt.sign",
    fields(signer = signer.kind(), outcome = tracing::field::Empty)
)]
pub(crate) async fn es256_jwt<Claims: Serialize>(
    signer: &dyn JwtSigner,
    claims: &Claims,
) -> Result<String, SignError> {
    let span = tracing::Span::current();
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"ES256","typ":"JWT"}"#);
    let claims = serde_json::to_vec(claims).map_err(|_| SignError::Unavailable)?;
    let signing_input = format!("{header}.{}", URL_SAFE_NO_PAD.encode(claims));

    match signer.sign(signing_input.as_bytes()).await {
        Ok(signature) => {
            span.record("outcome", "signed");
            Ok(format!(
                "{signing_input}.{}",
                URL_SAFE_NO_PAD.encode(signature)
            ))
        }
        Err(error) => {
            span.record("outcome", "failed");
            Err(error)
        }
    }
}

#[cfg(test)]
mod test;
