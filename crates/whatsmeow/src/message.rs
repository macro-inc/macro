// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow message.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Deviations:
// - libsignal calls go through `crate::signal::SignalProtocol` with the
//   device as its store; Go's `sessionlessSignalStore` is
//   [`SessionlessSignalStore`].
// - Go recovers from panics in `decryptMessages` and acks; Rust handlers
//   don't panic (a panicking task is logged by the runtime).
// - Not ported: bot (`msmsg`) and Armadillo (`v="3"`) messages, newsletter
//   plaintext messages, `SendHistorySyncServerErrorReceipt` (media retry
//   isn't ported). They are acked and logged.

//! Receiving messages: parsing, decrypting and dispatching them, and the
//! protocol messages (history sync, sender keys, app state keys) inside.

use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use prost::Message as _;
use sha2::{Digest, Sha256};

use crate::binary::{Node, NodeContent};
use crate::client::Client;
use crate::download::MediaType;
use crate::errors::ClientError;
use crate::proto::wa_e2e::{self, PeerDataOperationRequestType};
use crate::proto::wa_history_sync::{self, history_sync::HistorySyncType};
use crate::proto::wa_lid_migration_sync_payload::LidMigrationMappingSyncPayload;
use crate::proto::wa_web::WebMessageInfo;
use crate::receipt::{NACK_INVALID_PROTOBUF, NACK_PARSING_ERROR, NACK_UNRECOGNIZED_STANZA};
use crate::signal::{SenderKeyName, SignalAddress, SignalError, SignalProtocolStore};
use crate::store::{LidMapping, MessageSecretInsert, PrivacyToken, StoreError};
use crate::types::events::{
    DecryptFailMode, Event, HistorySync, IdentityChange, Message, UnavailableType,
    UndecryptableMessage,
};
use crate::types::{
    AddressingMode, BROADCAST_SERVER, BotEditType, BroadcastRecipient, DEFAULT_USER_SERVER,
    EditAttribute, GROUP_SERVER, HIDDEN_USER_SERVER, HOSTED_LID_SERVER, HOSTED_SERVER, Jid,
    LEGACY_USER_SERVER, MessageInfo, MessageSource, MsgBotInfo, MsgMetaInfo, NEWSLETTER_SERVER,
    ReceiptType, parse_jid,
};
use crate::user::parse_verified_name_content;

/// Why decrypting one `<enc>` failed.
#[derive(Debug, thiserror::Error)]
pub(crate) enum DecryptError {
    /// The decrypted event buffer already handled this ciphertext
    /// (`ErrEventAlreadyProcessed`).
    #[error("event was already processed at {0}")]
    AlreadyProcessed(DateTime<Utc>),
    /// libsignal failed.
    #[error("{context}: {source}")]
    Signal {
        /// What was being decrypted.
        context: &'static str,
        /// The failure.
        source: SignalError,
    },
    /// The store failed.
    #[error("{context}: {source}")]
    Store {
        /// What failed.
        context: &'static str,
        /// The failure.
        source: StoreError,
    },
    /// Anything else.
    #[error("{0}")]
    Other(String),
}

impl DecryptError {
    fn signal(&self) -> Option<&SignalError> {
        match self {
            DecryptError::Signal { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// The device's Signal store, but sessions from stateless prekey messages
/// aren't stored (`sessionlessSignalStore`).
struct SessionlessSignalStore<'store>(&'store dyn SignalProtocolStore);

#[async_trait]
impl SignalProtocolStore for SessionlessSignalStore<'_> {
    fn get_identity_key_pair(&self) -> ([u8; 32], [u8; 32]) {
        self.0.get_identity_key_pair()
    }
    fn get_local_registration_id(&self) -> u32 {
        self.0.get_local_registration_id()
    }
    async fn save_identity(
        &self,
        address: &SignalAddress,
        key: [u8; 32],
    ) -> Result<(), StoreError> {
        self.0.save_identity(address, key).await
    }
    async fn is_trusted_identity(
        &self,
        address: &SignalAddress,
        key: [u8; 32],
    ) -> Result<bool, StoreError> {
        self.0.is_trusted_identity(address, key).await
    }
    async fn load_pre_key(&self, id: u32) -> Result<Option<([u8; 32], [u8; 32])>, StoreError> {
        self.0.load_pre_key(id).await
    }
    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError> {
        self.0.remove_pre_key(id).await
    }
    async fn load_session(&self, address: &SignalAddress) -> Result<Option<Vec<u8>>, StoreError> {
        self.0.load_session(address).await
    }
    async fn store_session(&self, _: &SignalAddress, _: Vec<u8>) -> Result<(), StoreError> {
        Ok(())
    }
    async fn contains_session(&self, address: &SignalAddress) -> Result<bool, StoreError> {
        self.0.contains_session(address).await
    }
    fn load_signed_pre_key(&self, id: u32) -> Option<([u8; 32], [u8; 32], [u8; 64])> {
        self.0.load_signed_pre_key(id)
    }
    async fn store_sender_key(
        &self,
        name: &SenderKeyName,
        record: Vec<u8>,
    ) -> Result<(), StoreError> {
        self.0.store_sender_key(name, record).await
    }
    async fn load_sender_key(&self, name: &SenderKeyName) -> Result<Option<Vec<u8>>, StoreError> {
        self.0.load_sender_key(name).await
    }
}

fn bytes_of(node: &Node) -> Option<&[u8]> {
    match &node.content {
        Some(NodeContent::Bytes(bytes)) => Some(bytes),
        _ => None,
    }
}

impl Client {
    pub(crate) async fn handle_encrypted_message(self: &Arc<Self>, node: &Node) {
        let mut info = match self.parse_message_info(node).await {
            Ok(info) => info,
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse message");
                self.send_ack(node, NACK_PARSING_ERROR).await;
                return;
            }
        };
        if !info.sender_alt.is_empty() {
            self.store_lid_pn_mapping(&info.sender_alt, &info.sender)
                .await;
        } else if !info.recipient_alt.is_empty() {
            self.store_lid_pn_mapping(&info.recipient_alt, &info.chat)
                .await;
        }
        if let Some(name) = info
            .verified_name
            .as_ref()
            .and_then(|verified| verified.details.as_ref())
            .and_then(|details| details.verified_name.clone())
            .filter(|name| !name.is_empty())
        {
            let client = Arc::clone(self);
            let info = info.clone();
            self.spawn(async move {
                client
                    .update_business_name(&info.sender, &info.sender_alt, Some(&info), &name)
                    .await;
            });
        }
        if !info.push_name.is_empty() && info.push_name != "-" {
            let client = Arc::clone(self);
            let info = info.clone();
            self.spawn(async move {
                client
                    .update_push_name(&info.sender, &info.sender_alt, &info, &info.push_name)
                    .await;
            });
        }
        if info.sender.server == NEWSLETTER_SERVER {
            tracing::debug!("newsletters aren't ported, acking newsletter message");
            self.send_ack(node, 0).await;
        } else {
            self.decrypt_messages(&mut info, node).await;
        }
    }

    pub(crate) async fn handle_unencrypted_message(self: &Arc<Self>, node: &Node) {
        match self.parse_message_info(node).await {
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse message");
                self.send_ack(node, NACK_PARSING_ERROR).await;
            }
            // Newsletter statuses aren't ported; everything else is acked
            // as Go does.
            Ok(_) => self.send_ack(node, 0).await,
        }
    }

    /// Who sent a message or receipt and in which chat.
    pub(crate) async fn parse_message_source(
        &self,
        node: &Node,
        require_participant: bool,
    ) -> Result<MessageSource, ClientError> {
        let client_id = self.get_own_id().await;
        let client_lid = self.get_own_lid().await;
        if client_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        let mut source = MessageSource::default();
        let mut attrs = node.attr_getter();
        let mut from = attrs.jid("from");
        source.addressing_mode = AddressingMode::from(attrs.optional_string("addressing_mode"));
        if from.server == GROUP_SERVER || from.server == BROADCAST_SERVER {
            source.is_group = true;
            source.chat = from.clone();
            source.sender = if require_participant {
                attrs.jid("participant")
            } else {
                attrs.optional_jid_or_empty("participant")
            };
            source.sender_alt = attrs.optional_jid_or_empty("participant_pn");
            if source.sender_alt.is_empty() && source.addressing_mode != AddressingMode::Lid {
                source.sender_alt = attrs.optional_jid_or_empty("participant_lid");
            }
            if source.sender.user == client_id.user || source.sender.user == client_lid.user {
                source.is_from_me = true;
            }
            if from.server == BROADCAST_SERVER {
                source.broadcast_list_owner = attrs.optional_jid_or_empty("recipient");
                if let Some(participants) = node.get_optional_child_by_tag(&["participants"])
                    && source.is_from_me
                {
                    for child in participants.get_children() {
                        if child.tag != "to" {
                            continue;
                        }
                        let mut child_attrs = child.attr_getter();
                        let main_jid = child_attrs.jid("jid");
                        let recipient = if main_jid.server == HIDDEN_USER_SERVER {
                            BroadcastRecipient {
                                lid: main_jid,
                                pn: child_attrs.optional_jid_or_empty("peer_recipient_pn"),
                            }
                        } else {
                            BroadcastRecipient {
                                lid: child_attrs.optional_jid_or_empty("peer_recipient_lid"),
                                pn: main_jid,
                            }
                        };
                        source.broadcast_recipients.push(recipient);
                    }
                }
            }
        } else if from.server == NEWSLETTER_SERVER {
            source.chat = from.clone();
            source.sender = from;
        } else if from.user == client_id.user || from.user == client_lid.user {
            if from.server == HOSTED_SERVER {
                from.server = DEFAULT_USER_SERVER.to_owned();
            } else if from.server == HOSTED_LID_SERVER {
                from.server = HIDDEN_USER_SERVER.to_owned();
            }
            source.is_from_me = true;
            source.sender = from.clone();
            source.chat = attrs
                .optional_jid("recipient")
                .unwrap_or_else(|| from.to_non_ad());
            source.recipient_alt = if source.chat.server == HIDDEN_USER_SERVER
                || source.chat.server == HOSTED_LID_SERVER
            {
                attrs.optional_jid_or_empty("peer_recipient_pn")
            } else {
                attrs.optional_jid_or_empty("peer_recipient_lid")
            };
        } else if from.is_bot() {
            source.sender = from.clone();
            let meta = node.get_child_by_tag(&["meta"]);
            let mut meta_attrs = meta.attr_getter();
            source.chat = match meta_attrs.optional_jid("target_chat_jid") {
                Some(target_chat) => target_chat.to_non_ad(),
                None => from,
            };
            meta_attrs.error()?;
        } else {
            if from.server == HOSTED_SERVER {
                from.server = DEFAULT_USER_SERVER.to_owned();
            } else if from.server == HOSTED_LID_SERVER {
                from.server = HIDDEN_USER_SERVER.to_owned();
            }
            source.chat = from.to_non_ad();
            source.sender = from;
            source.sender_alt = if source.sender.server == HIDDEN_USER_SERVER
                || source.chat.server == HOSTED_LID_SERVER
            {
                attrs.optional_jid_or_empty("sender_pn")
            } else {
                attrs.optional_jid_or_empty("sender_lid")
            };
        }
        if !source.sender_alt.is_empty() && source.sender_alt.device == 0 {
            source.sender_alt.device = source.sender.device;
        }
        attrs.error()?;
        Ok(source)
    }

    /// The parsed `<message>` attributes and metadata children.
    pub(crate) async fn parse_message_info(&self, node: &Node) -> Result<MessageInfo, ClientError> {
        let mut info = MessageInfo {
            source: self.parse_message_source(node, true).await?,
            ..MessageInfo::default()
        };
        let mut attrs = node.attr_getter();
        info.id = attrs.string("id");
        info.server_id = attrs.optional_int("server_id");
        info.timestamp = attrs.unix_time("t");
        info.push_name = attrs.optional_string("notify");
        info.category = attrs.optional_string("category");
        info.r#type = attrs.optional_string("type");
        info.edit = EditAttribute::from(attrs.optional_string("edit"));
        attrs.error()?;

        for child in node.get_children() {
            match child.tag.as_str() {
                "multicast" => info.multicast = true,
                "verified_name" => match parse_verified_name_content(child) {
                    Ok(verified_name) => info.verified_name = verified_name,
                    Err(error) => {
                        tracing::warn!(error = %error, "failed to parse verified_name node")
                    }
                },
                "bot" => match parse_msg_bot_info(child) {
                    Ok(bot_info) => info.msg_bot_info = bot_info,
                    Err(error) => tracing::warn!(error = %error, "failed to parse <bot> node"),
                },
                "meta" => match parse_msg_meta_info(child) {
                    Ok(meta_info) => info.msg_meta_info = meta_info,
                    Err(error) => tracing::warn!(error = %error, "failed to parse <meta> node"),
                },
                "franking" | "trace" => {}
                _ => {
                    if let Some(media_type) = child.attr_getter().get_string("mediatype", false) {
                        info.media_type = media_type;
                    }
                }
            }
        }
        Ok(info)
    }

    async fn migrate_session_store(&self, pn: &Jid, lid: &Jid) {
        let sessions = Arc::clone(&self.store.read().await.sessions);
        if let Err(error) = sessions.migrate_pn_to_lid(pn, lid).await {
            tracing::error!(error = %error, "failed to migrate signal store from phone number to LID");
        }
    }

    #[tracing::instrument(
        name = "whatsmeow.receive_message",
        skip_all,
        fields(message_id = %info.id, is_group = info.is_group, enc_count)
    )]
    async fn decrypt_messages(self: &Arc<Self>, info: &mut MessageInfo, node: &Node) {
        if let Some(unavailable) = node.get_optional_child_by_tag(&["unavailable"])
            && node.get_children_by_tag("enc").next().is_none()
        {
            let unavailable_type = UnavailableType::from(unavailable.attr_getter().string("type"));
            tracing::warn!(unavailable_type = %unavailable_type, "unavailable message");
            let client = Arc::clone(self);
            let ack_info = info.clone();
            let ack_node = node.clone();
            self.background_if_async_ack(async move {
                client.immediate_request_message_from_phone(&ack_info).await;
                client.send_ack(&ack_node, 0).await;
            })
            .await;
            self.dispatch_event(Event::UndecryptableMessage(UndecryptableMessage {
                info: info.clone(),
                is_unavailable: true,
                unavailable_type,
                decrypt_fail_mode: DecryptFailMode::Show,
            }))
            .await;
            return;
        }

        tracing::Span::current().record("enc_count", node.get_children_by_tag("enc").count());
        let mut contains_direct_msg = false;
        let mut sender_encryption_jid = info.sender.clone();
        if info.sender.server == DEFAULT_USER_SERVER && !info.sender.is_bot() {
            if info.sender_alt.server == HIDDEN_USER_SERVER {
                sender_encryption_jid = info.sender_alt.clone();
                self.migrate_session_store(&info.sender, &info.sender_alt)
                    .await;
            } else {
                let lids = Arc::clone(&self.store.read().await.lids);
                match lids.get_lid_for_pn(&info.sender).await {
                    Err(error) => tracing::error!(error = %error, "failed to get LID for sender"),
                    Ok(Some(lid)) if !lid.is_empty() => {
                        self.migrate_session_store(&info.sender, &lid).await;
                        sender_encryption_jid = lid.clone();
                        info.sender_alt = lid;
                    }
                    Ok(_) => tracing::warn!("no LID found for sender"),
                }
            }
        }
        let mut recognized_stanza = false;
        let mut protobuf_failed = false;
        for child in node.get_children() {
            if child.tag != "enc" {
                continue;
            }
            recognized_stanza = true;
            let mut attrs = child.attr_getter();
            let Some(enc_type) = attrs.get_string("type", false) else {
                continue;
            };
            let result = if enc_type == "pkmsg" || enc_type == "msg" {
                contains_direct_msg = true;
                self.decrypt_dm(
                    child,
                    &sender_encryption_jid,
                    enc_type == "pkmsg",
                    info.timestamp,
                )
                .await
            } else if info.is_group && enc_type == "skmsg" {
                self.decrypt_group_msg(child, &sender_encryption_jid, &info.chat, info.timestamp)
                    .await
            } else {
                tracing::warn!(enc_type = %enc_type, "unhandled encrypted message type");
                continue;
            };
            let (decrypted, ciphertext_hash) = match result {
                Err(DecryptError::AlreadyProcessed(_)) => {
                    tracing::debug!("ignoring already processed message");
                    continue;
                }
                Err(error) if matches!(error.signal(), Some(SignalError::OldCounter)) => {
                    tracing::warn!(error = %error, "ignoring message with old counter");
                    continue;
                }
                Err(error) => {
                    tracing::warn!(error = %error, enc_type = %enc_type, "error decrypting message");
                    let is_unavailable = enc_type == "skmsg"
                        && !contains_direct_msg
                        && matches!(error.signal(), Some(SignalError::NoSenderKeyForUser));
                    if self.config.synchronous_ack {
                        self.send_retry_receipt(node, info, is_unavailable).await;
                        self.send_ack(node, 0).await;
                    } else {
                        let client = Arc::clone(self);
                        let retry_node = node.clone();
                        let retry_info = info.clone();
                        self.spawn(async move {
                            client
                                .send_retry_receipt(&retry_node, &retry_info, is_unavailable)
                                .await;
                            client.send_ack(&retry_node, 0).await;
                        });
                    }
                    self.dispatch_event(Event::UndecryptableMessage(UndecryptableMessage {
                        info: info.clone(),
                        is_unavailable,
                        unavailable_type: UnavailableType::Unknown,
                        decrypt_fail_mode: DecryptFailMode::from(
                            attrs.optional_string("decrypt-fail"),
                        ),
                    }))
                    .await;
                    return;
                }
                Ok(decrypted) => decrypted,
            };
            let retry_count = attrs.optional_int("count");
            self.cancel_delayed_request_from_phone(&info.id);

            let handler_failed = match attrs.int("v") {
                2 => match wa_e2e::Message::decode(decrypted.as_slice()) {
                    Err(error) => {
                        tracing::warn!(error = %error, "error unmarshaling decrypted message");
                        protobuf_failed = true;
                        continue;
                    }
                    Ok(message) => {
                        protobuf_failed = false;
                        self.handle_decrypted_message(info, message, retry_count)
                            .await
                    }
                },
                3 => {
                    tracing::warn!("armadillo (v3) messages aren't ported");
                    false
                }
                version => {
                    tracing::warn!(version, "unknown version in decrypted message");
                    false
                }
            };
            if handler_failed {
                tracing::warn!("handler for message failed");
                return;
            }
            if let Some(ciphertext_hash) = ciphertext_hash {
                let event_buffer = Arc::clone(&self.store.read().await.event_buffer);
                if let Err(error) = event_buffer
                    .clear_buffered_event_plaintext(ciphertext_hash)
                    .await
                {
                    tracing::error!(error = %error, "failed to clear buffered event plaintext");
                }
                self.maybe_delete_old_buffered_hashes(event_buffer).await;
            }
        }
        let client = Arc::clone(self);
        let receipt_info = info.clone();
        let receipt_node = node.clone();
        self.background_if_async_ack(async move {
            if !recognized_stanza {
                client
                    .send_ack(&receipt_node, NACK_UNRECOGNIZED_STANZA)
                    .await;
            } else if protobuf_failed {
                client.send_ack(&receipt_node, NACK_INVALID_PROTOBUF).await;
            } else {
                client
                    .send_message_receipt(&receipt_info, &receipt_node)
                    .await;
            }
        })
        .await;
    }

    async fn maybe_delete_old_buffered_hashes(
        &self,
        event_buffer: Arc<dyn crate::store::EventBuffer>,
    ) {
        const CLEAR_INTERVAL: std::time::Duration = std::time::Duration::from_secs(12 * 60 * 60);
        let mut last_clear = crate::client::lock(&self.last_decrypted_buffer_clear);
        if last_clear.is_some_and(|last| last.elapsed() < CLEAR_INTERVAL) {
            return;
        }
        *last_clear = Some(tokio::time::Instant::now());
        drop(last_clear);
        self.spawn(async move {
            if let Err(error) = event_buffer.delete_old_buffered_hashes().await {
                tracing::error!(error = %error, "failed to delete old buffered hashes");
            }
        });
    }

    /// Deletes a peer's identity and session after an untrusted identity
    /// error, and emits an implicit [`Event::IdentityChange`].
    async fn clear_untrusted_identity(self: &Arc<Self>, target: &Jid) -> Result<(), ClientError> {
        let (identities, sessions) = {
            let store = self.store.read().await;
            (Arc::clone(&store.identities), Arc::clone(&store.sessions))
        };
        let address = target.signal_address().to_string();
        identities
            .delete_identity(&address)
            .await
            .map_err(|error| ClientError::from(error).wrap("failed to delete identity"))?;
        sessions
            .delete_session(&address)
            .await
            .map_err(|error| ClientError::from(error).wrap("failed to delete session"))?;
        self.spawn_dispatch(Event::IdentityChange(IdentityChange {
            jid: target.clone(),
            timestamp: Some(Utc::now()),
            implicit: true,
        }));
        Ok(())
    }

    /// Decrypts through the decrypted event buffer when it's enabled, so a
    /// redelivered ciphertext isn't decrypted twice. Returns the plaintext
    /// and the ciphertext hash (when buffering).
    async fn buffered_decrypt<'call, Decrypt>(
        &'call self,
        ciphertext: &[u8],
        server_timestamp: Option<DateTime<Utc>>,
        decrypt: Decrypt,
        extra_hash_data: &[&str],
    ) -> Result<(Vec<u8>, Option<[u8; 32]>), DecryptError>
    where
        Decrypt: Future<Output = Result<Vec<u8>, DecryptError>> + Send + 'call,
    {
        if !self.config.enable_decrypted_event_buffer {
            return decrypt.await.map(|plaintext| (plaintext, None));
        }
        let mut hasher = Sha256::new();
        hasher.update(ciphertext);
        for part in extra_hash_data {
            hasher.update([0]);
            hasher.update(part.as_bytes());
        }
        hasher.update([0, 0]);
        let ciphertext_hash: [u8; 32] = hasher.finalize().into();
        let event_buffer = Arc::clone(&self.store.read().await.event_buffer);
        let buffered = event_buffer
            .get_buffered_event(ciphertext_hash)
            .await
            .map_err(|source| DecryptError::Store {
                context: "failed to get buffered event",
                source,
            })?;
        if let Some(buffered) = buffered {
            if buffered.plaintext.is_empty() {
                tracing::debug!("returning event already processed error");
                return Err(DecryptError::AlreadyProcessed(buffered.insert_time));
            }
            tracing::debug!("returning previously decrypted plaintext");
            return Ok((buffered.plaintext, Some(ciphertext_hash)));
        }
        let plaintext = std::sync::Mutex::new(None);
        let decrypt_error = std::sync::Mutex::new(None);
        let transaction_event_buffer = Arc::clone(&event_buffer);
        let body = async {
            match decrypt.await {
                Ok(decrypted) => {
                    transaction_event_buffer
                        .put_buffered_event(
                            ciphertext_hash,
                            decrypted.clone(),
                            server_timestamp.unwrap_or_default(),
                        )
                        .await?;
                    *crate::client::lock(&plaintext) = Some(decrypted);
                    Ok(())
                }
                Err(error) => {
                    *crate::client::lock(&decrypt_error) = Some(error);
                    Err(StoreError::InvalidArgument("decryption failed".to_owned()))
                }
            }
        };
        let result = event_buffer.do_decryption_txn(Box::pin(body)).await;
        if let Some(error) = crate::client::lock(&decrypt_error).take() {
            return Err(error);
        }
        result.map_err(|source| DecryptError::Store {
            context: "failed to save decrypted event to buffer",
            source,
        })?;
        let plaintext = crate::client::lock(&plaintext)
            .take()
            .ok_or_else(|| DecryptError::Other("decryption produced no plaintext".to_owned()))?;
        tracing::debug!("successfully decrypted and saved event");
        Ok((plaintext, Some(ciphertext_hash)))
    }

    async fn decrypt_dm(
        self: &Arc<Self>,
        child: &Node,
        from: &Jid,
        is_pre_key: bool,
        server_timestamp: Option<DateTime<Utc>>,
    ) -> Result<(Vec<u8>, Option<[u8; 32]>), DecryptError> {
        let content = bytes_of(child)
            .ok_or_else(|| DecryptError::Other("message content is not a byte slice".to_owned()))?;
        let address = from.signal_address();
        let stateless = is_pre_key && child.attr_getter().optional_string("state") == "false";
        if stateless {
            tracing::debug!("not storing session from stateless prekey message");
        }
        let (plaintext, ciphertext_hash) = if is_pre_key {
            let decrypt = async {
                let result = self
                    .decrypt_pre_key_once(&address, content, stateless)
                    .await;
                match result {
                    Err(SignalError::UntrustedIdentity) if self.config.auto_trust_identity => {
                        tracing::warn!("untrusted identity while decrypting prekey message, clearing stored identity and retrying");
                        self.clear_untrusted_identity(from).await.map_err(|error| {
                            DecryptError::Other(format!("failed to clear untrusted identity: {error}"))
                        })?;
                        self.decrypt_pre_key_once(&address, content, stateless).await
                    }
                    other => other,
                }
                .map_err(|source| DecryptError::Signal {
                    context: "failed to decrypt prekey message",
                    source,
                })
            };
            self.buffered_decrypt(
                content,
                server_timestamp,
                decrypt,
                &["prekey", &from.to_string()],
            )
            .await?
        } else {
            let decrypt = async {
                let store = self.store.read().await;
                let signal_store = store.signal_store(None);
                self.signal
                    .decrypt_message(&signal_store, &address, content)
                    .await
                    .map_err(|source| DecryptError::Signal {
                        context: "failed to decrypt normal message",
                        source,
                    })
            };
            self.buffered_decrypt(
                content,
                server_timestamp,
                decrypt,
                &["normal", &from.to_string()],
            )
            .await?
        };
        let plaintext = unpad_message(plaintext, child.attr_getter().int("v"))
            .map_err(|error| DecryptError::Other(format!("failed to unpad message: {error}")))?;
        Ok((plaintext, ciphertext_hash))
    }

    async fn decrypt_pre_key_once(
        &self,
        address: &SignalAddress,
        content: &[u8],
        stateless: bool,
    ) -> Result<Vec<u8>, SignalError> {
        let store = self.store.read().await;
        let signal_store = store.signal_store(None);
        if stateless {
            let sessionless = SessionlessSignalStore(&signal_store);
            self.signal
                .decrypt_pre_key_message(&sessionless, address, content)
                .await
        } else {
            self.signal
                .decrypt_pre_key_message(&signal_store, address, content)
                .await
        }
    }

    async fn decrypt_group_msg(
        &self,
        child: &Node,
        from: &Jid,
        chat: &Jid,
        server_timestamp: Option<DateTime<Utc>>,
    ) -> Result<(Vec<u8>, Option<[u8; 32]>), DecryptError> {
        let content = bytes_of(child)
            .ok_or_else(|| DecryptError::Other("message content is not a byte slice".to_owned()))?;
        let sender_key_name = SenderKeyName {
            group_id: chat.to_string(),
            sender: from.signal_address(),
        };
        let decrypt = async {
            let store = self.store.read().await;
            let signal_store = store.signal_store(None);
            self.signal
                .group_decrypt(&signal_store, &sender_key_name, content)
                .await
                .map_err(|source| DecryptError::Signal {
                    context: "failed to decrypt group message",
                    source,
                })
        };
        let (plaintext, ciphertext_hash) = self
            .buffered_decrypt(
                content,
                server_timestamp,
                decrypt,
                &["senderkey", &chat.to_string(), &from.to_string()],
            )
            .await?;
        let plaintext =
            unpad_message(plaintext, child.attr_getter().int("v")).map_err(DecryptError::Other)?;
        Ok((plaintext, ciphertext_hash))
    }

    async fn handle_sender_key_distribution_message(
        &self,
        chat: &Jid,
        from: &Jid,
        axolotl_skdm: &[u8],
    ) {
        let sender_key_name = SenderKeyName {
            group_id: chat.to_string(),
            sender: from.signal_address(),
        };
        let store = self.store.read().await;
        let signal_store = store.signal_store(None);
        match self
            .signal
            .process_sender_key_distribution_message(&signal_store, &sender_key_name, axolotl_skdm)
            .await
        {
            Err(error) => {
                tracing::error!(error = %error, "failed to process sender key distribution message")
            }
            Ok(()) => tracing::debug!("processed sender key distribution message"),
        }
    }

    /// Boxed with an explicit `Send` bound: the loop restarts itself.
    fn handle_history_sync_notification_loop(
        self: Arc<Self>,
    ) -> futures::future::BoxFuture<'static, ()> {
        Box::pin(self.history_sync_notification_loop_inner())
    }

    async fn history_sync_notification_loop_inner(self: Arc<Self>) {
        const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
        loop {
            let notification = {
                let mut receiver = self.history_sync_notifications_receiver.lock().await;
                tokio::select! {
                    notification = receiver.recv() => notification,
                    () = tokio::time::sleep(IDLE_TIMEOUT) => None,
                    () = self.background.cancelled() => None,
                }
            };
            let Some(notification) = notification else {
                break;
            };
            match self.download_history_sync(&notification, false).await {
                Err(error) => tracing::error!(error = %error, "failed to download history sync"),
                Ok(blob) => {
                    self.dispatch_event(Event::HistorySync(Box::new(HistorySync {
                        data: blob,
                        notification: notification.clone(),
                    })))
                    .await;
                    if let Err(error) = self
                        .delete_media(
                            MediaType::History,
                            notification.direct_path.as_deref().unwrap_or_default(),
                            notification.file_enc_sha256.as_deref().unwrap_or_default(),
                            notification.enc_handle.as_deref().unwrap_or_default(),
                        )
                        .await
                    {
                        tracing::warn!(error = %error, "failed to delete history sync media from server");
                    }
                }
            }
        }
        self.history_sync_handler_started
            .store(false, Ordering::SeqCst);
        // Something may have been queued between the loop stopping and the
        // flag being cleared; restart if so.
        if !self
            .history_sync_notifications_receiver
            .lock()
            .await
            .is_empty()
            && self
                .history_sync_handler_started
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        {
            tracing::warn!(
                "new history sync notifications appeared after loop stopped, restarting loop"
            );
            let client = Arc::clone(&self);
            self.spawn(client.handle_history_sync_notification_loop());
        }
    }

    /// Downloads and decodes the history sync blob of a notification. Call
    /// this yourself only with `manual_history_sync_download`; otherwise the
    /// client does and emits [`Event::HistorySync`].
    #[tracing::instrument(name = "whatsmeow.history_sync.download", skip_all, err)]
    pub async fn download_history_sync(
        self: &Arc<Self>,
        notification: &wa_e2e::HistorySyncNotification,
        synchronous_storage: bool,
    ) -> Result<wa_history_sync::HistorySync, ClientError> {
        let data = match &notification.initial_hist_bootstrap_inline_payload {
            Some(inline) => inline.clone(),
            None => self
                .download(notification)
                .await
                .map_err(|error| error.wrap("failed to download"))?,
        };
        let mut raw_data = Vec::new();
        flate2::read::ZlibDecoder::new(data.as_slice())
            .read_to_end(&mut raw_data)
            .map_err(|error| ClientError::Other(format!("failed to decompress: {error}")))?;
        let history_sync = wa_history_sync::HistorySync::decode(raw_data.as_slice())
            .map_err(|error| ClientError::Other(format!("failed to unmarshal: {error}")))?;
        tracing::debug!(
            sync_type = history_sync.sync_type,
            chunk_order = history_sync.chunk_order,
            progress = history_sync.progress,
            conversations = history_sync.conversations.len(),
            "received history sync"
        );
        if synchronous_storage {
            self.store_history_sync_side_data(&history_sync).await;
        } else {
            let client = Arc::clone(self);
            let history_sync = history_sync.clone();
            self.spawn(async move { client.store_history_sync_side_data(&history_sync).await });
        }
        Ok(history_sync)
    }

    async fn store_history_sync_side_data(&self, history_sync: &wa_history_sync::HistorySync) {
        if let Some(salt) = history_sync
            .nct_salt
            .as_ref()
            .filter(|salt| !salt.is_empty())
        {
            let nct_salt = Arc::clone(&self.store.read().await.nct_salt);
            match nct_salt.put_nct_salt(salt.clone()).await {
                Err(error) => {
                    tracing::warn!(error = %error, "failed to store NCT salt from history sync")
                }
                Ok(()) => tracing::debug!("stored new NCT salt"),
            }
        }
        if !history_sync.phone_number_to_lid_mappings.is_empty() {
            self.store_historical_pn_lid_mappings(&history_sync.phone_number_to_lid_mappings)
                .await;
        }
        if history_sync.sync_type == HistorySyncType::PushName as i32 {
            self.handle_historical_push_names(&history_sync.pushnames)
                .await;
        } else if !history_sync.conversations.is_empty() {
            self.store_historical_message_secrets(&history_sync.conversations)
                .await;
        }
        if let Some(settings) = &history_sync.global_settings {
            self.store_global_settings(settings).await;
        }
        if let Some(nonce) = &history_sync.companion_meta_nonce {
            self.store_companion_meta_nonce(nonce).await;
        }
    }

    async fn handle_placeholder_resend_response(
        &self,
        message: &wa_e2e::PeerDataOperationRequestResponseMessage,
    ) -> bool {
        let request_id = message.stanza_id.clone().unwrap_or_default();
        let parts = &message.peer_data_operation_result;
        tracing::debug!(
            items = parts.len(),
            "handling response to placeholder resend request"
        );
        let mut ok = true;
        for (index, part) in parts.iter().enumerate() {
            let Some(response) = &part.placeholder_message_resend_response else {
                tracing::warn!(
                    item = index + 1,
                    "missing response in placeholder resend item"
                );
                continue;
            };
            let web_message = match WebMessageInfo::decode(
                response
                    .web_message_info_bytes
                    .as_deref()
                    .unwrap_or_default(),
            ) {
                Ok(web_message) => web_message,
                Err(error) => {
                    tracing::warn!(error = %error, item = index + 1, "failed to unmarshal web message in placeholder resend item");
                    continue;
                }
            };
            match self.parse_web_message(&Jid::default(), web_message).await {
                Err(error) => {
                    tracing::warn!(error = %error, item = index + 1, "failed to parse web message info in placeholder resend item");
                }
                Ok(mut event) => {
                    event.unavailable_request_id = request_id.clone();
                    ok = !self.dispatch_event(Event::Message(Box::new(event))).await && ok;
                }
            }
        }
        ok
    }

    async fn handle_protocol_message(
        self: &Arc<Self>,
        info: &MessageInfo,
        message: &wa_e2e::Message,
    ) -> bool {
        let mut ok = true;
        let Some(protocol_message) = &message.protocol_message else {
            return ok;
        };
        if !info.is_from_me {
            return ok;
        }

        if let Some(notification) = &protocol_message.history_sync_notification {
            if !self.config.manual_history_sync_download {
                let _ = self.history_sync_notifications.send(notification.clone());
                if self
                    .history_sync_handler_started
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    let client = Arc::clone(self);
                    self.spawn(client.handle_history_sync_notification_loop());
                }
            }
            if !(self.config.manual_history_sync_download
                && self.config.disable_manual_history_sync_receipt)
            {
                let client = Arc::clone(self);
                let id = info.id.clone();
                self.spawn(async move {
                    if let Err(error) = client
                        .send_protocol_message_receipt(&id, ReceiptType::HistorySync)
                        .await
                    {
                        tracing::warn!(error = %error, "failed to send acknowledgement for protocol message");
                    }
                });
            }
        }

        if let Some(lid_sync) = &protocol_message.lid_migration_mapping_sync_message {
            self.store_lid_sync_message(
                lid_sync
                    .encoded_mapping_payload
                    .as_deref()
                    .unwrap_or_default(),
            )
            .await;
        }

        if info.sender.device == 0
            && let Some(response) = &protocol_message.peer_data_operation_request_response_message
        {
            let request_type = response.peer_data_operation_request_type;
            if request_type == Some(PeerDataOperationRequestType::PlaceholderMessageResend as i32) {
                ok = self.handle_placeholder_resend_response(response).await && ok;
            } else if request_type
                == Some(PeerDataOperationRequestType::CompanionSyncdSnapshotFatalRecovery as i32)
            {
                tracing::debug!("app state recovery responses are handled with app state sync");
            }
        }

        if let Some(key_share) = &protocol_message.app_state_sync_key_share {
            let client = Arc::clone(self);
            let key_share = key_share.clone();
            self.spawn(async move { client.handle_app_state_sync_key_share(&key_share).await });
        }

        if info.category == "peer" {
            let client = Arc::clone(self);
            let id = info.id.clone();
            self.spawn(async move {
                if let Err(error) = client
                    .send_protocol_message_receipt(&id, ReceiptType::PeerMsg)
                    .await
                {
                    tracing::warn!(error = %error, "failed to send acknowledgement for protocol message");
                }
            });
        }
        ok
    }

    async fn process_protocol_parts(
        self: &Arc<Self>,
        info: &MessageInfo,
        message: &wa_e2e::Message,
    ) -> bool {
        let mut ok = true;
        self.store_message_secret(info, message).await;
        // Hopefully sender key distribution messages and protocol messages
        // can't be inside ephemeral messages.
        let message = message
            .device_sent_message
            .as_ref()
            .and_then(|device_sent| device_sent.message.as_deref())
            .unwrap_or(message);
        if let Some(skdm) = &message.sender_key_distribution_message {
            if !info.is_group {
                tracing::warn!("got sender key distribution message in non-group chat");
            } else {
                let mut encryption_identity = &info.sender;
                if encryption_identity.server == DEFAULT_USER_SERVER
                    && info.sender_alt.server == HIDDEN_USER_SERVER
                {
                    encryption_identity = &info.sender_alt;
                }
                self.handle_sender_key_distribution_message(
                    &info.chat,
                    encryption_identity,
                    skdm.axolotl_sender_key_distribution_message
                        .as_deref()
                        .unwrap_or_default(),
                )
                .await;
            }
        }
        // Edits are protocol messages too, but wrapped in EditedMessage,
        // which is only unwrapped after this, so they don't trigger here.
        if message.protocol_message.is_some() {
            ok = self.handle_protocol_message(info, message).await && ok;
        }
        ok
    }

    async fn store_message_secret(&self, info: &MessageInfo, message: &wa_e2e::Message) {
        let Some(secret) = message
            .message_context_info
            .as_ref()
            .and_then(|context| context.message_secret.as_ref())
            .filter(|secret| !secret.is_empty())
        else {
            return;
        };
        let mut target_chat = info.chat.clone();
        let device_sent = message
            .device_sent_message
            .as_ref()
            .and_then(|device_sent| device_sent.message.as_deref())
            .unwrap_or(message);
        if let Some(target_chat_jid) = device_sent
            .root_secret_distribute_message
            .as_ref()
            .and_then(|root| root.chat_jid.as_deref())
            .filter(|jid| !jid.is_empty())
            && info.is_from_me
        {
            match parse_jid(target_chat_jid) {
                Ok(jid) => target_chat = jid,
                Err(error) => {
                    tracing::warn!(error = %error, "failed to parse chat JID from root secret distribute message");
                    return;
                }
            }
        }
        let msg_secrets = Arc::clone(&self.store.read().await.msg_secrets);
        match msg_secrets
            .put_message_secret(&target_chat, &info.sender, &info.id, secret.clone())
            .await
        {
            Err(error) => tracing::error!(error = %error, "failed to store message secret key"),
            Ok(()) => tracing::debug!("stored message secret key"),
        }
    }

    async fn store_historical_message_secrets(
        &self,
        conversations: &[wa_history_sync::Conversation],
    ) {
        let own_id = self.get_own_id().await.to_non_ad();
        if own_id.is_empty() {
            return;
        }
        let (lids, msg_secrets, privacy_tokens) = {
            let store = self.store.read().await;
            (
                Arc::clone(&store.lids),
                Arc::clone(&store.msg_secrets),
                Arc::clone(&store.privacy_tokens),
            )
        };
        let mut secrets = Vec::new();
        let mut tokens = Vec::new();
        for conversation in conversations {
            let chat_jid = parse_jid(&conversation.id).unwrap_or_default();
            if chat_jid.is_empty() {
                continue;
            }
            let user_jid = if chat_jid.server == HIDDEN_USER_SERVER {
                chat_jid.clone()
            } else if chat_jid.server == DEFAULT_USER_SERVER {
                // Privacy token lookups check LIDs and phone numbers, so a
                // phone number is better than nothing.
                lids.get_lid_for_pn(&chat_jid)
                    .await
                    .ok()
                    .flatten()
                    .filter(|lid| !lid.is_empty())
                    .unwrap_or_else(|| chat_jid.clone())
            } else {
                Jid::default()
            };
            if !user_jid.is_empty()
                && let Some(token) = &conversation.tc_token
            {
                let seconds = |value: Option<u64>| {
                    DateTime::from_timestamp(
                        i64::try_from(value.unwrap_or_default()).unwrap_or_default(),
                        0,
                    )
                    .unwrap_or_default()
                };
                tokens.push(PrivacyToken {
                    user: user_jid,
                    token: token.clone(),
                    timestamp: seconds(conversation.tc_token_timestamp),
                    sender_timestamp: Some(seconds(conversation.tc_token_sender_timestamp)),
                });
            }
            for history_message in &conversation.messages {
                let Some(web_message) = &history_message.message else {
                    continue;
                };
                let Some(secret) = &web_message.message_secret else {
                    continue;
                };
                let key = web_message.key.clone();
                let sender_jid = if key.from_me.unwrap_or_default() {
                    own_id.clone()
                } else if chat_jid.server == DEFAULT_USER_SERVER
                    || chat_jid.server == HIDDEN_USER_SERVER
                {
                    chat_jid.clone()
                } else if let Some(participant) =
                    key.participant.as_deref().filter(|p| !p.is_empty())
                {
                    parse_jid(participant).unwrap_or_default()
                } else if let Some(participant) =
                    web_message.participant.as_deref().filter(|p| !p.is_empty())
                {
                    parse_jid(participant).unwrap_or_default()
                } else {
                    Jid::default()
                };
                let id = key.id.unwrap_or_default();
                if sender_jid.is_empty() || id.is_empty() {
                    continue;
                }
                secrets.push(MessageSecretInsert {
                    chat: chat_jid.clone(),
                    sender: sender_jid,
                    id,
                    secret: secret.clone(),
                });
            }
        }
        if !secrets.is_empty() {
            match msg_secrets.put_message_secrets(&secrets).await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to store message secret keys in history sync")
                }
                Ok(()) => tracing::info!(
                    count = secrets.len(),
                    "stored message secret keys from history sync"
                ),
            }
        }
        if !tokens.is_empty() {
            match privacy_tokens.put_privacy_tokens(&tokens).await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to store privacy tokens in history sync")
                }
                Ok(()) => tracing::info!(
                    count = tokens.len(),
                    "stored privacy tokens from history sync"
                ),
            }
        }
    }

    async fn store_lid_sync_message(&self, payload: &[u8]) {
        let decoded = match LidMigrationMappingSyncPayload::decode(payload) {
            Ok(decoded) => decoded,
            Err(error) => {
                tracing::error!(error = %error, "failed to unmarshal LID migration mapping sync payload");
                return;
            }
        };
        let migration_timestamp = decoded.chat_db_migration_timestamp.unwrap_or_default();
        self.save_lid_migration_timestamp(i64::try_from(migration_timestamp).unwrap_or_default())
            .await;
        let pairs: Vec<LidMapping> = decoded
            .pn_to_lid_mappings
            .iter()
            .map(|mapping| LidMapping {
                lid: crate::types::new_jid(&mapping.assigned_lid.to_string(), HIDDEN_USER_SERVER),
                pn: crate::types::new_jid(&mapping.pn.to_string(), DEFAULT_USER_SERVER),
            })
            .collect();
        let lids = Arc::clone(&self.store.read().await.lids);
        match lids.put_many_lid_mappings(&pairs).await {
            Err(error) => {
                tracing::error!(error = %error, pair_count = pairs.len(), "failed to store phone number to LID mappings from sync message")
            }
            Ok(()) => tracing::debug!(
                pair_count = pairs.len(),
                "stored PN-LID mappings from sync message"
            ),
        }
    }

    async fn save_lid_migration_timestamp(&self, timestamp: i64) {
        let mut store = self.store.write().await;
        if store.lid_migration_timestamp == 0 && timestamp > 0 {
            store.lid_migration_timestamp = timestamp;
            match store.save().await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to save chat DB LID migration timestamp")
                }
                Ok(()) => tracing::debug!(timestamp, "saved chat DB LID migration timestamp"),
            }
        }
    }

    async fn store_global_settings(&self, settings: &wa_history_sync::GlobalSettings) {
        self.save_lid_migration_timestamp(
            settings.chat_db_lid_migration_timestamp.unwrap_or_default(),
        )
        .await;
    }

    async fn store_companion_meta_nonce(&self, nonce: &str) {
        let mut store = self.store.write().await;
        if !nonce.is_empty() && nonce != store.companion_meta_nonce {
            store.companion_meta_nonce = nonce.to_owned();
            match store.save().await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to save companion meta nonce")
                }
                Ok(()) => tracing::debug!("saved companion meta nonce"),
            }
        }
    }

    async fn store_historical_pn_lid_mappings(
        &self,
        mappings: &[wa_history_sync::PhoneNumberToLidMapping],
    ) {
        let mut pairs = Vec::with_capacity(mappings.len());
        for mapping in mappings {
            let mut pn = match parse_jid(mapping.pn_jid.as_deref().unwrap_or_default()) {
                Ok(pn) => pn,
                Err(error) => {
                    tracing::error!(error = %error, "failed to parse phone number from history sync");
                    continue;
                }
            };
            if pn.server == LEGACY_USER_SERVER {
                pn.server = DEFAULT_USER_SERVER.to_owned();
            }
            let lid = match parse_jid(mapping.lid_jid.as_deref().unwrap_or_default()) {
                Ok(lid) => lid,
                Err(error) => {
                    tracing::error!(error = %error, "failed to parse LID from history sync");
                    continue;
                }
            };
            pairs.push(LidMapping { lid, pn });
        }
        let lids = Arc::clone(&self.store.read().await.lids);
        match lids.put_many_lid_mappings(&pairs).await {
            Err(error) => {
                tracing::error!(error = %error, pair_count = pairs.len(), "failed to store phone number to LID mappings from history sync")
            }
            Ok(()) => tracing::debug!(
                pair_count = pairs.len(),
                "stored PN-LID mappings from history sync"
            ),
        }
    }

    /// Handles a decrypted message; returns whether a handler failed.
    async fn handle_decrypted_message(
        self: &Arc<Self>,
        info: &MessageInfo,
        message: wa_e2e::Message,
        retry_count: i64,
    ) -> bool {
        if !self.process_protocol_parts(info, &message).await {
            return false;
        }
        let mut event = Message {
            info: info.clone(),
            raw_message: Some(message),
            retry_count,
            ..Message::default()
        };
        event.unwrap_raw();
        self.dispatch_event(Event::Message(Box::new(event))).await
    }

    /// Sends a receipt for a protocol message back to the phone.
    pub async fn send_protocol_message_receipt(
        &self,
        id: &str,
        message_type: ReceiptType,
    ) -> Result<(), ClientError> {
        if id.is_empty() {
            return Ok(());
        }
        let node = Node {
            tag: "receipt".to_owned(),
            attrs: crate::binary::Attrs::from([
                ("id".to_owned(), id.into()),
                ("type".to_owned(), message_type.as_str().into()),
                ("to".to_owned(), self.get_own_id().await.to_non_ad().into()),
            ]),
            content: None,
        };
        self.send_node(&node).await
    }
}

/// Parses a `<bot>` node. Like Go, it reads the `<bot>` child of the node it
/// is given, and the message parser passes the `<bot>` node itself.
fn parse_msg_bot_info(node: &Node) -> Result<MsgBotInfo, ClientError> {
    let bot_node = node.get_child_by_tag(&["bot"]);
    let mut attrs = bot_node.attr_getter();
    let mut bot_info = MsgBotInfo {
        edit_type: BotEditType::from(attrs.optional_string("edit")),
        ..MsgBotInfo::default()
    };
    if matches!(
        bot_info.edit_type,
        BotEditType::Inner | BotEditType::Last | BotEditType::Full
    ) {
        bot_info.edit_target_id = attrs.optional_string("edit_target_id");
        bot_info.edit_sender_timestamp_ms = attrs.unix_milli("sender_timestamp_ms");
    }
    bot_info.client_thread_id = attrs.optional_string("client_thread_id");
    attrs.error()?;
    Ok(bot_info)
}

/// Parses a `<meta>` node; reads the `<meta>` child like `parse_msg_bot_info`.
fn parse_msg_meta_info(node: &Node) -> Result<MsgMetaInfo, ClientError> {
    let meta_node = node.get_child_by_tag(&["meta"]);
    let mut attrs = meta_node.attr_getter();
    let meta_info = MsgMetaInfo {
        target_id: attrs.optional_string("target_id"),
        target_sender: attrs.optional_jid_or_empty("target_sender_jid"),
        target_chat: attrs.optional_jid_or_empty("target_chat_jid"),
        deprecated_lid_session: attrs.get_bool("deprecated_lid_session", false),
        thread_message_id: attrs.optional_string("thread_msg_id"),
        thread_message_sender_jid: attrs.optional_jid_or_empty("thread_msg_sender_jid"),
    };
    attrs.error()?;
    Ok(meta_info)
}

fn is_valid_padding(plaintext: &[u8]) -> bool {
    let Some(&last_byte) = plaintext.last() else {
        return false;
    };
    let padding = usize::from(last_byte);
    padding <= plaintext.len()
        && plaintext[plaintext.len() - padding..]
            .iter()
            .all(|&byte| byte == last_byte)
}

/// Removes the random padding of a decrypted message; version 3 messages
/// aren't padded.
pub fn unpad_message(mut plaintext: Vec<u8>, version: i64) -> Result<Vec<u8>, String> {
    if version == 3 {
        return Ok(plaintext);
    }
    let Some(&last_byte) = plaintext.last() else {
        return Err("plaintext is empty".to_owned());
    };
    if !is_valid_padding(&plaintext) {
        return Err("plaintext doesn't have expected padding".to_owned());
    }
    plaintext.truncate(plaintext.len() - usize::from(last_byte));
    Ok(plaintext)
}

/// Appends 1–15 bytes of padding, each the padding length.
pub fn pad_message(mut plaintext: Vec<u8>) -> Vec<u8> {
    let mut pad = rand::random::<u8>() & 0xf;
    if pad == 0 {
        pad = 0xf;
    }
    plaintext.extend(std::iter::repeat_n(pad, usize::from(pad)));
    plaintext
}

#[cfg(test)]
mod test;
