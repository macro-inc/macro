//! An in-memory [`SignalProtocolStore`] whose keys come from a caller's
//! generator, so tests can replay a conversation byte for byte.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use async_trait::async_trait;
use libsignal_core::curve::KeyPair;
use rand::rngs::StdRng;
use whatsmeow::signal::{
    CurveSignatures, DJB_TYPE, PreKeyBundle, SenderKeyName, SignalAddress, SignalProtocolStore,
};
use whatsmeow::store::StoreError;

fn raw_key_pair(generator: &mut StdRng) -> ([u8; 32], [u8; 32]) {
    let pair = KeyPair::generate(generator);
    (
        pair.public_key
            .public_key_bytes()
            .try_into()
            .expect("curve25519 public keys are 32 bytes"),
        pair.private_key
            .serialize()
            .try_into()
            .expect("curve25519 private keys are 32 bytes"),
    )
}

#[derive(Default)]
struct State {
    pre_keys: HashMap<u32, ([u8; 32], [u8; 32])>,
    identities: HashMap<String, [u8; 32]>,
    sessions: HashMap<String, Vec<u8>>,
    sender_keys: HashMap<(String, String), Vec<u8>>,
}

pub(crate) struct TestStore {
    identity: ([u8; 32], [u8; 32]),
    registration_id: u32,
    signed_pre_key_id: u32,
    signed_pre_key: ([u8; 32], [u8; 32]),
    signed_pre_key_signature: [u8; 64],
    state: Mutex<State>,
}

impl TestStore {
    /// A device with a signed pre-key with ID 1 and one-time pre-keys with
    /// the given IDs.
    pub(crate) fn new(
        generator: &mut StdRng,
        signatures: &impl CurveSignatures,
        registration_id: u32,
        pre_key_ids: &[u32],
    ) -> Self {
        let identity = raw_key_pair(generator);
        let signed_pre_key = raw_key_pair(generator);
        let mut signed_public = [DJB_TYPE; 33];
        signed_public[1..].copy_from_slice(&signed_pre_key.0);
        let signed_pre_key_signature = signatures.calculate_signature(&identity.1, &signed_public);
        let pre_keys = pre_key_ids
            .iter()
            .map(|id| (*id, raw_key_pair(generator)))
            .collect();
        Self {
            identity,
            registration_id,
            signed_pre_key_id: 1,
            signed_pre_key,
            signed_pre_key_signature,
            state: Mutex::new(State {
                pre_keys,
                ..State::default()
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The bundle another device starts a session from.
    pub(crate) fn bundle(&self, device_id: u32, pre_key_id: Option<u32>) -> PreKeyBundle {
        PreKeyBundle {
            registration_id: self.registration_id,
            device_id,
            pre_key: pre_key_id.map(|id| (id, self.state().pre_keys[&id].0)),
            signed_pre_key_id: self.signed_pre_key_id,
            signed_pre_key_public: self.signed_pre_key.0,
            signed_pre_key_signature: self.signed_pre_key_signature,
            identity_key: self.identity.0,
        }
    }

    pub(crate) fn has_pre_key(&self, id: u32) -> bool {
        self.state().pre_keys.contains_key(&id)
    }

    pub(crate) fn session(&self, address: &SignalAddress) -> Option<Vec<u8>> {
        self.state().sessions.get(&address.to_string()).cloned()
    }

    pub(crate) fn set_session(&self, address: &SignalAddress, record: Vec<u8>) {
        self.state().sessions.insert(address.to_string(), record);
    }

    /// Forgets a sender key, as whatsmeow does to rotate its own.
    pub(crate) fn delete_sender_key(&self, name: &SenderKeyName) {
        self.state()
            .sender_keys
            .remove(&(name.group_id.clone(), name.sender.to_string()));
    }
}

#[async_trait]
impl SignalProtocolStore for TestStore {
    fn get_identity_key_pair(&self) -> ([u8; 32], [u8; 32]) {
        self.identity
    }

    fn get_local_registration_id(&self) -> u32 {
        self.registration_id
    }

    async fn save_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<(), StoreError> {
        self.state()
            .identities
            .insert(address.to_string(), identity_key);
        Ok(())
    }

    /// Trust on first use, like whatsmeow's SQL store.
    async fn is_trusted_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<bool, StoreError> {
        Ok(self
            .state()
            .identities
            .get(&address.to_string())
            .is_none_or(|known| *known == identity_key))
    }

    async fn load_pre_key(&self, id: u32) -> Result<Option<([u8; 32], [u8; 32])>, StoreError> {
        Ok(self.state().pre_keys.get(&id).copied())
    }

    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError> {
        self.state().pre_keys.remove(&id);
        Ok(())
    }

    async fn load_session(&self, address: &SignalAddress) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self.session(address))
    }

    async fn store_session(
        &self,
        address: &SignalAddress,
        record: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.set_session(address, record);
        Ok(())
    }

    async fn contains_session(&self, address: &SignalAddress) -> Result<bool, StoreError> {
        Ok(self.state().sessions.contains_key(&address.to_string()))
    }

    fn load_signed_pre_key(&self, id: u32) -> Option<([u8; 32], [u8; 32], [u8; 64])> {
        (id == self.signed_pre_key_id).then_some((
            self.signed_pre_key.0,
            self.signed_pre_key.1,
            self.signed_pre_key_signature,
        ))
    }

    async fn store_sender_key(
        &self,
        name: &SenderKeyName,
        record: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.state()
            .sender_keys
            .insert((name.group_id.clone(), name.sender.to_string()), record);
        Ok(())
    }

    async fn load_sender_key(&self, name: &SenderKeyName) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .state()
            .sender_keys
            .get(&(name.group_id.clone(), name.sender.to_string()))
            .cloned())
    }
}
