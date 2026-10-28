// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! An in-memory implementation of every store, for tests. Not a port of a Go
//! file: it follows the behaviour of whatsmeow's `store/sqlstore` where tests
//! depend on it (trust on first use, prekey numbering and upload marking,
//! address prefix deletes, LID migration), and keeps everything forever.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::store::*;
use crate::signal::CurveSignatures;
use crate::types::{
    ContactInfo, DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, LocalChatSettings, MessageId,
};
use crate::util::keys::{PreKey, new_key_pair, new_pre_key};

#[derive(Default)]
struct State {
    identities: HashMap<String, [u8; 32]>,
    sessions: HashMap<String, Vec<u8>>,
    /// Prekeys by ID, with whether they were uploaded.
    pre_keys: BTreeMap<u32, (PreKey, bool)>,
    /// Sender keys by (group, sender address).
    sender_keys: HashMap<(String, String), Vec<u8>>,
    app_state_sync_keys: HashMap<Vec<u8>, AppStateSyncKey>,
    app_state_versions: HashMap<String, (u64, [u8; 128])>,
    /// Mutation MACs per collection, with the version they were stored at.
    mutation_macs: HashMap<String, Vec<(u64, AppStateMutationMac)>>,
    contacts: HashMap<Jid, ContactInfo>,
    chat_settings: HashMap<Jid, LocalChatSettings>,
    wasa_root_secret_ids: HashMap<Jid, MessageId>,
    message_secrets: HashMap<(Jid, Jid, MessageId), Vec<u8>>,
    privacy_tokens: HashMap<Jid, PrivacyToken>,
    nct_salt: Option<Vec<u8>>,
    buffered_events: HashMap<[u8; 32], BufferedEvent>,
    outgoing_events: HashMap<(Jid, MessageId), (String, Vec<u8>)>,
    /// LID user → phone number user.
    pn_by_lid: HashMap<String, String>,
    /// Phone number user → LID user.
    lid_by_pn: HashMap<String, String>,
    saved_devices: Vec<Jid>,
}

/// Every store, kept in memory.
#[derive(Default)]
pub struct MemoryStore {
    state: Mutex<State>,
}

impl MemoryStore {
    fn state(&self) -> MutexGuard<'_, State> {
        // Every mutation below is a single map operation, so a panic can't
        // leave the state half-written.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The JIDs of the devices saved to this store as a container.
    pub fn saved_devices(&self) -> Vec<Jid> {
        self.state().saved_devices.clone()
    }

    /// A new unpaired device whose stores are all this store, like
    /// `sqlstore.Container.NewDevice`.
    pub fn new_device(self: &Arc<Self>, signatures: &impl CurveSignatures) -> Device {
        let identity_key = new_key_pair();
        let signed_pre_key = identity_key.create_signed_pre_key(signatures, 1);
        Device {
            noise_key: new_key_pair(),
            identity_key,
            signed_pre_key,
            registration_id: rand::random(),
            adv_secret_key: rand::random::<[u8; 32]>().to_vec(),
            id: None,
            lid: Jid::default(),
            account: None,
            platform: String::new(),
            business_name: String::new(),
            push_name: String::new(),
            lid_migration_timestamp: 0,
            companion_meta_nonce: String::new(),
            facebook_uuid: None,
            initialized: false,
            deleted: false,
            identities: self.clone(),
            sessions: self.clone(),
            pre_keys: self.clone(),
            sender_keys: self.clone(),
            app_state_keys: self.clone(),
            app_state: self.clone(),
            contacts: self.clone(),
            chat_settings: self.clone(),
            msg_secrets: self.clone(),
            privacy_tokens: self.clone(),
            nct_salt: self.clone(),
            event_buffer: self.clone(),
            lids: self.clone(),
            container: self.clone(),
        }
    }
}

fn address_prefix(phone: &str) -> String {
    format!("{phone}:")
}

fn next_pre_key_id(state: &State) -> u32 {
    state.pre_keys.last_key_value().map_or(1, |(id, _)| id + 1)
}

#[async_trait]
impl IdentityStore for MemoryStore {
    async fn put_identity(&self, address: &str, key: [u8; 32]) -> Result<(), StoreError> {
        self.state().identities.insert(address.to_owned(), key);
        Ok(())
    }

    async fn delete_all_identities(&self, phone: &str) -> Result<(), StoreError> {
        let prefix = address_prefix(phone);
        self.state()
            .identities
            .retain(|address, _| !address.starts_with(&prefix));
        Ok(())
    }

    async fn delete_identity(&self, address: &str) -> Result<(), StoreError> {
        self.state().identities.remove(address);
        Ok(())
    }

    async fn is_trusted_identity(&self, address: &str, key: [u8; 32]) -> Result<bool, StoreError> {
        // Trust if not known; it is saved automatically later.
        Ok(self
            .state()
            .identities
            .get(address)
            .is_none_or(|existing| *existing == key))
    }
}

#[async_trait]
impl SessionStore for MemoryStore {
    async fn get_session(&self, address: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self.state().sessions.get(address).cloned())
    }

    async fn has_session(&self, address: &str) -> Result<bool, StoreError> {
        Ok(self.state().sessions.contains_key(address))
    }

    async fn get_many_sessions(
        &self,
        addresses: &[String],
    ) -> Result<HashMap<String, Option<Vec<u8>>>, StoreError> {
        let state = self.state();
        Ok(addresses
            .iter()
            .map(|address| (address.clone(), state.sessions.get(address).cloned()))
            .collect())
    }

    async fn put_session(&self, address: &str, session: Vec<u8>) -> Result<(), StoreError> {
        self.state().sessions.insert(address.to_owned(), session);
        Ok(())
    }

    async fn put_many_sessions(
        &self,
        sessions: HashMap<String, Vec<u8>>,
    ) -> Result<(), StoreError> {
        self.state().sessions.extend(sessions);
        Ok(())
    }

    async fn delete_all_sessions(&self, phone: &str) -> Result<(), StoreError> {
        let prefix = address_prefix(phone);
        self.state()
            .sessions
            .retain(|address, _| !address.starts_with(&prefix));
        Ok(())
    }

    async fn delete_session(&self, address: &str) -> Result<(), StoreError> {
        self.state().sessions.remove(address);
        Ok(())
    }

    async fn migrate_pn_to_lid(&self, pn: &Jid, lid: &Jid) -> Result<(), StoreError> {
        let pn_prefix = address_prefix(&pn.signal_address_user());
        let lid_prefix = address_prefix(&lid.signal_address_user());
        let migrate = |address: &str| {
            address
                .strip_prefix(&pn_prefix)
                .map(|device| format!("{lid_prefix}{device}"))
        };
        let mut state = self.state();
        let moved: Vec<(String, Vec<u8>)> = state
            .sessions
            .iter()
            .filter_map(|(address, session)| Some((migrate(address)?, session.clone())))
            .collect();
        state
            .sessions
            .retain(|address, _| !address.starts_with(&pn_prefix));
        state.sessions.extend(moved);
        let moved: Vec<(String, [u8; 32])> = state
            .identities
            .iter()
            .filter_map(|(address, key)| Some((migrate(address)?, *key)))
            .collect();
        state
            .identities
            .retain(|address, _| !address.starts_with(&pn_prefix));
        state.identities.extend(moved);
        let moved: Vec<((String, String), Vec<u8>)> = state
            .sender_keys
            .iter()
            .filter_map(|((group, sender), key)| {
                Some(((group.clone(), migrate(sender)?), key.clone()))
            })
            .collect();
        state
            .sender_keys
            .retain(|(_, sender), _| !sender.starts_with(&pn_prefix));
        state.sender_keys.extend(moved);
        Ok(())
    }
}

#[async_trait]
impl PreKeyStore for MemoryStore {
    async fn get_or_gen_pre_keys(&self, count: u32) -> Result<Vec<PreKey>, StoreError> {
        let mut state = self.state();
        let mut keys: Vec<PreKey> = state
            .pre_keys
            .values()
            .filter(|(_, uploaded)| !uploaded)
            .map(|(key, _)| key.clone())
            .take(usize::try_from(count).unwrap_or(usize::MAX))
            .collect();
        let mut next_id = next_pre_key_id(&state);
        while keys.len() < usize::try_from(count).unwrap_or(usize::MAX) {
            let key = new_pre_key(next_id);
            state.pre_keys.insert(next_id, (key.clone(), false));
            keys.push(key);
            next_id += 1;
        }
        Ok(keys)
    }

    async fn gen_one_pre_key(&self) -> Result<PreKey, StoreError> {
        let mut state = self.state();
        let key = new_pre_key(next_pre_key_id(&state));
        state.pre_keys.insert(key.key_id, (key.clone(), true));
        Ok(key)
    }

    async fn get_pre_key(&self, id: u32) -> Result<Option<PreKey>, StoreError> {
        Ok(self.state().pre_keys.get(&id).map(|(key, _)| key.clone()))
    }

    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError> {
        self.state().pre_keys.remove(&id);
        Ok(())
    }

    async fn mark_pre_keys_as_uploaded(&self, up_to_id: u32) -> Result<(), StoreError> {
        for (_, (_, uploaded)) in self.state().pre_keys.range_mut(..=up_to_id) {
            *uploaded = true;
        }
        Ok(())
    }

    async fn uploaded_pre_key_count(&self) -> Result<usize, StoreError> {
        Ok(self
            .state()
            .pre_keys
            .values()
            .filter(|(_, uploaded)| *uploaded)
            .count())
    }
}

#[async_trait]
impl SenderKeyStore for MemoryStore {
    async fn put_sender_key(
        &self,
        group: &str,
        user: &str,
        session: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.state()
            .sender_keys
            .insert((group.to_owned(), user.to_owned()), session);
        Ok(())
    }

    async fn get_sender_key(&self, group: &str, user: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .state()
            .sender_keys
            .get(&(group.to_owned(), user.to_owned()))
            .cloned())
    }
}

#[async_trait]
impl AppStateSyncKeyStore for MemoryStore {
    async fn put_app_state_sync_key(
        &self,
        id: &[u8],
        key: AppStateSyncKey,
    ) -> Result<(), StoreError> {
        self.state().app_state_sync_keys.insert(id.to_vec(), key);
        Ok(())
    }

    async fn get_app_state_sync_key(
        &self,
        id: &[u8],
    ) -> Result<Option<AppStateSyncKey>, StoreError> {
        Ok(self.state().app_state_sync_keys.get(id).cloned())
    }

    async fn get_latest_app_state_sync_key_id(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .state()
            .app_state_sync_keys
            .iter()
            .max_by_key(|(_, key)| key.timestamp)
            .map(|(id, _)| id.clone()))
    }

    async fn get_all_app_state_sync_keys(&self) -> Result<Vec<AppStateSyncKey>, StoreError> {
        let mut keys: Vec<AppStateSyncKey> =
            self.state().app_state_sync_keys.values().cloned().collect();
        keys.sort_by_key(|key| std::cmp::Reverse(key.timestamp));
        Ok(keys)
    }
}

#[async_trait]
impl AppStateStore for MemoryStore {
    async fn put_app_state_version(
        &self,
        name: &str,
        version: u64,
        hash: [u8; 128],
    ) -> Result<(), StoreError> {
        self.state()
            .app_state_versions
            .insert(name.to_owned(), (version, hash));
        Ok(())
    }

    async fn get_app_state_version(&self, name: &str) -> Result<(u64, [u8; 128]), StoreError> {
        Ok(self
            .state()
            .app_state_versions
            .get(name)
            .copied()
            .unwrap_or((0, [0; 128])))
    }

    async fn delete_app_state_version(&self, name: &str) -> Result<(), StoreError> {
        self.state().app_state_versions.remove(name);
        Ok(())
    }

    async fn put_app_state_mutation_macs(
        &self,
        name: &str,
        version: u64,
        mutations: &[AppStateMutationMac],
    ) -> Result<(), StoreError> {
        self.state()
            .mutation_macs
            .entry(name.to_owned())
            .or_default()
            .extend(mutations.iter().map(|mutation| (version, mutation.clone())));
        Ok(())
    }

    async fn delete_app_state_mutation_macs(
        &self,
        name: &str,
        index_macs: &[Vec<u8>],
    ) -> Result<(), StoreError> {
        if let Some(macs) = self.state().mutation_macs.get_mut(name) {
            macs.retain(|(_, mutation)| !index_macs.contains(&mutation.index_mac));
        }
        Ok(())
    }

    async fn get_app_state_mutation_mac(
        &self,
        name: &str,
        index_mac: &[u8],
    ) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self.state().mutation_macs.get(name).and_then(|macs| {
            macs.iter()
                .filter(|(_, mutation)| mutation.index_mac == index_mac)
                .max_by_key(|(version, _)| *version)
                .map(|(_, mutation)| mutation.value_mac.clone())
        }))
    }
}

#[async_trait]
impl ContactStore for MemoryStore {
    async fn put_push_name(
        &self,
        user: &Jid,
        push_name: &str,
    ) -> Result<(bool, String), StoreError> {
        let mut state = self.state();
        let contact = state.contacts.entry(user.clone()).or_default();
        if contact.push_name == push_name {
            return Ok((false, String::new()));
        }
        let previous = std::mem::replace(&mut contact.push_name, push_name.to_owned());
        Ok((true, previous))
    }

    async fn put_business_name(
        &self,
        user: &Jid,
        business_name: &str,
    ) -> Result<(bool, String), StoreError> {
        let mut state = self.state();
        let contact = state.contacts.entry(user.clone()).or_default();
        if contact.business_name == business_name {
            return Ok((false, String::new()));
        }
        let previous = std::mem::replace(&mut contact.business_name, business_name.to_owned());
        Ok((true, previous))
    }

    async fn put_contact_name(
        &self,
        user: &Jid,
        full_name: &str,
        first_name: &str,
    ) -> Result<(), StoreError> {
        let mut state = self.state();
        let contact = state.contacts.entry(user.clone()).or_default();
        contact.full_name = full_name.to_owned();
        contact.first_name = first_name.to_owned();
        Ok(())
    }

    async fn put_all_contact_names(&self, contacts: &[ContactEntry]) -> Result<(), StoreError> {
        let mut state = self.state();
        for entry in contacts {
            let contact = state.contacts.entry(entry.jid.clone()).or_default();
            contact.full_name = entry.full_name.clone();
            contact.first_name = entry.first_name.clone();
        }
        Ok(())
    }

    async fn put_many_redacted_phones(
        &self,
        entries: &[RedactedPhoneEntry],
    ) -> Result<(), StoreError> {
        let mut state = self.state();
        for entry in entries {
            state
                .contacts
                .entry(entry.jid.clone())
                .or_default()
                .redacted_phone = entry.redacted_phone.clone();
        }
        Ok(())
    }

    async fn get_contact(&self, user: &Jid) -> Result<Option<ContactInfo>, StoreError> {
        Ok(self.state().contacts.get(user).cloned())
    }

    async fn get_all_contacts(&self) -> Result<HashMap<Jid, ContactInfo>, StoreError> {
        Ok(self.state().contacts.clone())
    }
}

#[async_trait]
impl ChatSettingsStore for MemoryStore {
    async fn put_muted_until(
        &self,
        chat: &Jid,
        muted_until: Option<DateTime<Utc>>,
    ) -> Result<(), StoreError> {
        self.state()
            .chat_settings
            .entry(chat.clone())
            .or_default()
            .muted_until = muted_until;
        Ok(())
    }

    async fn put_pinned(&self, chat: &Jid, pinned: bool) -> Result<(), StoreError> {
        self.state()
            .chat_settings
            .entry(chat.clone())
            .or_default()
            .pinned = pinned;
        Ok(())
    }

    async fn put_archived(&self, chat: &Jid, archived: bool) -> Result<(), StoreError> {
        self.state()
            .chat_settings
            .entry(chat.clone())
            .or_default()
            .archived = archived;
        Ok(())
    }

    async fn put_wasa_root_secret_id(&self, chat: &Jid, id: &MessageId) -> Result<(), StoreError> {
        self.state()
            .wasa_root_secret_ids
            .insert(chat.clone(), id.clone());
        Ok(())
    }

    async fn get_wasa_root_secret_id(&self, chat: &Jid) -> Result<Option<MessageId>, StoreError> {
        Ok(self.state().wasa_root_secret_ids.get(chat).cloned())
    }

    async fn get_chat_settings(&self, chat: &Jid) -> Result<Option<LocalChatSettings>, StoreError> {
        Ok(self.state().chat_settings.get(chat).cloned())
    }
}

#[async_trait]
impl DeviceContainer for MemoryStore {
    async fn put_device(&self, store: &Device) -> Result<(), StoreError> {
        let jid = store.id.clone().ok_or(StoreError::InvalidArgument(
            "device JID must be known before accessing database".to_owned(),
        ))?;
        let mut state = self.state();
        if !state.saved_devices.contains(&jid) {
            state.saved_devices.push(jid);
        }
        Ok(())
    }

    async fn delete_device(&self, store: &Device) -> Result<(), StoreError> {
        if let Some(jid) = &store.id {
            self.state().saved_devices.retain(|saved| saved != jid);
        }
        Ok(())
    }
}

#[async_trait]
impl MsgSecretStore for MemoryStore {
    async fn put_message_secrets(&self, inserts: &[MessageSecretInsert]) -> Result<(), StoreError> {
        let mut state = self.state();
        for insert in inserts {
            state
                .message_secrets
                .entry((
                    insert.chat.to_non_ad(),
                    insert.sender.to_non_ad(),
                    insert.id.clone(),
                ))
                .or_insert_with(|| insert.secret.clone());
        }
        Ok(())
    }

    async fn put_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
        secret: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.state()
            .message_secrets
            .entry((chat.to_non_ad(), sender.to_non_ad(), id.clone()))
            .or_insert(secret);
        Ok(())
    }

    async fn get_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
    ) -> Result<Option<(Vec<u8>, Jid)>, StoreError> {
        let sender = sender.to_non_ad();
        Ok(self
            .state()
            .message_secrets
            .get(&(chat.to_non_ad(), sender.clone(), id.clone()))
            .map(|secret| (secret.clone(), sender)))
    }
}

#[async_trait]
impl PrivacyTokenStore for MemoryStore {
    async fn put_privacy_tokens(&self, tokens: &[PrivacyToken]) -> Result<(), StoreError> {
        let mut state = self.state();
        for token in tokens {
            match state.privacy_tokens.get_mut(&token.user) {
                Some(existing) if token.timestamp < existing.timestamp => {}
                Some(existing) => {
                    existing.token = token.token.clone();
                    existing.timestamp = token.timestamp;
                    existing.sender_timestamp =
                        token.sender_timestamp.or(existing.sender_timestamp);
                }
                None => {
                    state
                        .privacy_tokens
                        .insert(token.user.clone(), token.clone());
                }
            }
        }
        Ok(())
    }

    async fn get_privacy_token(&self, user: &Jid) -> Result<Option<PrivacyToken>, StoreError> {
        Ok(self.state().privacy_tokens.get(user).cloned())
    }

    async fn delete_expired_privacy_tokens(
        &self,
        cutoff: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        let mut state = self.state();
        let before = state.privacy_tokens.len();
        state
            .privacy_tokens
            .retain(|_, token| token.timestamp >= cutoff);
        Ok(u64::try_from(before - state.privacy_tokens.len()).unwrap_or(u64::MAX))
    }
}

#[async_trait]
impl NctSaltStore for MemoryStore {
    async fn put_nct_salt(&self, salt: Vec<u8>) -> Result<(), StoreError> {
        self.state().nct_salt = Some(salt);
        Ok(())
    }

    async fn get_nct_salt(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self.state().nct_salt.clone())
    }

    async fn delete_nct_salt(&self) -> Result<(), StoreError> {
        self.state().nct_salt = None;
        Ok(())
    }
}

#[async_trait]
impl EventBuffer for MemoryStore {
    async fn get_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<Option<BufferedEvent>, StoreError> {
        Ok(self.state().buffered_events.get(&ciphertext_hash).cloned())
    }

    async fn put_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
        plaintext: Vec<u8>,
        server_timestamp: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        self.state().buffered_events.insert(
            ciphertext_hash,
            BufferedEvent {
                plaintext,
                insert_time: Utc::now(),
                server_time: server_timestamp,
            },
        );
        Ok(())
    }

    async fn do_decryption_txn(&self, body: DecryptionTransaction<'_>) -> Result<(), StoreError> {
        body.await
    }

    async fn clear_buffered_event_plaintext(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<(), StoreError> {
        if let Some(event) = self.state().buffered_events.get_mut(&ciphertext_hash) {
            event.plaintext.clear();
        }
        Ok(())
    }

    async fn delete_old_buffered_hashes(&self) -> Result<(), StoreError> {
        Ok(())
    }

    async fn get_outgoing_event(
        &self,
        chat_jid: &Jid,
        alt_chat_jid: &Jid,
        id: &MessageId,
    ) -> Result<Option<(String, Vec<u8>)>, StoreError> {
        let state = self.state();
        Ok(state
            .outgoing_events
            .get(&(chat_jid.clone(), id.clone()))
            .or_else(|| {
                state
                    .outgoing_events
                    .get(&(alt_chat_jid.clone(), id.clone()))
            })
            .cloned())
    }

    async fn add_outgoing_event(
        &self,
        chat_jid: &Jid,
        id: &MessageId,
        format: &str,
        plaintext: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.state().outgoing_events.insert(
            (chat_jid.clone(), id.clone()),
            (format.to_owned(), plaintext),
        );
        Ok(())
    }

    async fn delete_old_outgoing_events(&self) -> Result<(), StoreError> {
        Ok(())
    }
}

#[async_trait]
impl LidStore for MemoryStore {
    async fn put_many_lid_mappings(&self, mappings: &[LidMapping]) -> Result<(), StoreError> {
        let mut state = self.state();
        for mapping in mappings {
            if mapping.lid.server != HIDDEN_USER_SERVER || mapping.pn.server != DEFAULT_USER_SERVER
            {
                continue;
            }
            put_mapping(&mut state, &mapping.lid, &mapping.pn);
        }
        Ok(())
    }

    async fn put_lid_mapping(&self, lid: &Jid, jid: &Jid) -> Result<(), StoreError> {
        if lid.server != HIDDEN_USER_SERVER || jid.server != DEFAULT_USER_SERVER {
            return Err(StoreError::InvalidArgument(format!(
                "invalid PutLIDMapping call {lid}/{jid}"
            )));
        }
        put_mapping(&mut self.state(), lid, jid);
        Ok(())
    }

    async fn get_pn_for_lid(&self, lid: &Jid) -> Result<Option<Jid>, StoreError> {
        if lid.server != HIDDEN_USER_SERVER {
            return Err(StoreError::InvalidArgument(format!(
                "invalid GetPNForLID call with non-LID JID {lid}"
            )));
        }
        Ok(self.state().pn_by_lid.get(&lid.user).map(|user| Jid {
            user: user.clone(),
            device: lid.device,
            server: DEFAULT_USER_SERVER.to_owned(),
            ..Jid::default()
        }))
    }

    async fn get_lid_for_pn(&self, pn: &Jid) -> Result<Option<Jid>, StoreError> {
        if pn.server != DEFAULT_USER_SERVER {
            return Err(StoreError::InvalidArgument(format!(
                "invalid GetLIDForPN call with non-PN JID {pn}"
            )));
        }
        Ok(self.state().lid_by_pn.get(&pn.user).map(|user| Jid {
            user: user.clone(),
            device: pn.device,
            server: HIDDEN_USER_SERVER.to_owned(),
            ..Jid::default()
        }))
    }

    async fn get_many_lids_for_pns(&self, pns: &[Jid]) -> Result<HashMap<Jid, Jid>, StoreError> {
        let state = self.state();
        Ok(pns
            .iter()
            .filter(|pn| pn.server == DEFAULT_USER_SERVER)
            .filter_map(|pn| {
                let lid_user = state.lid_by_pn.get(&pn.user)?;
                Some((
                    pn.clone(),
                    Jid {
                        user: lid_user.clone(),
                        device: pn.device,
                        server: HIDDEN_USER_SERVER.to_owned(),
                        ..Jid::default()
                    },
                ))
            })
            .collect())
    }
}

/// Replaces any older mapping of either side.
fn put_mapping(state: &mut State, lid: &Jid, pn: &Jid) {
    if let Some(old_lid) = state.lid_by_pn.insert(pn.user.clone(), lid.user.clone()) {
        state.pn_by_lid.remove(&old_lid);
    }
    if let Some(old_pn) = state.pn_by_lid.insert(lid.user.clone(), pn.user.clone())
        && old_pn != pn.user
    {
        state.lid_by_pn.remove(&old_pn);
    }
}

#[cfg(test)]
mod test;
