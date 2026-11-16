//! The key that signs ID tokens, and its public half as Microsoft's keys
//! endpoint serves it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use rsa::RsaPrivateKey;
use rsa::pkcs1::EncodeRsaPrivateKey;
use rsa::traits::PublicKeyParts;
use serde::Serialize;
use serde_json::{Value, json};

const KEY_ID: &str = "outlook-emulator-signing-key-1";
const KEY_BITS: usize = 2048;

pub(crate) struct SigningKey {
    encoding: EncodingKey,
    modulus: String,
    exponent: String,
}

/// Why the signing key could not be made.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SigningKeyError {
    #[error("could not generate the ID token signing key: {0}")]
    Generate(#[from] rsa::Error),
    #[error("could not encode the ID token signing key: {0}")]
    Encode(#[from] rsa::pkcs1::Error),
    #[error("ID token signing key generation did not finish: {0}")]
    Cancelled(#[from] tokio::task::JoinError),
}

impl SigningKey {
    /// Generates a key. Every emulator has its own, so no private key is
    /// kept in the repository and none signs anything a real service trusts.
    pub(crate) fn generate() -> Result<Self, SigningKeyError> {
        let key = RsaPrivateKey::new(&mut rsa::rand_core::OsRng, KEY_BITS)?;
        let der = key.to_pkcs1_der()?;

        Ok(Self {
            encoding: EncodingKey::from_rsa_der(der.as_bytes()),
            modulus: URL_SAFE_NO_PAD.encode(key.n().to_bytes_be()),
            exponent: URL_SAFE_NO_PAD.encode(key.e().to_bytes_be()),
        })
    }

    /// The key set, as `/{tenant}/discovery/v2.0/keys` answers it. Each of
    /// Microsoft's keys names the issuer whose tokens it signs.
    pub(crate) fn key_set(&self, issuer: &str) -> Value {
        json!({
            "keys": [{
                "kty": "RSA",
                "use": "sig",
                "kid": KEY_ID,
                "n": self.modulus,
                "e": self.exponent,
                "issuer": issuer,
            }]
        })
    }

    /// Signs a token the key set's key verifies.
    pub(crate) fn sign(
        &self,
        claims: &impl Serialize,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(KEY_ID.to_string());
        jsonwebtoken::encode(&header, claims, &self.encoding)
    }
}
