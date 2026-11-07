//
// Copyright 2020-2021 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/sender_keys.rs and
// modified by Macro: the state has no message version (WhatsApp sender keys
// are always version 3) and is looked up by WhatsApp's key ID. See NOTICE.

use std::collections::VecDeque;

use libsignal_core::curve::{PrivateKey, PublicKey};
use prost::Message;

use super::consts;
use super::crypto::hmac_sha256;
use super::error::SignalProtocolError;
use super::proto::storage as storage_proto;

/// A distinct error type to keep from accidentally propagating deserialization errors.
#[derive(Debug)]
pub(crate) struct InvalidSessionError(&'static str);

impl std::fmt::Display for InvalidSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderMessageKey {
    iteration: u32,
    iv: Vec<u8>,
    cipher_key: Vec<u8>,
    seed: Vec<u8>,
}

impl SenderMessageKey {
    pub(crate) fn new(iteration: u32, seed: Vec<u8>) -> Self {
        let mut derived = [0; 48];
        hkdf::Hkdf::<sha2::Sha256>::new(None, &seed)
            .expand(b"WhisperGroup", &mut derived)
            .expect("valid output length");
        Self {
            iteration,
            seed,
            iv: derived[0..16].to_vec(),
            cipher_key: derived[16..48].to_vec(),
        }
    }

    fn from_protobuf(smk: storage_proto::sender_key_state_structure::SenderMessageKey) -> Self {
        Self::new(smk.iteration, smk.seed)
    }

    pub(crate) fn iteration(&self) -> u32 {
        self.iteration
    }

    pub(crate) fn iv(&self) -> &[u8] {
        &self.iv
    }

    pub(crate) fn cipher_key(&self) -> &[u8] {
        &self.cipher_key
    }

    fn as_protobuf(&self) -> storage_proto::sender_key_state_structure::SenderMessageKey {
        storage_proto::sender_key_state_structure::SenderMessageKey {
            iteration: self.iteration,
            seed: self.seed.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderChainKey {
    iteration: u32,
    chain_key: Vec<u8>,
}

impl SenderChainKey {
    const MESSAGE_KEY_SEED: u8 = 0x01;
    const CHAIN_KEY_SEED: u8 = 0x02;

    pub(crate) fn new(iteration: u32, chain_key: Vec<u8>) -> Self {
        Self {
            iteration,
            chain_key,
        }
    }

    pub(crate) fn iteration(&self) -> u32 {
        self.iteration
    }

    pub(crate) fn seed(&self) -> &[u8] {
        &self.chain_key
    }

    pub(crate) fn next(&self) -> Result<SenderChainKey, SignalProtocolError> {
        let new_iteration = self.iteration.checked_add(1).ok_or_else(|| {
            SignalProtocolError::InvalidState(
                "sender_chain_key_next",
                "Sender chain is too long".into(),
            )
        })?;

        Ok(SenderChainKey::new(
            new_iteration,
            self.get_derivative(Self::CHAIN_KEY_SEED),
        ))
    }

    pub(crate) fn sender_message_key(&self) -> SenderMessageKey {
        SenderMessageKey::new(self.iteration, self.get_derivative(Self::MESSAGE_KEY_SEED))
    }

    fn get_derivative(&self, label: u8) -> Vec<u8> {
        let label = [label];
        hmac_sha256(&self.chain_key, &label).to_vec()
    }

    fn as_protobuf(&self) -> storage_proto::sender_key_state_structure::SenderChainKey {
        storage_proto::sender_key_state_structure::SenderChainKey {
            iteration: self.iteration,
            seed: self.chain_key.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderKeyState {
    state: storage_proto::SenderKeyStateStructure,
}

impl SenderKeyState {
    fn new(
        key_id: u32,
        iteration: u32,
        chain_key: &[u8],
        signature_key: PublicKey,
        signature_private_key: Option<PrivateKey>,
    ) -> SenderKeyState {
        let state = storage_proto::SenderKeyStateStructure {
            chain_id: key_id,
            sender_chain_key: Some(
                SenderChainKey::new(iteration, chain_key.to_vec()).as_protobuf(),
            ),
            sender_signing_key: Some(
                storage_proto::sender_key_state_structure::SenderSigningKey {
                    public: signature_key.serialize().to_vec(),
                    private: match signature_private_key {
                        None => vec![],
                        Some(k) => k.serialize().to_vec(),
                    },
                },
            ),
            sender_message_keys: vec![],
        };

        Self { state }
    }

    pub(crate) fn key_id(&self) -> u32 {
        self.state.chain_id
    }

    pub(crate) fn sender_chain_key(&self) -> Option<SenderChainKey> {
        let sender_chain = self.state.sender_chain_key.as_ref()?;
        Some(SenderChainKey::new(
            sender_chain.iteration,
            sender_chain.seed.clone(),
        ))
    }

    pub(crate) fn set_sender_chain_key(&mut self, chain_key: SenderChainKey) {
        self.state.sender_chain_key = Some(chain_key.as_protobuf());
    }

    pub(crate) fn signing_key_public(&self) -> Result<PublicKey, InvalidSessionError> {
        if let Some(ref signing_key) = self.state.sender_signing_key {
            PublicKey::try_from(&signing_key.public[..])
                .map_err(|_| InvalidSessionError("invalid public signing key"))
        } else {
            Err(InvalidSessionError("missing signing key"))
        }
    }

    pub(crate) fn signing_key_private(&self) -> Result<PrivateKey, InvalidSessionError> {
        if let Some(ref signing_key) = self.state.sender_signing_key {
            PrivateKey::deserialize(&signing_key.private)
                .map_err(|_| InvalidSessionError("invalid private signing key"))
        } else {
            Err(InvalidSessionError("missing signing key"))
        }
    }

    pub(crate) fn add_sender_message_key(&mut self, sender_message_key: &SenderMessageKey) {
        self.state
            .sender_message_keys
            .push(sender_message_key.as_protobuf());
        while self.state.sender_message_keys.len() > consts::MAX_MESSAGE_KEYS {
            self.state.sender_message_keys.remove(0);
        }
    }

    pub(crate) fn remove_sender_message_key(&mut self, iteration: u32) -> Option<SenderMessageKey> {
        let index = self
            .state
            .sender_message_keys
            .iter()
            .position(|x| x.iteration == iteration)?;
        let smk = self.state.sender_message_keys.remove(index);
        Some(SenderMessageKey::from_protobuf(smk))
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SenderKeyRecord {
    states: VecDeque<SenderKeyState>,
}

impl SenderKeyRecord {
    pub(crate) fn new_empty() -> Self {
        Self {
            states: VecDeque::with_capacity(consts::MAX_SENDER_KEY_STATES),
        }
    }

    pub(crate) fn deserialize(buf: &[u8]) -> Result<SenderKeyRecord, SignalProtocolError> {
        let skr = storage_proto::SenderKeyRecordStructure::decode(buf)
            .map_err(|_| SignalProtocolError::InvalidProtobufEncoding)?;

        Ok(Self {
            states: skr
                .sender_key_states
                .into_iter()
                .map(|state| SenderKeyState { state })
                .collect(),
        })
    }

    pub(crate) fn sender_key_state(&self) -> Result<&SenderKeyState, InvalidSessionError> {
        self.states
            .front()
            .ok_or(InvalidSessionError("empty sender key state"))
    }

    pub(crate) fn sender_key_state_mut(
        &mut self,
    ) -> Result<&mut SenderKeyState, InvalidSessionError> {
        self.states
            .front_mut()
            .ok_or(InvalidSessionError("empty sender key state"))
    }

    pub(crate) fn sender_key_state_for_key_id(
        &mut self,
        key_id: u32,
    ) -> Option<&mut SenderKeyState> {
        self.states
            .iter_mut()
            .find(|state| state.key_id() == key_id)
    }

    pub(crate) fn add_sender_key_state(
        &mut self,
        key_id: u32,
        iteration: u32,
        chain_key: &[u8],
        signature_key: PublicKey,
        signature_private_key: Option<PrivateKey>,
    ) {
        let existing_state = self.remove_state(key_id, signature_key);

        if self.remove_states_with_key_id(key_id) > 0 {
            tracing::warn!(
                key_id,
                "removed a matching key ID found with a different public key"
            );
        }

        let state = match existing_state {
            None => SenderKeyState::new(
                key_id,
                iteration,
                chain_key,
                signature_key,
                signature_private_key,
            ),
            Some(state) => state,
        };

        while self.states.len() >= consts::MAX_SENDER_KEY_STATES {
            self.states.pop_back();
        }

        self.states.push_front(state);
    }

    /// Remove the state with the matching `key_id` and `signature_key`.
    ///
    /// Skips any bad protobufs.
    fn remove_state(&mut self, key_id: u32, signature_key: PublicKey) -> Option<SenderKeyState> {
        let index = self.states.iter().position(|state| {
            state.key_id() == key_id && state.signing_key_public().ok() == Some(signature_key)
        })?;

        self.states.remove(index)
    }

    /// Returns the number of removed states.
    ///
    /// Skips any bad protobufs.
    fn remove_states_with_key_id(&mut self, key_id: u32) -> usize {
        let initial_length = self.states.len();
        self.states.retain(|state| state.key_id() != key_id);
        initial_length - self.states.len()
    }

    pub(crate) fn serialize(&self) -> Vec<u8> {
        storage_proto::SenderKeyRecordStructure {
            sender_key_states: self
                .states
                .iter()
                .map(|state| state.state.clone())
                .collect(),
        }
        .encode_to_vec()
    }
}
