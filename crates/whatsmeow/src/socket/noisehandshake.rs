// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/noisehandshake.go (MPL-2.0, Copyright (c) Tulir Asokan)

use aes_gcm::Aes256Gcm;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use super::framesocket::{FrameEvent, FrameSocket};
use super::noisesocket::{NoiseEvent, NoiseSocket, generate_iv, new_noise_socket};
use crate::util::gcmutil::{self, GcmError};

/// Errors while mixing keys during the handshake.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum NoiseHandshakeError {
    /// The peer's public key is a low-order point, so the shared secret is 0.
    #[error("failed to do x25519 scalar multiplication: low order point")]
    LowOrderPoint,
    /// Creating a cipher or encrypting failed.
    #[error(transparent)]
    Cipher(#[from] GcmError),
}

/// The handshake state of the `Noise_XX_25519_AESGCM_SHA256` protocol.
pub struct NoiseHandshake {
    hash: [u8; 32],
    salt: [u8; 32],
    key: Aes256Gcm,
    counter: u32,
}

fn sha256_slice(data: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in data {
        hasher.update(part);
    }
    hasher.finalize().into()
}

impl NoiseHandshake {
    /// Starts a handshake: Go's `NewNoiseHandshake` followed by `Start`.
    ///
    /// A 32-byte pattern is the initial hash itself; anything else is hashed.
    /// The connection header is then mixed into the hash.
    pub fn start(pattern: &[u8], header: &[u8]) -> Result<Self, NoiseHandshakeError> {
        let hash = match <[u8; 32]>::try_from(pattern) {
            Ok(hash) => hash,
            Err(_) => sha256_slice(&[pattern]),
        };
        let mut handshake = Self {
            hash,
            salt: hash,
            key: gcmutil::prepare(&hash)?,
            counter: 0,
        };
        handshake.authenticate(header);
        Ok(handshake)
    }

    /// Mixes data into the handshake hash.
    pub fn authenticate(&mut self, data: &[u8]) {
        self.hash = sha256_slice(&[&self.hash, data]);
    }

    fn post_increment_counter(&mut self) -> u32 {
        let count = self.counter;
        self.counter = self.counter.wrapping_add(1);
        count
    }

    /// Encrypts a handshake payload with the hash as associated data, and
    /// mixes the ciphertext into the hash.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, NoiseHandshakeError> {
        let iv = generate_iv(self.post_increment_counter());
        let ciphertext = gcmutil::seal(&self.key, &iv, plaintext, &self.hash)?;
        self.authenticate(&ciphertext);
        Ok(ciphertext)
    }

    /// Decrypts a handshake payload, mixing the ciphertext into the hash when
    /// it authenticates.
    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, GcmError> {
        let iv = generate_iv(self.post_increment_counter());
        let plaintext = gcmutil::open(&self.key, &iv, ciphertext, &self.hash)?;
        self.authenticate(ciphertext);
        Ok(plaintext)
    }

    /// Derives the transport keys and starts the encrypted socket over the
    /// frame socket's events. The returned receiver yields decrypted frames
    /// and the disconnect, which Go delivers to a frame handler and a
    /// disconnect handler.
    pub fn finish(
        self,
        frame_socket: FrameSocket,
        frames: mpsc::Receiver<FrameEvent>,
    ) -> Result<(NoiseSocket, mpsc::Receiver<NoiseEvent>), NoiseHandshakeError> {
        let (write, read) = extract_and_expand(&self.salt, &[]);
        let write_key = gcmutil::prepare(&write)?;
        let read_key = gcmutil::prepare(&read)?;
        Ok(new_noise_socket(frame_socket, frames, write_key, read_key))
    }

    /// Mixes the X25519 shared secret of a private and a public key into the
    /// cipher key.
    pub fn mix_shared_secret_into_key(
        &mut self,
        private: [u8; 32],
        public: [u8; 32],
    ) -> Result<(), NoiseHandshakeError> {
        let secret = x25519_dalek::x25519(private, public);
        // Go's curve25519.X25519 rejects low-order points this way.
        if secret == [0; 32] {
            return Err(NoiseHandshakeError::LowOrderPoint);
        }
        self.mix_into_key(&secret)
    }

    /// Derives a new salt and cipher key from the current salt and `data`,
    /// resetting the nonce counter.
    pub fn mix_into_key(&mut self, data: &[u8]) -> Result<(), NoiseHandshakeError> {
        self.counter = 0;
        let (write, read) = extract_and_expand(&self.salt, data);
        self.salt = write;
        self.key = gcmutil::prepare(&read)?;
        Ok(())
    }
}

impl NoiseHandshake {
    /// The (initiator write, initiator read) transport keys, for tests that
    /// play the responder.
    #[cfg(any(test, feature = "testing"))]
    pub fn transport_keys(&self) -> ([u8; 32], [u8; 32]) {
        extract_and_expand(&self.salt, &[])
    }
}

/// HKDF-SHA256 of `data` with `salt`, split into two 32-byte keys.
fn extract_and_expand(salt: &[u8], data: &[u8]) -> ([u8; 32], [u8; 32]) {
    let mut output = [0; 64];
    Hkdf::<Sha256>::new(Some(salt), data)
        .expand(&[], &mut output)
        .expect("HKDF-SHA256 can expand 64 bytes");
    let mut write = [0; 32];
    let mut read = [0; 32];
    write.copy_from_slice(&output[..32]);
    read.copy_from_slice(&output[32..]);
    (write, read)
}

#[cfg(test)]
mod test;
