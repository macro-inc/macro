// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/gcmutil/gcm.go (MPL-2.0, Copyright (c) Tulir Asokan)

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};

/// The nonce length Go's `cipher.NewGCM` uses.
pub const NONCE_SIZE: usize = 12;

/// An AES-GCM failure.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum GcmError {
    /// The key isn't 32 bytes. Go also accepts AES-128 and AES-192 keys, but
    /// whatsmeow only ever passes 32-byte keys.
    #[error("failed to initialize AES cipher: invalid key size {0}")]
    InvalidKeySize(usize),
    /// The nonce isn't [`NONCE_SIZE`] bytes (Go panics).
    #[error("invalid GCM nonce size {0}")]
    InvalidNonceSize(usize),
    /// Authentication failed while decrypting.
    #[error("cipher: message authentication failed")]
    Authentication,
}

/// Creates an AES-256-GCM cipher from a key.
pub fn prepare(secret_key: &[u8]) -> Result<Aes256Gcm, GcmError> {
    Aes256Gcm::new_from_slice(secret_key).map_err(|_| GcmError::InvalidKeySize(secret_key.len()))
}

/// Decrypts and authenticates `ciphertext` (with the tag appended).
pub fn decrypt(
    secret_key: &[u8],
    iv: &[u8],
    ciphertext: &[u8],
    additional_data: &[u8],
) -> Result<Vec<u8>, GcmError> {
    open(&prepare(secret_key)?, iv, ciphertext, additional_data)
}

/// Encrypts `plaintext`, appending the authentication tag.
pub fn encrypt(
    secret_key: &[u8],
    iv: &[u8],
    plaintext: &[u8],
    additional_data: &[u8],
) -> Result<Vec<u8>, GcmError> {
    seal(&prepare(secret_key)?, iv, plaintext, additional_data)
}

/// Go's `AEAD.Seal` on a prepared cipher.
pub fn seal(
    cipher: &Aes256Gcm,
    iv: &[u8],
    plaintext: &[u8],
    additional_data: &[u8],
) -> Result<Vec<u8>, GcmError> {
    let nonce = nonce(iv)?;
    let payload = Payload {
        msg: plaintext,
        aad: additional_data,
    };
    // Encryption only fails for plaintexts beyond GCM's 64 GiB limit.
    cipher
        .encrypt(nonce, payload)
        .map_err(|_| GcmError::Authentication)
}

/// Go's `AEAD.Open` on a prepared cipher.
pub fn open(
    cipher: &Aes256Gcm,
    iv: &[u8],
    ciphertext: &[u8],
    additional_data: &[u8],
) -> Result<Vec<u8>, GcmError> {
    let nonce = nonce(iv)?;
    let payload = Payload {
        msg: ciphertext,
        aad: additional_data,
    };
    cipher
        .decrypt(nonce, payload)
        .map_err(|_| GcmError::Authentication)
}

fn nonce(iv: &[u8]) -> Result<&Nonce<<Aes256Gcm as aes_gcm::AeadCore>::NonceSize>, GcmError> {
    if iv.len() != NONCE_SIZE {
        return Err(GcmError::InvalidNonceSize(iv.len()));
    }
    Ok(iv.into())
}

#[cfg(test)]
mod test;
