//
// Copyright 2020 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/ratchet.rs,
// ratchet/keys.rs and ratchet/params.rs, modified by Macro: X3DH only (no
// Kyber, no post-quantum ratchet), and message keys are always derived and
// stored in full, never as seeds. See NOTICE.

use libsignal_core::curve::{KeyPair, PrivateKey, PublicKey};
use rand::{CryptoRng, Rng};

use super::crypto;
use super::error::Result;
use super::messages::CIPHERTEXT_MESSAGE_CURRENT_VERSION;
use super::session_state::SessionState;

/// The local and remote keys Alice (the side that processed a pre-key bundle)
/// starts a session from.
pub(crate) struct AliceSignalProtocolParameters {
    pub(crate) our_identity_key_pair: KeyPair,
    pub(crate) our_base_key_pair: KeyPair,
    pub(crate) their_identity_key: PublicKey,
    pub(crate) their_signed_pre_key: PublicKey,
    pub(crate) their_one_time_pre_key: Option<PublicKey>,
    pub(crate) their_ratchet_key: PublicKey,
}

/// The local and remote keys Bob (the side that received a pre-key message)
/// starts a session from.
pub(crate) struct BobSignalProtocolParameters {
    pub(crate) our_identity_key_pair: KeyPair,
    pub(crate) our_signed_pre_key_pair: KeyPair,
    pub(crate) our_one_time_pre_key_pair: Option<KeyPair>,
    pub(crate) our_ratchet_key_pair: KeyPair,
    pub(crate) their_identity_key: PublicKey,
    pub(crate) their_base_key: PublicKey,
}

fn derive_keys(secret_input: &[u8]) -> (RootKey, ChainKey) {
    let mut secrets = [0; 64];
    hkdf::Hkdf::<sha2::Sha256>::new(None, secret_input)
        .expand(b"WhisperText", &mut secrets)
        .expect("valid length");
    let (root_key_bytes, chain_key_bytes) = secrets.split_at(32);

    let root_key = RootKey::new(root_key_bytes.try_into().expect("correct length"));
    let chain_key = ChainKey::new(chain_key_bytes.try_into().expect("correct length"), 0);
    (root_key, chain_key)
}

pub(crate) fn initialize_alice_session<R: Rng + CryptoRng>(
    parameters: &AliceSignalProtocolParameters,
    csprng: &mut R,
) -> Result<SessionState> {
    let local_identity = parameters.our_identity_key_pair.public_key;

    let sending_ratchet_key = KeyPair::generate(csprng);

    let mut secrets = Vec::with_capacity(32 * 5);

    secrets.extend_from_slice(&[0xFFu8; 32]); // "discontinuity bytes"

    let our_base_private_key = parameters.our_base_key_pair.private_key;

    secrets.extend_from_slice(
        &parameters
            .our_identity_key_pair
            .private_key
            .calculate_agreement(&parameters.their_signed_pre_key)?,
    );

    secrets.extend_from_slice(
        &our_base_private_key.calculate_agreement(&parameters.their_identity_key)?,
    );

    secrets.extend_from_slice(
        &our_base_private_key.calculate_agreement(&parameters.their_signed_pre_key)?,
    );

    if let Some(their_one_time_prekey) = &parameters.their_one_time_pre_key {
        secrets
            .extend_from_slice(&our_base_private_key.calculate_agreement(their_one_time_prekey)?);
    }

    let (root_key, chain_key) = derive_keys(&secrets);

    let (sending_chain_root_key, sending_chain_chain_key) = root_key.create_chain(
        &parameters.their_ratchet_key,
        &sending_ratchet_key.private_key,
    )?;

    let session = SessionState::new(
        CIPHERTEXT_MESSAGE_CURRENT_VERSION,
        &local_identity,
        &parameters.their_identity_key,
        &sending_chain_root_key,
        &parameters.our_base_key_pair.public_key,
    )
    .with_receiver_chain(&parameters.their_ratchet_key, &chain_key)
    .with_sender_chain(&sending_ratchet_key, &sending_chain_chain_key);

    Ok(session)
}

pub(crate) fn initialize_bob_session(
    parameters: &BobSignalProtocolParameters,
) -> Result<SessionState> {
    let local_identity = parameters.our_identity_key_pair.public_key;

    let mut secrets = Vec::with_capacity(32 * 5);

    secrets.extend_from_slice(&[0xFFu8; 32]); // "discontinuity bytes"

    secrets.extend_from_slice(
        &parameters
            .our_signed_pre_key_pair
            .private_key
            .calculate_agreement(&parameters.their_identity_key)?,
    );

    secrets.extend_from_slice(
        &parameters
            .our_identity_key_pair
            .private_key
            .calculate_agreement(&parameters.their_base_key)?,
    );

    secrets.extend_from_slice(
        &parameters
            .our_signed_pre_key_pair
            .private_key
            .calculate_agreement(&parameters.their_base_key)?,
    );

    if let Some(our_one_time_pre_key_pair) = &parameters.our_one_time_pre_key_pair {
        secrets.extend_from_slice(
            &our_one_time_pre_key_pair
                .private_key
                .calculate_agreement(&parameters.their_base_key)?,
        );
    }

    let (root_key, chain_key) = derive_keys(&secrets);

    let session = SessionState::new(
        CIPHERTEXT_MESSAGE_CURRENT_VERSION,
        &local_identity,
        &parameters.their_identity_key,
        &root_key,
        &parameters.their_base_key,
    )
    .with_sender_chain(&parameters.our_ratchet_key_pair, &chain_key);

    Ok(session)
}

#[derive(Clone, Copy)]
pub(crate) struct MessageKeys {
    cipher_key: [u8; 32],
    mac_key: [u8; 32],
    iv: [u8; 16],
    counter: u32,
}

impl MessageKeys {
    pub(crate) fn derive_keys(input_key_material: &[u8], counter: u32) -> Self {
        let mut okm = [0; 80];
        hkdf::Hkdf::<sha2::Sha256>::new(None, input_key_material)
            .expand(b"WhisperMessageKeys", &mut okm)
            .expect("valid output length");

        MessageKeys {
            cipher_key: okm[0..32].try_into().expect("correct length"),
            mac_key: okm[32..64].try_into().expect("correct length"),
            iv: okm[64..80].try_into().expect("correct length"),
            counter,
        }
    }

    pub(crate) fn new(cipher_key: [u8; 32], mac_key: [u8; 32], iv: [u8; 16], counter: u32) -> Self {
        Self {
            cipher_key,
            mac_key,
            iv,
            counter,
        }
    }

    pub(crate) fn cipher_key(&self) -> &[u8; 32] {
        &self.cipher_key
    }

    pub(crate) fn mac_key(&self) -> &[u8; 32] {
        &self.mac_key
    }

    pub(crate) fn iv(&self) -> &[u8; 16] {
        &self.iv
    }

    pub(crate) fn counter(&self) -> u32 {
        self.counter
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ChainKey {
    key: [u8; 32],
    index: u32,
}

impl ChainKey {
    const MESSAGE_KEY_SEED: [u8; 1] = [0x01u8];
    const CHAIN_KEY_SEED: [u8; 1] = [0x02u8];

    pub(crate) fn new(key: [u8; 32], index: u32) -> Self {
        Self { key, index }
    }

    pub(crate) fn key(&self) -> &[u8; 32] {
        &self.key
    }

    pub(crate) fn index(&self) -> u32 {
        self.index
    }

    pub(crate) fn next_chain_key(&self) -> Self {
        Self {
            key: self.calculate_base_material(Self::CHAIN_KEY_SEED),
            index: self.index + 1,
        }
    }

    pub(crate) fn message_keys(&self) -> MessageKeys {
        MessageKeys::derive_keys(
            &self.calculate_base_material(Self::MESSAGE_KEY_SEED),
            self.index,
        )
    }

    fn calculate_base_material(&self, seed: [u8; 1]) -> [u8; 32] {
        crypto::hmac_sha256(&self.key, &seed)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RootKey {
    key: [u8; 32],
}

impl RootKey {
    pub(crate) fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    pub(crate) fn key(&self) -> &[u8; 32] {
        &self.key
    }

    pub(crate) fn create_chain(
        self,
        their_ratchet_key: &PublicKey,
        our_ratchet_key: &PrivateKey,
    ) -> Result<(RootKey, ChainKey)> {
        let shared_secret = our_ratchet_key.calculate_agreement(their_ratchet_key)?;
        let mut derived_secret_bytes = [0; 64];
        hkdf::Hkdf::<sha2::Sha256>::new(Some(&self.key), &shared_secret)
            .expand(b"WhisperRatchet", &mut derived_secret_bytes)
            .expect("valid output length");

        Ok((
            RootKey {
                key: derived_secret_bytes[0..32]
                    .try_into()
                    .expect("correct length"),
            },
            ChainKey {
                key: derived_secret_bytes[32..64]
                    .try_into()
                    .expect("correct length"),
                index: 0,
            },
        ))
    }
}
