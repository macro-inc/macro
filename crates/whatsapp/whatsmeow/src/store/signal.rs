// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/signal.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `Device` implements libsignal's store interface directly, with
// `panic("not implemented")` for the methods libsignal never calls on it;
// those are left out of `SignalProtocolStore`.

use async_trait::async_trait;

use super::sessioncache::SessionCache;
use super::store::{Device, StoreError};
use crate::signal::{SenderKeyName, SignalAddress, SignalProtocolStore};

/// A device as libsignal's store, with an optional session cache.
pub struct DeviceSignalStore<'device> {
    device: &'device Device,
    cache: Option<&'device SessionCache>,
}

impl Device {
    /// The device as the store a [`crate::signal::SignalProtocol`] reads and
    /// writes, using the session cache from [`Device::with_cached_sessions`]
    /// if there is one.
    pub fn signal_store<'device>(
        &'device self,
        cache: Option<&'device SessionCache>,
    ) -> DeviceSignalStore<'device> {
        DeviceSignalStore {
            device: self,
            cache,
        }
    }
}

#[async_trait]
impl SignalProtocolStore for DeviceSignalStore<'_> {
    fn get_identity_key_pair(&self) -> ([u8; 32], [u8; 32]) {
        let identity_key = &self.device.identity_key;
        (identity_key.public, identity_key.private)
    }

    fn get_local_registration_id(&self) -> u32 {
        self.device.registration_id
    }

    async fn save_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<(), StoreError> {
        self.device
            .identities
            .put_identity(&address.to_string(), identity_key)
            .await
    }

    async fn is_trusted_identity(
        &self,
        address: &SignalAddress,
        identity_key: [u8; 32],
    ) -> Result<bool, StoreError> {
        self.device
            .identities
            .is_trusted_identity(&address.to_string(), identity_key)
            .await
    }

    async fn load_pre_key(&self, id: u32) -> Result<Option<([u8; 32], [u8; 32])>, StoreError> {
        Ok(self
            .device
            .pre_keys
            .get_pre_key(id)
            .await?
            .map(|pre_key| (pre_key.key_pair.public, pre_key.key_pair.private)))
    }

    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError> {
        self.device.pre_keys.remove_pre_key(id).await
    }

    async fn load_session(&self, address: &SignalAddress) -> Result<Option<Vec<u8>>, StoreError> {
        let address = address.to_string();
        if let Some(cached) = self
            .cache
            .and_then(|cache| cache.get_cached_session(&address))
        {
            return Ok(cached);
        }
        self.device.sessions.get_session(&address).await
    }

    async fn store_session(
        &self,
        address: &SignalAddress,
        record: Vec<u8>,
    ) -> Result<(), StoreError> {
        let address = address.to_string();
        match self.cache {
            Some(cache) => {
                cache.put_cached_session(&address, record);
                Ok(())
            }
            None => self.device.sessions.put_session(&address, record).await,
        }
    }

    async fn contains_session(&self, address: &SignalAddress) -> Result<bool, StoreError> {
        self.device.sessions.has_session(&address.to_string()).await
    }

    fn load_signed_pre_key(&self, id: u32) -> Option<([u8; 32], [u8; 32], [u8; 64])> {
        let signed_pre_key = &self.device.signed_pre_key;
        if id != signed_pre_key.key_id {
            return None;
        }
        Some((
            signed_pre_key.key_pair.public,
            signed_pre_key.key_pair.private,
            signed_pre_key.signature?,
        ))
    }

    async fn store_sender_key(
        &self,
        name: &SenderKeyName,
        record: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.device
            .sender_keys
            .put_sender_key(&name.group_id, &name.sender.to_string(), record)
            .await
    }

    async fn load_sender_key(&self, name: &SenderKeyName) -> Result<Option<Vec<u8>>, StoreError> {
        self.device
            .sender_keys
            .get_sender_key(&name.group_id, &name.sender.to_string())
            .await
    }
}
