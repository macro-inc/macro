//! AES-256-GCM implementation of [`SecretEncryptor`].
//!
//! Mirrors the field-encryption approach used by `mcp_client`: a random 12-byte
//! nonce is generated per encryption and prepended to the ciphertext, so a
//! single column stores `nonce || ciphertext`. In production the 32-byte key
//! should come from a KMS-backed secret; in V1 it is injected at startup.

use aes_gcm::Aes256Gcm;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use rand::Rng;
use rand::distr::Alphanumeric;

use crate::domain::ports::{EncryptionError, SecretEncryptor};

/// Length of the AES-GCM nonce prepended to each ciphertext.
const NONCE_LEN: usize = 12;
/// Number of random characters in a generated signing secret (excluding prefix).
const SECRET_RANDOM_LEN: usize = 40;
/// User-facing prefix on signing secrets, à la common webhook providers.
const SECRET_PREFIX: &str = "whsec_";

/// Encrypts webhook secrets/headers with a single AES-256-GCM key.
#[derive(Clone)]
pub struct AesSecretEncryptor {
    key: [u8; 32],
}

impl AesSecretEncryptor {
    /// Construct from a 32-byte key.
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// Construct from arbitrary key bytes, erroring if the length is not 32.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, EncryptionError> {
        let key: [u8; 32] = bytes.try_into().map_err(|_| EncryptionError::Encrypt)?;
        Ok(Self { key })
    }
}

impl SecretEncryptor for AesSecretEncryptor {
    fn generate_secret(&self) -> String {
        let random: String = rand::rng()
            .sample_iter(Alphanumeric)
            .take(SECRET_RANDOM_LEN)
            .map(char::from)
            .collect();
        format!("{SECRET_PREFIX}{random}")
    }

    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        let cipher = Aes256Gcm::new((&self.key).into());
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|_| EncryptionError::Encrypt)?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        if data.len() <= NONCE_LEN {
            return Err(EncryptionError::Decrypt);
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new((&self.key).into());
        cipher
            .decrypt(nonce_bytes.into(), ciphertext)
            .map_err(|_| EncryptionError::Decrypt)
    }
}

#[cfg(test)]
mod test;
