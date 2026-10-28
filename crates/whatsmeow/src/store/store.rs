// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/store.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! The store traits are object safe (a [`Device`] holds `Arc<dyn …>` handles,
//! as Go holds interfaces), hence `async_trait`. Go's `context.Context`
//! parameters are dropped: cancellation is dropping the future.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use super::noop::{NoopError, NoopStore};
use crate::proto::wa_adv::AdvSignedDeviceIdentity;
use crate::types::{
    ContactInfo, DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, LocalChatSettings, MessageId,
};
use crate::util::keys::{KeyPair, PreKey};

/// A store failure.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The device was deleted (`ErrDeviceDeleted`).
    #[error("invalid use of deleted device")]
    DeviceDeleted,
    /// The store was never set (the error of Go's `nilStore`).
    #[error("store is nil")]
    StoreIsNil,
    /// The call was invalid, like a LID lookup with a phone number JID.
    #[error("{0}")]
    InvalidArgument(String),
    /// The backing storage failed.
    #[error("store error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for StoreError {
    fn from(report: rootcause::Report) -> Self {
        StoreError::Internal(report)
    }
}

/// Peer identity keys, keyed by Signal address string.
#[async_trait]
pub trait IdentityStore: Send + Sync {
    /// Remembers a peer's identity key.
    async fn put_identity(&self, address: &str, key: [u8; 32]) -> Result<(), StoreError>;
    /// Forgets the identity keys of all devices of a user.
    async fn delete_all_identities(&self, phone: &str) -> Result<(), StoreError>;
    /// Forgets one device's identity key.
    async fn delete_identity(&self, address: &str) -> Result<(), StoreError>;
    /// Whether the key is the known identity key (or there is none yet).
    async fn is_trusted_identity(&self, address: &str, key: [u8; 32]) -> Result<bool, StoreError>;
}

/// Serialized Signal sessions, keyed by Signal address string.
#[async_trait]
pub trait SessionStore: Send + Sync {
    /// One session.
    async fn get_session(&self, address: &str) -> Result<Option<Vec<u8>>, StoreError>;
    /// Whether there is a session.
    async fn has_session(&self, address: &str) -> Result<bool, StoreError>;
    /// Several sessions, with an entry for every requested address (`None`
    /// when there is no session), as Go's map holds nil values.
    async fn get_many_sessions(
        &self,
        addresses: &[String],
    ) -> Result<HashMap<String, Option<Vec<u8>>>, StoreError>;
    /// Stores one session.
    async fn put_session(&self, address: &str, session: Vec<u8>) -> Result<(), StoreError>;
    /// Stores several sessions.
    async fn put_many_sessions(&self, sessions: HashMap<String, Vec<u8>>)
    -> Result<(), StoreError>;
    /// Deletes the sessions of all devices of a user.
    async fn delete_all_sessions(&self, phone: &str) -> Result<(), StoreError>;
    /// Deletes one session.
    async fn delete_session(&self, address: &str) -> Result<(), StoreError>;
    /// Moves a phone number user's sessions and identities to their LID.
    async fn migrate_pn_to_lid(&self, pn: &Jid, lid: &Jid) -> Result<(), StoreError>;
}

/// The local one-time prekeys.
#[async_trait]
pub trait PreKeyStore: Send + Sync {
    /// Prekeys not uploaded yet, generating new ones up to `count`.
    async fn get_or_gen_pre_keys(&self, count: u32) -> Result<Vec<PreKey>, StoreError>;
    /// Generates one prekey that counts as uploaded.
    async fn gen_one_pre_key(&self) -> Result<PreKey, StoreError>;
    /// One prekey.
    async fn get_pre_key(&self, id: u32) -> Result<Option<PreKey>, StoreError>;
    /// Removes a used prekey.
    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError>;
    /// Marks every prekey up to the ID as uploaded.
    async fn mark_pre_keys_as_uploaded(&self, up_to_id: u32) -> Result<(), StoreError>;
    /// How many uploaded prekeys are left.
    async fn uploaded_pre_key_count(&self) -> Result<usize, StoreError>;
}

/// Serialized group sender keys.
#[async_trait]
pub trait SenderKeyStore: Send + Sync {
    /// Stores the sender key of a user in a group.
    async fn put_sender_key(
        &self,
        group: &str,
        user: &str,
        session: Vec<u8>,
    ) -> Result<(), StoreError>;
    /// The sender key of a user in a group.
    async fn get_sender_key(&self, group: &str, user: &str) -> Result<Option<Vec<u8>>, StoreError>;
}

/// An app state sync key shared by the primary device.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppStateSyncKey {
    /// The key material.
    pub data: Vec<u8>,
    /// The serialized key fingerprint.
    pub fingerprint: Vec<u8>,
    /// When the key was created, in milliseconds.
    pub timestamp: i64,
}

/// App state sync keys, keyed by key ID.
#[async_trait]
pub trait AppStateSyncKeyStore: Send + Sync {
    /// Stores a key.
    async fn put_app_state_sync_key(
        &self,
        id: &[u8],
        key: AppStateSyncKey,
    ) -> Result<(), StoreError>;
    /// One key.
    async fn get_app_state_sync_key(
        &self,
        id: &[u8],
    ) -> Result<Option<AppStateSyncKey>, StoreError>;
    /// The ID of the newest key.
    async fn get_latest_app_state_sync_key_id(&self) -> Result<Option<Vec<u8>>, StoreError>;
    /// Every key.
    async fn get_all_app_state_sync_keys(&self) -> Result<Vec<AppStateSyncKey>, StoreError>;
}

/// The MACs of one app state mutation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppStateMutationMac {
    /// The MAC of the mutation's index.
    pub index_mac: Vec<u8>,
    /// The MAC of the mutation's value.
    pub value_mac: Vec<u8>,
}

/// App state versions and mutation MACs, per collection name.
#[async_trait]
pub trait AppStateStore: Send + Sync {
    /// Stores a collection's version and LT hash.
    async fn put_app_state_version(
        &self,
        name: &str,
        version: u64,
        hash: [u8; 128],
    ) -> Result<(), StoreError>;
    /// A collection's version and LT hash; version 0 and a zero hash when unknown.
    async fn get_app_state_version(&self, name: &str) -> Result<(u64, [u8; 128]), StoreError>;
    /// Forgets a collection's version.
    async fn delete_app_state_version(&self, name: &str) -> Result<(), StoreError>;
    /// Stores the MACs of mutations at a version.
    async fn put_app_state_mutation_macs(
        &self,
        name: &str,
        version: u64,
        mutations: &[AppStateMutationMac],
    ) -> Result<(), StoreError>;
    /// Deletes mutation MACs by index MAC.
    async fn delete_app_state_mutation_macs(
        &self,
        name: &str,
        index_macs: &[Vec<u8>],
    ) -> Result<(), StoreError>;
    /// The value MAC of the newest mutation with an index MAC.
    async fn get_app_state_mutation_mac(
        &self,
        name: &str,
        index_mac: &[u8],
    ) -> Result<Option<Vec<u8>>, StoreError>;
}

/// A contact name from the address book.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactEntry {
    /// The contact.
    pub jid: Jid,
    /// The first name.
    pub first_name: String,
    /// The full name.
    pub full_name: String,
}

/// A redacted phone number of a LID user.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RedactedPhoneEntry {
    /// The LID user.
    pub jid: Jid,
    /// The phone number in the form "+1∙∙∙∙∙∙∙∙80".
    pub redacted_phone: String,
}

/// Contact names.
#[async_trait]
pub trait ContactStore: Send + Sync {
    /// Stores a push name; returns whether it changed and the previous name.
    async fn put_push_name(
        &self,
        user: &Jid,
        push_name: &str,
    ) -> Result<(bool, String), StoreError>;
    /// Stores a business name; returns whether it changed and the previous name.
    async fn put_business_name(
        &self,
        user: &Jid,
        business_name: &str,
    ) -> Result<(bool, String), StoreError>;
    /// Stores an address book name.
    async fn put_contact_name(
        &self,
        user: &Jid,
        full_name: &str,
        first_name: &str,
    ) -> Result<(), StoreError>;
    /// Stores many address book names.
    async fn put_all_contact_names(&self, contacts: &[ContactEntry]) -> Result<(), StoreError>;
    /// Stores many redacted phone numbers.
    async fn put_many_redacted_phones(
        &self,
        entries: &[RedactedPhoneEntry],
    ) -> Result<(), StoreError>;
    /// One contact; Go returns `Found: false` where this returns `None`.
    async fn get_contact(&self, user: &Jid) -> Result<Option<ContactInfo>, StoreError>;
    /// Every contact.
    async fn get_all_contacts(&self) -> Result<HashMap<Jid, ContactInfo>, StoreError>;
}

/// The "muted until" time WhatsApp uses for chats muted forever.
pub static MUTED_FOREVER: LazyLock<DateTime<Utc>> = LazyLock::new(|| {
    NaiveDate::from_ymd_opt(9999, 12, 31)
        .and_then(|date| date.and_hms_nano_opt(23, 59, 59, 999_999_999))
        .map(|time| time.and_utc())
        .unwrap_or(DateTime::<Utc>::MAX_UTC)
});

/// Local chat settings synced through app state.
#[async_trait]
pub trait ChatSettingsStore: Send + Sync {
    /// Stores the mute end; `None` means unmuted (Go's zero time).
    async fn put_muted_until(
        &self,
        chat: &Jid,
        muted_until: Option<DateTime<Utc>>,
    ) -> Result<(), StoreError>;
    /// Stores whether the chat is pinned.
    async fn put_pinned(&self, chat: &Jid, pinned: bool) -> Result<(), StoreError>;
    /// Stores whether the chat is archived.
    async fn put_archived(&self, chat: &Jid, archived: bool) -> Result<(), StoreError>;
    /// Stores the WASA root secret message ID of a chat.
    async fn put_wasa_root_secret_id(&self, chat: &Jid, id: &MessageId) -> Result<(), StoreError>;
    /// The WASA root secret message ID of a chat.
    async fn get_wasa_root_secret_id(&self, chat: &Jid) -> Result<Option<MessageId>, StoreError>;
    /// A chat's settings; Go returns `Found: false` where this returns `None`.
    async fn get_chat_settings(&self, chat: &Jid) -> Result<Option<LocalChatSettings>, StoreError>;
}

/// Where devices are persisted.
#[async_trait]
pub trait DeviceContainer: Send + Sync {
    /// Stores the device's own data (keys, IDs, names).
    async fn put_device(&self, store: &Device) -> Result<(), StoreError>;
    /// Deletes the device and its data.
    async fn delete_device(&self, store: &Device) -> Result<(), StoreError>;
}

/// One message secret to store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageSecretInsert {
    /// The chat of the message.
    pub chat: Jid,
    /// The sender of the message.
    pub sender: Jid,
    /// The message ID.
    pub id: MessageId,
    /// The secret.
    pub secret: Vec<u8>,
}

/// Message secrets (for polls, reactions and edits).
#[async_trait]
pub trait MsgSecretStore: Send + Sync {
    /// Stores many secrets.
    async fn put_message_secrets(&self, inserts: &[MessageSecretInsert]) -> Result<(), StoreError>;
    /// Stores one secret.
    async fn put_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
        secret: Vec<u8>,
    ) -> Result<(), StoreError>;
    /// A message's secret and the sender it was stored under.
    async fn get_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
    ) -> Result<Option<(Vec<u8>, Jid)>, StoreError>;
}

/// A privacy token from or for a user.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivacyToken {
    /// The user.
    pub user: Jid,
    /// The token.
    pub token: Vec<u8>,
    /// When the token was received.
    pub timestamp: DateTime<Utc>,
    /// When the token was sent.
    pub sender_timestamp: Option<DateTime<Utc>>,
}

/// Privacy tokens.
#[async_trait]
pub trait PrivacyTokenStore: Send + Sync {
    /// Stores tokens.
    async fn put_privacy_tokens(&self, tokens: &[PrivacyToken]) -> Result<(), StoreError>;
    /// One user's token.
    async fn get_privacy_token(&self, user: &Jid) -> Result<Option<PrivacyToken>, StoreError>;
    /// Deletes tokens older than the cutoff; returns how many.
    async fn delete_expired_privacy_tokens(&self, cutoff: DateTime<Utc>)
    -> Result<u64, StoreError>;
}

/// The NCT salt.
#[async_trait]
pub trait NctSaltStore: Send + Sync {
    /// Stores the salt.
    async fn put_nct_salt(&self, salt: Vec<u8>) -> Result<(), StoreError>;
    /// The salt.
    async fn get_nct_salt(&self) -> Result<Option<Vec<u8>>, StoreError>;
    /// Deletes the salt.
    async fn delete_nct_salt(&self) -> Result<(), StoreError>;
}

/// A decrypted incoming event, buffered so a redelivery isn't decrypted twice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BufferedEvent {
    /// The decrypted plaintext; empty once cleared.
    pub plaintext: Vec<u8>,
    /// When it was buffered.
    pub insert_time: DateTime<Utc>,
    /// The server timestamp of the event.
    pub server_time: DateTime<Utc>,
}

/// A transaction body for [`EventBuffer::do_decryption_txn`].
pub type DecryptionTransaction<'body> =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), StoreError>> + Send + 'body>>;

/// Buffered incoming and outgoing events.
#[async_trait]
pub trait EventBuffer: Send + Sync {
    /// A buffered incoming event by ciphertext hash.
    async fn get_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<Option<BufferedEvent>, StoreError>;
    /// Buffers a decrypted incoming event.
    async fn put_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
        plaintext: Vec<u8>,
        server_timestamp: DateTime<Utc>,
    ) -> Result<(), StoreError>;
    /// Runs the decryption of an event in one transaction.
    ///
    /// Go passes the transaction to the body through its context; there is no
    /// equivalent yet, so implementations can only run the body. Revisit when
    /// porting message decryption.
    async fn do_decryption_txn(&self, body: DecryptionTransaction<'_>) -> Result<(), StoreError>;
    /// Clears a buffered event's plaintext once it is handled.
    async fn clear_buffered_event_plaintext(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<(), StoreError>;
    /// Deletes old buffered hashes.
    async fn delete_old_buffered_hashes(&self) -> Result<(), StoreError>;
    /// A sent event's format and plaintext, by either chat JID.
    async fn get_outgoing_event(
        &self,
        chat_jid: &Jid,
        alt_chat_jid: &Jid,
        id: &MessageId,
    ) -> Result<Option<(String, Vec<u8>)>, StoreError>;
    /// Remembers a sent event for retries.
    async fn add_outgoing_event(
        &self,
        chat_jid: &Jid,
        id: &MessageId,
        format: &str,
        plaintext: Vec<u8>,
    ) -> Result<(), StoreError>;
    /// Deletes old sent events.
    async fn delete_old_outgoing_events(&self) -> Result<(), StoreError>;
}

/// A LID and the phone number JID it belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LidMapping {
    /// The LID.
    pub lid: Jid,
    /// The phone number JID.
    pub pn: Jid,
}

/// LID ↔ phone number mappings, shared by all devices.
#[async_trait]
pub trait LidStore: Send + Sync {
    /// Stores many mappings.
    async fn put_many_lid_mappings(&self, mappings: &[LidMapping]) -> Result<(), StoreError>;
    /// Stores one mapping.
    async fn put_lid_mapping(&self, lid: &Jid, jid: &Jid) -> Result<(), StoreError>;
    /// The phone number JID of a LID.
    async fn get_pn_for_lid(&self, lid: &Jid) -> Result<Option<Jid>, StoreError>;
    /// The LID of a phone number JID.
    async fn get_lid_for_pn(&self, pn: &Jid) -> Result<Option<Jid>, StoreError>;
    /// The LIDs of many phone number JIDs that have one.
    async fn get_many_lids_for_pns(&self, pns: &[Jid]) -> Result<HashMap<Jid, Jid>, StoreError>;
}

/// Every store that belongs to one device.
pub trait AllSessionSpecificStores:
    IdentityStore
    + SessionStore
    + PreKeyStore
    + SenderKeyStore
    + AppStateSyncKeyStore
    + AppStateStore
    + ContactStore
    + ChatSettingsStore
    + MsgSecretStore
    + PrivacyTokenStore
    + NctSaltStore
    + EventBuffer
{
}

impl<Store> AllSessionSpecificStores for Store where
    Store: IdentityStore
        + SessionStore
        + PreKeyStore
        + SenderKeyStore
        + AppStateSyncKeyStore
        + AppStateStore
        + ContactStore
        + ChatSettingsStore
        + MsgSecretStore
        + PrivacyTokenStore
        + NctSaltStore
        + EventBuffer
{
}

/// Every store shared by all devices.
pub trait AllGlobalStores: LidStore {}

impl<Store: LidStore> AllGlobalStores for Store {}

/// Every store.
pub trait AllStores: AllSessionSpecificStores + AllGlobalStores {}

impl<Store: AllSessionSpecificStores + AllGlobalStores> AllStores for Store {}

/// One linked device: its keys, identity, and stores.
pub struct Device {
    /// The static key of the noise handshake.
    pub noise_key: KeyPair,
    /// The Signal identity key.
    pub identity_key: KeyPair,
    /// The signed prekey.
    pub signed_pre_key: PreKey,
    /// The Signal registration ID.
    pub registration_id: u32,
    /// The secret for verifying the account signature while pairing.
    pub adv_secret_key: Vec<u8>,

    /// The device's JID, once paired.
    pub id: Option<Jid>,
    /// The device's LID, once known.
    pub lid: Jid,

    /// The account's signature of this device.
    pub account: Option<AdvSignedDeviceIdentity>,
    /// The platform of the primary device.
    pub platform: String,
    /// The business name of the account.
    pub business_name: String,
    /// The push name of the account.
    pub push_name: String,

    /// When the account migrated to LIDs.
    pub lid_migration_timestamp: i64,
    /// The companion meta nonce.
    pub companion_meta_nonce: String,

    /// The Facebook UUID (Messenger/Instagram only).
    pub facebook_uuid: Option<Uuid>,

    /// Whether the device was loaded from or saved to the container.
    pub initialized: bool,
    /// Whether the device was deleted.
    pub deleted: bool,
    /// Peer identity keys.
    pub identities: Arc<dyn IdentityStore>,
    /// Signal sessions.
    pub sessions: Arc<dyn SessionStore>,
    /// One-time prekeys.
    pub pre_keys: Arc<dyn PreKeyStore>,
    /// Group sender keys.
    pub sender_keys: Arc<dyn SenderKeyStore>,
    /// App state sync keys.
    pub app_state_keys: Arc<dyn AppStateSyncKeyStore>,
    /// App state versions.
    pub app_state: Arc<dyn AppStateStore>,
    /// Contacts.
    pub contacts: Arc<dyn ContactStore>,
    /// Chat settings.
    pub chat_settings: Arc<dyn ChatSettingsStore>,
    /// Message secrets.
    pub msg_secrets: Arc<dyn MsgSecretStore>,
    /// Privacy tokens.
    pub privacy_tokens: Arc<dyn PrivacyTokenStore>,
    /// The NCT salt.
    pub nct_salt: Arc<dyn NctSaltStore>,
    /// Buffered events.
    pub event_buffer: Arc<dyn EventBuffer>,
    /// LID mappings.
    pub lids: Arc<dyn LidStore>,
    /// Where the device itself is saved.
    pub container: Arc<dyn DeviceContainer>,
}

impl Device {
    /// The device's JID, or the empty JID before pairing.
    pub fn get_jid(&self) -> Jid {
        self.id.clone().unwrap_or_default()
    }

    /// The device's LID, or the empty JID when unknown.
    pub fn get_lid(&self) -> Jid {
        self.lid.clone()
    }

    /// Saves the device's own data to its container.
    pub async fn save(&self) -> Result<(), StoreError> {
        if self.deleted {
            return Err(StoreError::DeviceDeleted);
        }
        self.container.put_device(self).await
    }

    /// Deletes the device from its container and makes every store fail.
    pub async fn delete(&mut self) -> Result<(), StoreError> {
        if self.deleted {
            return Ok(());
        }
        self.container.delete_device(self).await?;
        self.id = None;
        self.lid = Jid::default();
        self.deleted = true;
        self.set_all_stores(Arc::new(NoopStore {
            error: NoopError::DeviceDeleted,
        }));
        Ok(())
    }

    /// Uses one store for every per-device store.
    pub fn set_all_stores(&mut self, store: Arc<dyn AllSessionSpecificStores>) {
        self.identities = store.clone();
        self.sessions = store.clone();
        self.pre_keys = store.clone();
        self.sender_keys = store.clone();
        self.app_state_keys = store.clone();
        self.app_state = store.clone();
        self.contacts = store.clone();
        self.chat_settings = store.clone();
        self.msg_secrets = store.clone();
        self.privacy_tokens = store.clone();
        self.nct_salt = store.clone();
        self.event_buffer = store;
    }

    /// The other identity of a user: the LID of a phone number JID or the
    /// phone number JID of a LID. `None` for other servers or no mapping;
    /// Go returns the empty JID.
    pub async fn get_alt_jid(&self, jid: &Jid) -> Result<Option<Jid>, StoreError> {
        match jid.server.as_str() {
            DEFAULT_USER_SERVER => self.lids.get_lid_for_pn(jid).await,
            HIDDEN_USER_SERVER => self.lids.get_pn_for_lid(jid).await,
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod test;
