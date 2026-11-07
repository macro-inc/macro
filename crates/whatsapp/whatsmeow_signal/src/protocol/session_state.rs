//
// Copyright 2020-2022 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/state/session.rs and
// modified by Macro: no Kyber or post-quantum ratchet state, no pre-key
// timestamp (go.mau.fi/libsignal never expires an unacknowledged session),
// identity keys are plain curve public keys, and the logging-only accessors
// are gone. See NOTICE.

use libsignal_core::curve::{KeyPair, PrivateKey, PublicKey};
use prost::Message;
use subtle::ConstantTimeEq;

use super::consts;
use super::error::SignalProtocolError;
use super::proto::storage::{RecordStructure, SessionStructure, session_structure};
use super::ratchet::{ChainKey, MessageKeys, RootKey};

/// A distinct error type to keep from accidentally propagating deserialization errors.
#[derive(Debug)]
pub(crate) struct InvalidSessionError(&'static str);

impl std::fmt::Display for InvalidSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl From<InvalidSessionError> for SignalProtocolError {
    fn from(e: InvalidSessionError) -> Self {
        Self::InvalidSessionStructure(e.0)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct UnacknowledgedPreKeyMessageItems {
    pub(crate) pre_key_id: Option<u32>,
    pub(crate) signed_pre_key_id: u32,
    pub(crate) base_key: PublicKey,
}

#[derive(Clone, Debug)]
pub(crate) struct SessionState {
    session: SessionStructure,
}

impl SessionState {
    pub(crate) fn new(
        version: u8,
        our_identity: &PublicKey,
        their_identity: &PublicKey,
        root_key: &RootKey,
        alice_base_key: &PublicKey,
    ) -> Self {
        Self {
            session: SessionStructure {
                session_version: version as u32,
                local_identity_public: our_identity.serialize().into_vec(),
                remote_identity_public: their_identity.serialize().into_vec(),
                root_key: root_key.key().to_vec(),
                previous_counter: 0,
                sender_chain: None,
                receiver_chains: vec![],
                pending_pre_key: None,
                remote_registration_id: 0,
                local_registration_id: 0,
                alice_base_key: alice_base_key.serialize().into_vec(),
            },
        }
    }

    pub(crate) fn alice_base_key(&self) -> &[u8] {
        &self.session.alice_base_key
    }

    pub(crate) fn session_version(&self) -> u32 {
        match self.session.session_version {
            0 => 2,
            v => v,
        }
    }

    pub(crate) fn remote_identity_key(&self) -> Result<Option<PublicKey>, InvalidSessionError> {
        match self.session.remote_identity_public.len() {
            0 => Ok(None),
            _ => Ok(Some(
                PublicKey::deserialize(&self.session.remote_identity_public)
                    .map_err(|_| InvalidSessionError("invalid remote identity key"))?,
            )),
        }
    }

    pub(crate) fn local_identity_key(&self) -> Result<PublicKey, InvalidSessionError> {
        PublicKey::deserialize(&self.session.local_identity_public)
            .map_err(|_| InvalidSessionError("invalid local identity key"))
    }

    pub(crate) fn session_with_self(&self) -> Result<bool, InvalidSessionError> {
        if let Some(remote_id) = self.remote_identity_key()? {
            return Ok(remote_id == self.local_identity_key()?);
        }

        // If remote ID is not set then we can't be sure but treat as non-self
        Ok(false)
    }

    pub(crate) fn previous_counter(&self) -> u32 {
        self.session.previous_counter
    }

    pub(crate) fn set_previous_counter(&mut self, ctr: u32) {
        self.session.previous_counter = ctr;
    }

    pub(crate) fn root_key(&self) -> Result<RootKey, InvalidSessionError> {
        let root_key_bytes = self.session.root_key[..]
            .try_into()
            .map_err(|_| InvalidSessionError("invalid root key"))?;
        Ok(RootKey::new(root_key_bytes))
    }

    pub(crate) fn set_root_key(&mut self, root_key: &RootKey) {
        self.session.root_key = root_key.key().to_vec();
    }

    pub(crate) fn sender_ratchet_key(&self) -> Result<PublicKey, InvalidSessionError> {
        match self.session.sender_chain {
            None => Err(InvalidSessionError("missing sender chain")),
            Some(ref c) => PublicKey::deserialize(&c.sender_ratchet_key)
                .map_err(|_| InvalidSessionError("invalid sender chain ratchet key")),
        }
    }

    pub(crate) fn sender_ratchet_private_key(&self) -> Result<PrivateKey, InvalidSessionError> {
        match self.session.sender_chain {
            None => Err(InvalidSessionError("missing sender chain")),
            Some(ref c) => PrivateKey::deserialize(&c.sender_ratchet_key_private)
                .map_err(|_| InvalidSessionError("invalid sender chain private ratchet key")),
        }
    }

    fn get_receiver_chain(
        &self,
        sender: &PublicKey,
    ) -> Result<Option<(session_structure::Chain, usize)>, InvalidSessionError> {
        for (idx, chain) in self.session.receiver_chains.iter().enumerate() {
            // If we compared bytes directly it would be faster, but may miss non-canonical points.
            // It's unclear if supporting such points is desirable.
            let chain_ratchet_key = PublicKey::deserialize(&chain.sender_ratchet_key)
                .map_err(|_| InvalidSessionError("invalid receiver chain ratchet key"))?;

            if &chain_ratchet_key == sender {
                return Ok(Some((chain.clone(), idx)));
            }
        }

        Ok(None)
    }

    pub(crate) fn get_receiver_chain_key(
        &self,
        sender: &PublicKey,
    ) -> Result<Option<ChainKey>, InvalidSessionError> {
        match self.get_receiver_chain(sender)? {
            None => Ok(None),
            Some((chain, _)) => match chain.chain_key {
                None => Err(InvalidSessionError("missing receiver chain key")),
                Some(c) => {
                    let chain_key_bytes = c.key[..]
                        .try_into()
                        .map_err(|_| InvalidSessionError("invalid receiver chain key"))?;
                    Ok(Some(ChainKey::new(chain_key_bytes, c.index)))
                }
            },
        }
    }

    pub(crate) fn add_receiver_chain(&mut self, sender: &PublicKey, chain_key: &ChainKey) {
        let chain_key = session_structure::chain::ChainKey {
            index: chain_key.index(),
            key: chain_key.key().to_vec(),
        };

        let chain = session_structure::Chain {
            sender_ratchet_key: sender.serialize().to_vec(),
            sender_ratchet_key_private: vec![],
            chain_key: Some(chain_key),
            message_keys: vec![],
        };

        self.session.receiver_chains.push(chain);

        if self.session.receiver_chains.len() > consts::MAX_RECEIVER_CHAINS {
            tracing::info!(
                chain_count = self.session.receiver_chains.len(),
                "trimming excessive receiver chain"
            );
            self.session.receiver_chains.remove(0);
        }
    }

    pub(crate) fn with_receiver_chain(mut self, sender: &PublicKey, chain_key: &ChainKey) -> Self {
        self.add_receiver_chain(sender, chain_key);
        self
    }

    pub(crate) fn set_sender_chain(&mut self, sender: &KeyPair, next_chain_key: &ChainKey) {
        let chain_key = session_structure::chain::ChainKey {
            index: next_chain_key.index(),
            key: next_chain_key.key().to_vec(),
        };

        let new_chain = session_structure::Chain {
            sender_ratchet_key: sender.public_key.serialize().to_vec(),
            sender_ratchet_key_private: sender.private_key.serialize().to_vec(),
            chain_key: Some(chain_key),
            message_keys: vec![],
        };

        self.session.sender_chain = Some(new_chain);
    }

    pub(crate) fn with_sender_chain(mut self, sender: &KeyPair, next_chain_key: &ChainKey) -> Self {
        self.set_sender_chain(sender, next_chain_key);
        self
    }

    pub(crate) fn get_sender_chain_key(&self) -> Result<ChainKey, InvalidSessionError> {
        let sender_chain = self
            .session
            .sender_chain
            .as_ref()
            .ok_or(InvalidSessionError("missing sender chain"))?;

        let chain_key = sender_chain
            .chain_key
            .as_ref()
            .ok_or(InvalidSessionError("missing sender chain key"))?;

        let chain_key_bytes = chain_key.key[..]
            .try_into()
            .map_err(|_| InvalidSessionError("invalid sender chain key"))?;

        Ok(ChainKey::new(chain_key_bytes, chain_key.index))
    }

    pub(crate) fn set_sender_chain_key(&mut self, next_chain_key: &ChainKey) {
        let chain_key = session_structure::chain::ChainKey {
            index: next_chain_key.index(),
            key: next_chain_key.key().to_vec(),
        };

        let new_chain = match self.session.sender_chain.take() {
            None => session_structure::Chain {
                sender_ratchet_key: vec![],
                sender_ratchet_key_private: vec![],
                chain_key: Some(chain_key),
                message_keys: vec![],
            },
            Some(mut c) => {
                c.chain_key = Some(chain_key);
                c
            }
        };

        self.session.sender_chain = Some(new_chain);
    }

    pub(crate) fn get_message_keys(
        &mut self,
        sender: &PublicKey,
        counter: u32,
    ) -> Result<Option<MessageKeys>, InvalidSessionError> {
        if let Some(mut chain_and_index) = self.get_receiver_chain(sender)? {
            let message_key_idx = chain_and_index
                .0
                .message_keys
                .iter()
                .position(|m| m.index == counter);

            if let Some(position) = message_key_idx {
                let message_key = chain_and_index.0.message_keys.remove(position);
                let keys = MessageKeys::new(
                    message_key
                        .cipher_key
                        .as_slice()
                        .try_into()
                        .map_err(|_| InvalidSessionError("invalid message cipher key"))?,
                    message_key
                        .mac_key
                        .as_slice()
                        .try_into()
                        .map_err(|_| InvalidSessionError("invalid message MAC key"))?,
                    message_key
                        .iv
                        .as_slice()
                        .try_into()
                        .map_err(|_| InvalidSessionError("invalid message IV"))?,
                    message_key.index,
                );

                // Update with message key removed
                self.session.receiver_chains[chain_and_index.1] = chain_and_index.0;
                return Ok(Some(keys));
            }
        }

        Ok(None)
    }

    pub(crate) fn set_message_keys(
        &mut self,
        sender: &PublicKey,
        message_keys: MessageKeys,
    ) -> Result<(), InvalidSessionError> {
        let (mut updated_chain, index) = self.get_receiver_chain(sender)?.ok_or(
            InvalidSessionError("missing receiver chain for message keys"),
        )?;
        updated_chain.message_keys.insert(
            0,
            session_structure::chain::MessageKey {
                index: message_keys.counter(),
                cipher_key: message_keys.cipher_key().to_vec(),
                mac_key: message_keys.mac_key().to_vec(),
                iv: message_keys.iv().to_vec(),
            },
        );

        if updated_chain.message_keys.len() > consts::MAX_MESSAGE_KEYS {
            updated_chain.message_keys.pop();
        }

        self.session.receiver_chains[index] = updated_chain;

        Ok(())
    }

    pub(crate) fn set_receiver_chain_key(
        &mut self,
        sender: &PublicKey,
        chain_key: &ChainKey,
    ) -> Result<(), InvalidSessionError> {
        let (mut updated_chain, index) = self
            .get_receiver_chain(sender)?
            .ok_or(InvalidSessionError("missing receiver chain for chain key"))?;
        updated_chain.chain_key = Some(session_structure::chain::ChainKey {
            index: chain_key.index(),
            key: chain_key.key().to_vec(),
        });

        self.session.receiver_chains[index] = updated_chain;

        Ok(())
    }

    pub(crate) fn set_unacknowledged_pre_key_message(
        &mut self,
        pre_key_id: Option<u32>,
        signed_pre_key_id: u32,
        base_key: &PublicKey,
    ) {
        self.session.pending_pre_key = Some(session_structure::PendingPreKey {
            pre_key_id,
            signed_pre_key_id: signed_pre_key_id as i32,
            base_key: base_key.serialize().to_vec(),
        });
    }

    pub(crate) fn unacknowledged_pre_key_message_items(
        &self,
    ) -> Result<Option<UnacknowledgedPreKeyMessageItems>, InvalidSessionError> {
        match &self.session.pending_pre_key {
            Some(pending_pre_key) => Ok(Some(UnacknowledgedPreKeyMessageItems {
                pre_key_id: pending_pre_key.pre_key_id,
                signed_pre_key_id: pending_pre_key.signed_pre_key_id as u32,
                base_key: PublicKey::deserialize(&pending_pre_key.base_key)
                    .map_err(|_| InvalidSessionError("invalid pending PreKey message base key"))?,
            })),
            None => Ok(None),
        }
    }

    pub(crate) fn clear_unacknowledged_pre_key_message(&mut self) {
        self.session.pending_pre_key = None;
    }

    pub(crate) fn set_remote_registration_id(&mut self, registration_id: u32) {
        self.session.remote_registration_id = registration_id;
    }

    pub(crate) fn set_local_registration_id(&mut self, registration_id: u32) {
        self.session.local_registration_id = registration_id;
    }

    pub(crate) fn local_registration_id(&self) -> u32 {
        self.session.local_registration_id
    }
}

#[derive(Clone, Debug)]
pub(crate) struct SessionRecord {
    current_session: Option<SessionState>,
    previous_sessions: Vec<Vec<u8>>,
}

impl SessionRecord {
    pub(crate) fn new_fresh() -> Self {
        Self {
            current_session: None,
            previous_sessions: Vec::new(),
        }
    }

    pub(crate) fn deserialize(bytes: &[u8]) -> Result<Self, SignalProtocolError> {
        let record = RecordStructure::decode(bytes)
            .map_err(|_| InvalidSessionError("failed to decode session record protobuf"))?;

        Ok(Self {
            current_session: record
                .current_session
                .map(|session| SessionState { session }),
            previous_sessions: record.previous_sessions,
        })
    }

    /// If there's a session with a matching version and `alice_base_key`, ensures that it is the
    /// current session, promoting if necessary.
    ///
    /// Returns `Ok(true)` if such a session was found, `Ok(false)` if not, and
    /// `Err(InvalidSessionError)` if an invalid session was found during the search (whether
    /// current or not).
    pub(crate) fn promote_matching_session(
        &mut self,
        version: u32,
        alice_base_key: &[u8],
    ) -> Result<bool, InvalidSessionError> {
        if let Some(current_session) = &self.current_session
            && current_session.session_version() == version
            && bool::from(alice_base_key.ct_eq(current_session.alice_base_key()))
        {
            return Ok(true);
        }

        let mut session_to_promote = None;
        for (i, previous) in self.previous_session_states().enumerate() {
            let previous = previous?;
            if previous.session_version() == version
                && bool::from(alice_base_key.ct_eq(previous.alice_base_key()))
            {
                session_to_promote = Some((i, previous));
                break;
            }
        }

        if let Some((i, state)) = session_to_promote {
            self.promote_old_session(i, state);
            return Ok(true);
        }

        Ok(false)
    }

    pub(crate) fn session_state(&self) -> Option<&SessionState> {
        self.current_session.as_ref()
    }

    pub(crate) fn session_state_mut(&mut self) -> Option<&mut SessionState> {
        self.current_session.as_mut()
    }

    pub(crate) fn set_session_state(&mut self, session: SessionState) {
        self.current_session = Some(session);
    }

    pub(crate) fn previous_session_states(
        &self,
    ) -> impl ExactSizeIterator<Item = Result<SessionState, InvalidSessionError>> + '_ {
        self.previous_sessions.iter().map(|bytes| {
            Ok(SessionState {
                session: SessionStructure::decode(&bytes[..]).map_err(|_| {
                    InvalidSessionError("failed to decode previous session protobuf")
                })?,
            })
        })
    }

    pub(crate) fn promote_old_session(
        &mut self,
        old_session: usize,
        updated_session: SessionState,
    ) {
        self.previous_sessions.remove(old_session);
        self.promote_state(updated_session)
    }

    pub(crate) fn promote_state(&mut self, new_state: SessionState) {
        self.archive_current_state();
        self.current_session = Some(new_state);
    }

    fn archive_current_state(&mut self) {
        if let Some(mut current_session) = self.current_session.take() {
            if self.previous_sessions.len() >= consts::ARCHIVED_STATES_MAX_LENGTH {
                self.previous_sessions.pop();
            }
            current_session.clear_unacknowledged_pre_key_message();
            self.previous_sessions
                .insert(0, current_session.session.encode_to_vec());
        }
    }

    pub(crate) fn serialize(&self) -> Vec<u8> {
        RecordStructure {
            current_session: self
                .current_session
                .as_ref()
                .map(|state| state.session.clone()),
            previous_sessions: self.previous_sessions.clone(),
        }
        .encode_to_vec()
    }
}
