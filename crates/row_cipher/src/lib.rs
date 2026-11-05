#![deny(missing_docs)]
//! AES-256-GCM for a secret Macro generated and stores in one row, such as a
//! webhook signing secret, bound to that row's id.
//!
//! The row id is the additional authenticated data, so a ciphertext copied
//! into another row does not decrypt. This is for service-generated secrets
//! under a process key. User and third-party credentials (OAuth tokens, API
//! keys) are KMS ciphertext instead (CS-72).

use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, AeadCore, OsRng, Payload},
};
use uuid::Uuid;

#[cfg(test)]
mod test;

const NONCE_LEN: usize = 12;

/// Seals and opens secrets bound to the id of the row that stores them.
pub struct RowCipher(Aes256Gcm);

/// A secret could not be sealed or opened, including because it was stored
/// in a different row or under a different key.
#[derive(Debug, thiserror::Error)]
#[error("could not seal or open a stored secret")]
pub struct RowCipherError;

impl RowCipher {
    /// A cipher under a 256-bit process key.
    pub fn new(key: &[u8; 32]) -> Self {
        Self(Aes256Gcm::new(key.into()))
    }

    /// Encrypt `plaintext` for row `row`: the nonce followed by the ciphertext.
    pub fn seal(&self, row: Uuid, plaintext: &[u8]) -> Result<Vec<u8>, RowCipherError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .0
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: row.as_bytes(),
                },
            )
            .map_err(|_| RowCipherError)?;
        Ok([&nonce[..], &ciphertext].concat())
    }

    /// Decrypt what [`Self::seal`] produced for the same row.
    pub fn open(&self, row: Uuid, sealed: &[u8]) -> Result<Vec<u8>, RowCipherError> {
        if sealed.len() < NONCE_LEN {
            return Err(RowCipherError);
        }
        let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
        self.0
            .decrypt(
                nonce.into(),
                Payload {
                    msg: ciphertext,
                    aad: row.as_bytes(),
                },
            )
            .map_err(|_| RowCipherError)
    }
}
