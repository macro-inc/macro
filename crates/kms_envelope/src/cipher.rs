//! Sealing values under a scope's data key.
//!
//! AES-256-GCM with a random 96-bit nonce per write, so the same data key can
//! seal any number of values: at 2^32 writes per scope the collision
//! probability of random nonces is still below 2^-32. Each value is bound by
//! its associated data to the scope and the caller's labels (which store,
//! which key, which purpose), so a ciphertext copied to another row, label or
//! scope fails to decrypt instead of being read as that row's value.

#[cfg(test)]
mod test;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use uuid::Uuid;
use zeroize::Zeroizing;

/// Length of the random nonce in front of every sealed value.
pub const NONCE_LENGTH: usize = 12;
const DATA_KEY_LENGTH: usize = 32;
/// First byte of a [`ValueCipher::seal_blob`] output.
const BLOB_FORMAT: u8 = 0x01;

/// Sealing or opening failed. Carries nothing about the value.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CipherError {
    /// The key material is not 32 bytes.
    #[error("data key is malformed")]
    Malformed,
    /// Encryption failed.
    #[error("value could not be encrypted")]
    Encrypt,
    /// The value was sealed for another scope or labels, tampered with, or is
    /// not in a known format.
    #[error("value could not be decrypted")]
    Decrypt,
}

/// A scope's data key in plaintext.
///
/// Lives only in memory, from the KMS `Decrypt` (or `GenerateDataKey`) until
/// dropped. Zeroizes on drop, redacts its `Debug`, and has no serialization.
pub struct DataKey(Zeroizing<[u8; DATA_KEY_LENGTH]>);

impl DataKey {
    /// Accepts exactly 32 bytes of key material.
    pub fn from_plaintext(plaintext: &[u8]) -> Result<Self, CipherError> {
        let key: [u8; DATA_KEY_LENGTH] =
            plaintext.try_into().map_err(|_| CipherError::Malformed)?;
        Ok(Self(Zeroizing::new(key)))
    }
}

impl std::fmt::Debug for DataKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DataKey(redacted)")
    }
}

/// A sealed value, ready for separate `nonce` and `value` columns.
pub struct Sealed {
    /// The random nonce.
    pub nonce: Vec<u8>,
    /// The ciphertext and tag.
    pub value: Vec<u8>,
}

/// Seals and opens the values of one scope.
pub struct ValueCipher {
    scope: Uuid,
    // `aes-gcm` is built with `zeroize`, so the key schedule is wiped on drop.
    aead: Aes256Gcm,
}

impl ValueCipher {
    /// A cipher for the values of `scope` (an account, an attempt).
    pub fn new(scope: Uuid, data_key: &DataKey) -> Self {
        Self {
            scope,
            aead: Aes256Gcm::new(data_key.0.as_ref().into()),
        }
    }

    /// Encrypts a value labelled by `labels` (e.g. its store and key, one
    /// part per component). The same labels open it.
    pub fn seal(&self, labels: &[&[u8]], plaintext: &[u8]) -> Result<Sealed, CipherError> {
        let nonce: [u8; NONCE_LENGTH] = rand::random();
        let value = self
            .aead
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: plaintext,
                    aad: &self.associated_data(labels),
                },
            )
            .map_err(|_| CipherError::Encrypt)?;
        Ok(Sealed {
            nonce: nonce.to_vec(),
            value,
        })
    }

    /// Decrypts a value sealed under the same scope and `labels`.
    pub fn open(
        &self,
        labels: &[&[u8]],
        nonce: &[u8],
        value: &[u8],
    ) -> Result<Vec<u8>, CipherError> {
        let nonce: [u8; NONCE_LENGTH] = nonce.try_into().map_err(|_| CipherError::Decrypt)?;
        self.aead
            .decrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: value,
                    aad: &self.associated_data(labels),
                },
            )
            .map_err(|_| CipherError::Decrypt)
    }

    /// [`ValueCipher::seal`] into one column: `0x01 | nonce | ciphertext`.
    pub fn seal_blob(&self, labels: &[&[u8]], plaintext: &[u8]) -> Result<Vec<u8>, CipherError> {
        let sealed = self.seal(labels, plaintext)?;
        Ok([&[BLOB_FORMAT], sealed.nonce.as_slice(), &sealed.value].concat())
    }

    /// Opens a [`ValueCipher::seal_blob`] output.
    pub fn open_blob(
        &self,
        labels: &[&[u8]],
        blob: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, CipherError> {
        let Some((&BLOB_FORMAT, rest)) = blob.split_first() else {
            return Err(CipherError::Decrypt);
        };
        let (nonce, value) = rest
            .split_at_checked(NONCE_LENGTH)
            .ok_or(CipherError::Decrypt)?;
        Ok(Zeroizing::new(self.open(labels, nonce, value)?))
    }

    /// `scope | labels…`: the scope's 16 bytes, then each label prefixed by
    /// its length as a big-endian u32, so no two different label lists
    /// encode to the same bytes.
    fn associated_data(&self, labels: &[&[u8]]) -> Vec<u8> {
        let mut associated_data =
            Vec::with_capacity(16 + labels.iter().map(|label| 4 + label.len()).sum::<usize>());
        associated_data.extend_from_slice(self.scope.as_bytes());
        for label in labels {
            // Labels are keys and names, far below 4 GiB.
            let length = u32::try_from(label.len()).unwrap_or(u32::MAX);
            associated_data.extend_from_slice(&length.to_be_bytes());
            associated_data.extend_from_slice(label);
        }
        associated_data
    }
}
