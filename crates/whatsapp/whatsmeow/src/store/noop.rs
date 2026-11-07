// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/noop.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::store::*;
use crate::types::{ContactInfo, Jid, LocalChatSettings, MessageId};
use crate::util::keys::PreKey;

/// Which error a [`NoopStore`] returns. Go stores an `error` value; the port's
/// store error isn't clonable, so the store keeps the kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoopError {
    /// [`StoreError::DeviceDeleted`].
    DeviceDeleted,
    /// [`StoreError::StoreIsNil`].
    StoreIsNil,
}

impl NoopError {
    fn to_store_error(self) -> StoreError {
        match self {
            NoopError::DeviceDeleted => StoreError::DeviceDeleted,
            NoopError::StoreIsNil => StoreError::StoreIsNil,
        }
    }
}

/// A store where every operation fails with the same error. A deleted device
/// uses it for all of its stores.
///
/// Not ported: Go's `NoopDevice`, a placeholder device for nil clients.
#[derive(Clone, Copy, Debug)]
pub struct NoopStore {
    /// The error every operation returns.
    pub error: NoopError,
}

#[async_trait]
impl IdentityStore for NoopStore {
    async fn put_identity(&self, _address: &str, _key: [u8; 32]) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_all_identities(&self, _phone: &str) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_identity(&self, _address: &str) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn is_trusted_identity(
        &self,
        _address: &str,
        _key: [u8; 32],
    ) -> Result<bool, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl SessionStore for NoopStore {
    async fn get_session(&self, _address: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn has_session(&self, _address: &str) -> Result<bool, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_many_sessions(
        &self,
        _addresses: &[String],
    ) -> Result<HashMap<String, Option<Vec<u8>>>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_session(&self, _address: &str, _session: Vec<u8>) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_many_sessions(
        &self,
        _sessions: HashMap<String, Vec<u8>>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_all_sessions(&self, _phone: &str) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_session(&self, _address: &str) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn migrate_pn_to_lid(&self, _pn: &Jid, _lid: &Jid) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl PreKeyStore for NoopStore {
    async fn get_or_gen_pre_keys(&self, _count: u32) -> Result<Vec<PreKey>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn gen_one_pre_key(&self) -> Result<PreKey, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_pre_key(&self, _id: u32) -> Result<Option<PreKey>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn remove_pre_key(&self, _id: u32) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn mark_pre_keys_as_uploaded(&self, _up_to_id: u32) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn uploaded_pre_key_count(&self) -> Result<usize, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl SenderKeyStore for NoopStore {
    async fn put_sender_key(
        &self,
        _group: &str,
        _user: &str,
        _session: Vec<u8>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_sender_key(
        &self,
        _group: &str,
        _user: &str,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl AppStateSyncKeyStore for NoopStore {
    async fn put_app_state_sync_key(
        &self,
        _id: &[u8],
        _key: AppStateSyncKey,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_app_state_sync_key(
        &self,
        _id: &[u8],
    ) -> Result<Option<AppStateSyncKey>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_latest_app_state_sync_key_id(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_all_app_state_sync_keys(&self) -> Result<Vec<AppStateSyncKey>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl AppStateStore for NoopStore {
    async fn put_app_state_version(
        &self,
        _name: &str,
        _version: u64,
        _hash: [u8; 128],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_app_state_version(&self, _name: &str) -> Result<(u64, [u8; 128]), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_app_state_version(&self, _name: &str) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_app_state_mutation_macs(
        &self,
        _name: &str,
        _version: u64,
        _mutations: &[AppStateMutationMac],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_app_state_mutation_macs(
        &self,
        _name: &str,
        _index_macs: &[Vec<u8>],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_app_state_mutation_mac(
        &self,
        _name: &str,
        _index_mac: &[u8],
    ) -> Result<Option<Vec<u8>>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl ContactStore for NoopStore {
    async fn put_push_name(
        &self,
        _user: &Jid,
        _push_name: &str,
    ) -> Result<(bool, String), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_business_name(
        &self,
        _user: &Jid,
        _business_name: &str,
    ) -> Result<(bool, String), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_contact_name(
        &self,
        _user: &Jid,
        _full_name: &str,
        _first_name: &str,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_all_contact_names(&self, _contacts: &[ContactEntry]) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_many_redacted_phones(
        &self,
        _entries: &[RedactedPhoneEntry],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_contact(&self, _user: &Jid) -> Result<Option<ContactInfo>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_all_contacts(&self) -> Result<HashMap<Jid, ContactInfo>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl ChatSettingsStore for NoopStore {
    async fn put_muted_until(
        &self,
        _chat: &Jid,
        _muted_until: Option<DateTime<Utc>>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_pinned(&self, _chat: &Jid, _pinned: bool) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_archived(&self, _chat: &Jid, _archived: bool) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_wasa_root_secret_id(
        &self,
        _chat: &Jid,
        _id: &MessageId,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_wasa_root_secret_id(&self, _chat: &Jid) -> Result<Option<MessageId>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_chat_settings(
        &self,
        _chat: &Jid,
    ) -> Result<Option<LocalChatSettings>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl DeviceContainer for NoopStore {
    async fn put_device(&self, _store: &Device) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_device(&self, _store: &Device) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl MsgSecretStore for NoopStore {
    async fn put_message_secrets(
        &self,
        _inserts: &[MessageSecretInsert],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_message_secret(
        &self,
        _chat: &Jid,
        _sender: &Jid,
        _id: &MessageId,
        _secret: Vec<u8>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_message_secret(
        &self,
        _chat: &Jid,
        _sender: &Jid,
        _id: &MessageId,
    ) -> Result<Option<(Vec<u8>, Jid)>, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl PrivacyTokenStore for NoopStore {
    async fn put_privacy_tokens(&self, _tokens: &[PrivacyToken]) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_privacy_token(&self, _user: &Jid) -> Result<Option<PrivacyToken>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_expired_privacy_tokens(
        &self,
        _cutoff: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl NctSaltStore for NoopStore {
    async fn put_nct_salt(&self, _salt: Vec<u8>) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_nct_salt(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_nct_salt(&self) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl EventBuffer for NoopStore {
    async fn get_buffered_event(
        &self,
        _ciphertext_hash: [u8; 32],
    ) -> Result<Option<BufferedEvent>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_buffered_event(
        &self,
        _ciphertext_hash: [u8; 32],
        _plaintext: Vec<u8>,
        _server_timestamp: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn do_decryption_txn(&self, _body: DecryptionTransaction<'_>) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn clear_buffered_event_plaintext(
        &self,
        _ciphertext_hash: [u8; 32],
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_old_buffered_hashes(&self) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_outgoing_event(
        &self,
        _chat_jid: &Jid,
        _alt_chat_jid: &Jid,
        _id: &MessageId,
    ) -> Result<Option<(String, Vec<u8>)>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn add_outgoing_event(
        &self,
        _chat_jid: &Jid,
        _id: &MessageId,
        _format: &str,
        _plaintext: Vec<u8>,
    ) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn delete_old_outgoing_events(&self) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }
}

#[async_trait]
impl LidStore for NoopStore {
    async fn put_many_lid_mappings(&self, _mappings: &[LidMapping]) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn put_lid_mapping(&self, _lid: &Jid, _jid: &Jid) -> Result<(), StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_pn_for_lid(&self, _lid: &Jid) -> Result<Option<Jid>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_lid_for_pn(&self, _pn: &Jid) -> Result<Option<Jid>, StoreError> {
        Err(self.error.to_store_error())
    }

    async fn get_many_lids_for_pns(&self, _pns: &[Jid]) -> Result<HashMap<Jid, Jid>, StoreError> {
        Err(self.error.to_store_error())
    }
}
