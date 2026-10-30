//! Typed access to the port's [`SignalProtocolStore`], which hands keys and
//! records across as raw bytes.

use libsignal_core::curve::{KeyPair, PrivateKey, PublicKey};
use whatsmeow::signal::{SenderKeyName, SignalAddress, SignalProtocolStore};

use crate::protocol::error::{Result, SignalProtocolError};
use crate::protocol::sender_keys::SenderKeyRecord;
use crate::protocol::session_state::SessionRecord;

/// Converts the raw (public, private) Curve25519 pair the store returns.
pub(crate) fn key_pair(public: &[u8; 32], private: &[u8; 32]) -> Result<KeyPair> {
    Ok(KeyPair::new(
        PublicKey::from_djb_public_key_bytes(public)?,
        PrivateKey::deserialize(private)?,
    ))
}

/// Converts a curve public key to the raw 32 bytes the store keeps.
pub(crate) fn raw_public_key(key: &PublicKey) -> Result<[u8; 32]> {
    key.public_key_bytes()
        .try_into()
        .map_err(|_| SignalProtocolError::InvalidArgument("public key is not 32 bytes".into()))
}

pub(crate) struct ProtocolStore<'a>(pub(crate) &'a dyn SignalProtocolStore);

impl ProtocolStore<'_> {
    pub(crate) fn identity_key_pair(&self) -> Result<KeyPair> {
        let (public, private) = self.0.get_identity_key_pair();
        key_pair(&public, &private)
    }

    pub(crate) fn local_registration_id(&self) -> u32 {
        self.0.get_local_registration_id()
    }

    pub(crate) async fn is_trusted_identity(
        &self,
        address: &SignalAddress,
        identity_key: &PublicKey,
    ) -> Result<bool> {
        Ok(self
            .0
            .is_trusted_identity(address, raw_public_key(identity_key)?)
            .await?)
    }

    pub(crate) async fn save_identity(
        &self,
        address: &SignalAddress,
        identity_key: &PublicKey,
    ) -> Result<()> {
        Ok(self
            .0
            .save_identity(address, raw_public_key(identity_key)?)
            .await?)
    }

    pub(crate) async fn load_session(
        &self,
        address: &SignalAddress,
    ) -> Result<Option<SessionRecord>> {
        match self.0.load_session(address).await? {
            Some(bytes) => Ok(Some(SessionRecord::deserialize(&bytes)?)),
            None => Ok(None),
        }
    }

    pub(crate) async fn store_session(
        &self,
        address: &SignalAddress,
        record: &SessionRecord,
    ) -> Result<()> {
        Ok(self.0.store_session(address, record.serialize()).await?)
    }

    pub(crate) async fn pre_key(&self, id: u32) -> Result<KeyPair> {
        let (public, private) = self
            .0
            .load_pre_key(id)
            .await?
            .ok_or(SignalProtocolError::InvalidPreKeyId)?;
        key_pair(&public, &private)
    }

    pub(crate) async fn remove_pre_key(&self, id: u32) -> Result<()> {
        Ok(self.0.remove_pre_key(id).await?)
    }

    pub(crate) fn signed_pre_key(&self, id: u32) -> Result<KeyPair> {
        let (public, private, _signature) = self
            .0
            .load_signed_pre_key(id)
            .ok_or(SignalProtocolError::InvalidSignedPreKeyId)?;
        key_pair(&public, &private)
    }

    pub(crate) async fn load_sender_key(
        &self,
        name: &SenderKeyName,
    ) -> Result<Option<SenderKeyRecord>> {
        match self.0.load_sender_key(name).await? {
            Some(bytes) => Ok(Some(SenderKeyRecord::deserialize(&bytes)?)),
            None => Ok(None),
        }
    }

    pub(crate) async fn store_sender_key(
        &self,
        name: &SenderKeyName,
        record: &SenderKeyRecord,
    ) -> Result<()> {
        Ok(self.0.store_sender_key(name, record.serialize()).await?)
    }
}
