// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/keys/keypair.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::fmt;

use crate::signal::{CurveSignatures, DJB_TYPE};

/// A Curve25519 keypair.
#[derive(Clone, PartialEq, Eq)]
pub struct KeyPair {
    /// The public key.
    pub public: [u8; 32],
    /// The (clamped) private key.
    pub private: [u8; 32],
}

/// Never prints the private key.
impl fmt::Debug for KeyPair {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeyPair")
            .field("public", &hex::encode(self.public))
            .finish_non_exhaustive()
    }
}

/// Derives the keypair of a private key.
pub fn new_key_pair_from_private_key(private: [u8; 32]) -> KeyPair {
    KeyPair {
        public: x25519_dalek::x25519(private, x25519_dalek::X25519_BASEPOINT_BYTES),
        private,
    }
}

/// Generates a new random keypair.
pub fn new_key_pair() -> KeyPair {
    let mut private: [u8; 32] = rand::random();
    private[0] &= 248;
    private[31] &= 127;
    private[31] |= 64;
    new_key_pair_from_private_key(private)
}

impl KeyPair {
    /// Generates a new prekey and signs it with this (identity) keypair.
    pub fn create_signed_pre_key(&self, signatures: &impl CurveSignatures, key_id: u32) -> PreKey {
        let mut new_key = new_pre_key(key_id);
        new_key.signature = Some(self.sign(signatures, &new_key.key_pair));
        new_key
    }

    /// Signs the public key of `key_to_sign`, prefixed with the key type byte
    /// as libsignal serializes public keys.
    pub fn sign(&self, signatures: &impl CurveSignatures, key_to_sign: &KeyPair) -> [u8; 64] {
        let mut public_key_for_signature = [0; 33];
        public_key_for_signature[0] = DJB_TYPE;
        public_key_for_signature[1..].copy_from_slice(&key_to_sign.public);
        signatures.calculate_signature(&self.private, &public_key_for_signature)
    }
}

/// A one-time or signed prekey.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreKey {
    /// The keypair.
    pub key_pair: KeyPair,
    /// The prekey ID.
    pub key_id: u32,
    /// The signature by the identity key; only signed prekeys have one.
    pub signature: Option<[u8; 64]>,
}

/// Generates a new unsigned prekey.
pub fn new_pre_key(key_id: u32) -> PreKey {
    PreKey {
        key_pair: new_key_pair(),
        key_id,
        signature: None,
    }
}

#[cfg(test)]
mod test;
