// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow retry.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! Retry receipts: asking senders to resend messages that didn't decrypt,
//! and resending our messages when others ask.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use prost::Message as _;

use crate::binary::{AttributeValue, Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::{ClientError, element_missing};
use crate::prekeys::pre_key_to_node;
use crate::proto::wa_e2e;
use crate::signal::DJB_TYPE;
use crate::signal::SenderKeyName;
use crate::types::events::Receipt;
use crate::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, MessageId, MessageInfo};

/// How many sent messages are kept in memory for retry receipts.
pub const RECENT_MESSAGES_SIZE: usize = 256;

const RECREATE_SESSION_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const RETRY_STORE_CLEAR_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);

/// The recently sent messages, a ring of [`RECENT_MESSAGES_SIZE`] (Go's
/// `recentMessagesMap` and `recentMessagesList`). Only WhatsApp messages;
/// Messenger (`fb`) messages aren't ported.
pub(crate) struct RecentMessages {
    map: HashMap<(Jid, MessageId), wa_e2e::Message>,
    list: Vec<Option<(Jid, MessageId)>>,
    pointer: usize,
}

impl Default for RecentMessages {
    fn default() -> Self {
        RecentMessages {
            map: HashMap::new(),
            list: vec![None; RECENT_MESSAGES_SIZE],
            pointer: 0,
        }
    }
}

/// Retry bookkeeping guarded by one lock: per-device session recreation
/// times and per-(device, message) incoming retry counts.
#[derive(Default)]
pub(crate) struct RetryState {
    session_recreate_history: HashMap<Jid, tokio::time::Instant>,
    incoming_retry_request_counter: HashMap<(Jid, MessageId), u32>,
    last_retry_store_clear: Option<tokio::time::Instant>,
}

/// How long to wait for the sender to resend a message before asking the
/// phone (`RequestFromPhoneDelay`), with `automatic_message_rerequest_from_phone`.
pub const REQUEST_FROM_PHONE_DELAY: Duration = Duration::from_secs(5);

impl Client {
    /// Remembers a sent message for retry receipts, in the store too with
    /// `use_retry_message_store`.
    pub(crate) async fn add_recent_message(
        &self,
        to: &Jid,
        id: &str,
        message: &wa_e2e::Message,
    ) -> Result<(), ClientError> {
        if self.config.use_retry_message_store {
            let event_buffer = Arc::clone(&self.store.read().await.event_buffer);
            event_buffer
                .add_outgoing_event(to, &id.to_owned(), "wa", message.encode_to_vec())
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to add message to retry store")
                })?;
            let clear = {
                let mut state = lock(&self.retry_state);
                let clear = state
                    .last_retry_store_clear
                    .is_none_or(|last| last.elapsed() > RETRY_STORE_CLEAR_INTERVAL);
                if clear {
                    state.last_retry_store_clear = Some(tokio::time::Instant::now());
                }
                clear
            };
            if clear {
                event_buffer
                    .delete_old_outgoing_events()
                    .await
                    .map_err(|error| {
                        ClientError::from(error)
                            .wrap("failed to clear old messages from retry store")
                    })?;
            }
        }
        let mut recent = lock(&self.recent_messages);
        let key = (to.clone(), id.to_owned());
        let pointer = recent.pointer;
        if let Some(old) = recent.list[pointer].take() {
            recent.map.remove(&old);
        }
        recent.map.insert(key.clone(), message.clone());
        recent.list[pointer] = Some(key);
        recent.pointer = (pointer + 1) % RECENT_MESSAGES_SIZE;
        Ok(())
    }

    fn get_recent_message(&self, to: &Jid, id: &str) -> Option<wa_e2e::Message> {
        lock(&self.recent_messages)
            .map
            .get(&(to.clone(), id.to_owned()))
            .cloned()
    }

    async fn get_message_for_retry(
        &self,
        receipt: &Receipt,
        message_id: &str,
    ) -> Result<Option<wa_e2e::Message>, ClientError> {
        if let Some(message) = self.get_recent_message(&receipt.source.chat, message_id) {
            tracing::debug!("found message in local cache to accept retry receipt");
            return Ok(Some(message));
        }
        let lids = Arc::clone(&self.store.read().await.lids);
        let alt_chat = match receipt.source.chat.server.as_str() {
            DEFAULT_USER_SERVER => lids.get_lid_for_pn(&receipt.source.chat).await,
            HIDDEN_USER_SERVER => lids.get_pn_for_lid(&receipt.source.chat).await,
            _ => Ok(None),
        }
        .map_err(|error| ClientError::from(error).wrap("failed to get alternate JID"))?
        .unwrap_or_default();
        if !alt_chat.is_empty()
            && let Some(message) = self.get_recent_message(&alt_chat, message_id)
        {
            tracing::debug!(
                "found message in local cache with alternate chat JID to accept retry receipt"
            );
            return Ok(Some(message));
        }
        if self.config.use_retry_message_store {
            let event_buffer = Arc::clone(&self.store.read().await.event_buffer);
            let stored = event_buffer
                .get_outgoing_event(&receipt.source.chat, &alt_chat, &message_id.to_owned())
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to get message from retry store")
                })?;
            return match stored {
                None => Ok(None),
                Some((format, buffer)) if format == "wa" => {
                    wa_e2e::Message::decode(buffer.as_slice())
                        .map(Some)
                        .map_err(|error| {
                            ClientError::Other(format!(
                                "failed to unmarshal payload in retry store: {error}"
                            ))
                        })
                }
                Some((format, _)) => Err(ClientError::Other(format!(
                    "failed to unmarshal payload in retry store: unknown format in retry store: {format}"
                ))),
            };
        }
        if let Some(callback) = &self.config.get_message_for_retry
            && let Some(message) =
                callback(&receipt.source.sender, &receipt.source.chat, message_id)
        {
            tracing::debug!("found message in get_message_for_retry to accept retry receipt");
            return Ok(Some(message));
        }
        Ok(None)
    }

    async fn should_recreate_session(&self, retry_count: i64, jid: &Jid) -> Option<&'static str> {
        let contains = {
            let store = self.store.read().await;
            store
                .sessions
                .has_session(&jid.signal_address().to_string())
                .await
        };
        let mut state = lock(&self.retry_state);
        match contains {
            Err(_) => return None,
            Ok(false) => {
                state
                    .session_recreate_history
                    .insert(jid.clone(), tokio::time::Instant::now());
                return Some("we don't have a Signal session with them");
            }
            Ok(true) if retry_count < 2 => return None,
            Ok(true) => {}
        }
        let recreate = state
            .session_recreate_history
            .get(jid)
            .is_none_or(|previous| previous.elapsed() > RECREATE_SESSION_TIMEOUT);
        if recreate {
            state
                .session_recreate_history
                .insert(jid.clone(), tokio::time::Instant::now());
            Some("retry count > 1 and over an hour since last recreation")
        } else {
            None
        }
    }

    /// Resends one of our messages to a device that couldn't decrypt it.
    #[tracing::instrument(name = "whatsmeow.handle_retry_receipt", skip_all, err)]
    async fn handle_retry_receipt(
        self: &Arc<Self>,
        receipt: &Receipt,
        node: &Node,
    ) -> Result<(), ClientError> {
        let retry_child = node
            .get_optional_child_by_tag(&["retry"])
            .ok_or_else(|| element_missing("retry", "retry receipt"))?;
        let mut attrs = retry_child.attr_getter();
        let message_id = attrs.string("id");
        let timestamp = attrs.unix_time("t");
        let retry_count = attrs.int("count");
        attrs.error()?;
        let Some(mut message) = self.get_message_for_retry(receipt, &message_id).await? else {
            return Err(ClientError::Other(format!(
                "couldn't find message {message_id}"
            )));
        };

        let internal_counter = {
            let mut state = lock(&self.retry_state);
            let counter = state
                .incoming_retry_request_counter
                .entry((receipt.source.sender.clone(), message_id.clone()))
                .or_default();
            *counter += 1;
            *counter
        };
        if internal_counter >= 10 {
            tracing::warn!(
                internal_counter,
                "dropping retry request: internal retry counter is too high"
            );
            return Ok(());
        }

        if receipt.source.is_group {
            let sender_key_name = SenderKeyName {
                group_id: receipt.source.chat.to_string(),
                sender: self.get_own_lid().await.signal_address(),
            };
            let skdm = {
                let store = self.store.read().await;
                let signal_store = store.signal_store(None);
                self.signal
                    .create_sender_key_distribution_message(&signal_store, &sender_key_name)
                    .await
            };
            match skdm {
                Err(error) => {
                    tracing::warn!(error = %error, "failed to create sender key distribution message to include in retry")
                }
                Ok(skdm) => {
                    message.sender_key_distribution_message =
                        Some(wa_e2e::SenderKeyDistributionMessage {
                            group_id: Some(receipt.source.chat.to_string()),
                            axolotl_sender_key_distribution_message: Some(skdm),
                        });
                }
            }
        } else if receipt.source.is_from_me {
            message = wa_e2e::Message {
                device_sent_message: Some(Box::new(wa_e2e::DeviceSentMessage {
                    destination_jid: Some(receipt.source.chat.to_string()),
                    message: Some(Box::new(message)),
                    phash: None,
                })),
                ..Default::default()
            };
        }

        if let Some(callback) = &self.config.pre_retry_callback
            && !callback(receipt, &message_id, retry_count, &message)
        {
            tracing::debug!("cancelled retry receipt in pre_retry_callback");
            return Ok(());
        }

        let plaintext = message.encode_to_vec();
        let bundle = if node.get_optional_child_by_tag(&["keys"]).is_some() {
            Some(
                crate::prekeys::node_to_pre_key_bundle(
                    u32::from(receipt.source.sender.device),
                    node,
                )
                .map_err(|error| error.wrap("failed to read prekey bundle in retry receipt"))?,
            )
        } else if let Some(reason) = self
            .should_recreate_session(retry_count, &receipt.source.sender)
            .await
        {
            tracing::debug!(
                reason,
                "fetching prekeys for retry receipt with no prekey bundle"
            );
            let mut keys = self
                .fetch_pre_keys(std::slice::from_ref(&receipt.source.sender))
                .await?;
            let response_count = keys.len();
            match keys.remove(&receipt.source.sender) {
                Some(Ok(bundle)) => Some(bundle),
                Some(Err(error)) => return Err(error.wrap("failed to fetch prekeys")),
                None => {
                    return Err(ClientError::Other(format!(
                        "didn't get prekey bundle for the sender (response size: {response_count})"
                    )));
                }
            }
        } else {
            None
        };
        let mut enc_attrs = Attrs::new();
        let media_type = crate::send::get_media_type_from_message(&message);
        if !media_type.is_empty() {
            enc_attrs.insert("mediatype".to_owned(), media_type.into());
        }
        let message_type = crate::send::get_type_from_message(&message);
        let mut encryption_identity = receipt.source.sender.clone();
        if receipt.source.sender.server == DEFAULT_USER_SERVER {
            let lids = Arc::clone(&self.store.read().await.lids);
            match lids.get_lid_for_pn(&receipt.source.sender).await {
                Err(error) => tracing::warn!(error = %error, "failed to get LID for retry sender"),
                Ok(Some(lid)) if !lid.is_empty() => {
                    let sessions = Arc::clone(&self.store.read().await.sessions);
                    if let Err(error) = sessions
                        .migrate_pn_to_lid(&receipt.source.sender, &lid)
                        .await
                    {
                        tracing::error!(error = %error, "failed to migrate signal store from phone number to LID");
                    }
                    encryption_identity = lid;
                }
                Ok(_) => {}
            }
        }
        let (mut encrypted, include_device_identity) = self
            .encrypt_message_for_device(
                &plaintext,
                &encryption_identity,
                bundle.as_ref(),
                &enc_attrs,
                None,
                None,
            )
            .await
            .map_err(|error| error.wrap("failed to encrypt message for retry"))?;
        encrypted
            .attrs
            .insert("count".to_owned(), retry_count.into());

        let mut message_attrs = Attrs::from([
            ("type".to_owned(), message_type.into()),
            ("id".to_owned(), message_id.clone().into()),
            (
                "t".to_owned(),
                timestamp.unwrap_or_else(Utc::now).timestamp().into(),
            ),
        ]);
        if let Some(from) = node.attrs.get("from") {
            message_attrs.insert("to".to_owned(), from.clone());
        }
        if !receipt.source.is_group {
            message_attrs.insert("device_fanout".to_owned(), false.into());
        }
        for key in ["participant", "recipient", "edit"] {
            if let Some(value) = node.attrs.get(key) {
                message_attrs.insert(key.to_owned(), value.clone());
            }
        }
        let content = self
            .get_message_content(
                encrypted,
                &message,
                &message_attrs,
                include_device_identity,
                &crate::send::NodeExtraParams::default(),
            )
            .await;
        self.send_node(&Node {
            tag: "message".to_owned(),
            attrs: message_attrs,
            content: Some(NodeContent::Nodes(content)),
        })
        .await
        .map_err(|error| error.wrap("failed to send retry message"))?;
        tracing::debug!(retry_count, "sent retry");
        Ok(())
    }

    pub(crate) fn cancel_delayed_request_from_phone(&self, message_id: &str) {
        if !self.config.automatic_message_rerequest_from_phone {
            return;
        }
        if let Some(cancel) = lock(&self.pending_phone_rerequests).get(message_id) {
            cancel.cancel();
        }
    }

    async fn delayed_request_message_from_phone(self: Arc<Self>, info: MessageInfo) {
        if !self.config.automatic_message_rerequest_from_phone {
            return;
        }
        let cancel = {
            let mut pending = lock(&self.pending_phone_rerequests);
            if pending.contains_key(&info.id) {
                return;
            }
            let cancel = self.background.child_token();
            pending.insert(info.id.clone(), cancel.clone());
            cancel
        };
        tokio::select! {
            () = tokio::time::sleep(REQUEST_FROM_PHONE_DELAY) => {
                self.immediate_request_message_from_phone(&info).await;
            }
            () = cancel.cancelled() => {
                tracing::debug!("cancelled delayed request for message from phone");
            }
        }
        lock(&self.pending_phone_rerequests).remove(&info.id);
    }

    /// Asks the primary device to resend a message this device couldn't
    /// decrypt.
    pub(crate) async fn immediate_request_message_from_phone(self: &Arc<Self>, info: &MessageInfo) {
        let request = self.build_unavailable_message_request(&info.chat, &info.sender, &info.id);
        match self.send_peer_message(request).await {
            Err(error) => {
                tracing::warn!(error = %error, "failed to send request for unavailable message to phone")
            }
            Ok(_) => tracing::debug!("requested message from phone"),
        }
    }

    pub(crate) fn clear_delayed_message_requests(&self) {
        for cancel in lock(&self.pending_phone_rerequests).values() {
            cancel.cancel();
        }
    }

    /// Sends a retry receipt for an incoming message that didn't decrypt.
    pub(crate) async fn send_retry_receipt(
        self: &Arc<Self>,
        node: &Node,
        info: &MessageInfo,
        force_include_identity: bool,
    ) {
        let id = match node.attrs.get("id") {
            Some(AttributeValue::String(id)) => id.clone(),
            _ => String::new(),
        };
        let children = node.get_children();
        let retry_count_in_message = if children.len() == 1 && children[0].tag == "enc" {
            children[0].attr_getter().optional_int("count")
        } else {
            0
        };
        let retry_count = {
            let mut retries = lock(&self.message_retries);
            let count = retries.entry(id.clone()).or_default();
            *count += 1;
            // If this is a retry response and we restarted in between, take
            // the count from the message.
            if *count == 1 && retry_count_in_message > 0 {
                *count = retry_count_in_message + 1;
            }
            *count
        };
        if retry_count >= 5 {
            tracing::warn!("not sending any more retry receipts");
            return;
        }
        if retry_count == 1 {
            if self.config.synchronous_ack {
                self.immediate_request_message_from_phone(info).await;
            } else {
                let client = Arc::clone(self);
                let info = info.clone();
                self.spawn(client.delayed_request_message_from_phone(info));
            }
        }

        let (registration_id, identity_public, signed_pre_key, account, pre_keys) = {
            let store = self.store.read().await;
            (
                store.registration_id,
                store.identity_key.public,
                store.signed_pre_key.clone(),
                store.account.clone(),
                Arc::clone(&store.pre_keys),
            )
        };
        let mut attrs = crate::receipt::build_base_receipt(&info.id, node);
        attrs.insert("type".to_owned(), "retry".into());
        if info.r#type == "peer_msg" && info.is_from_me {
            attrs.insert("category".to_owned(), "peer".into());
        }
        let mut retry_attrs = Attrs::from([
            ("count".to_owned(), retry_count.into()),
            ("id".to_owned(), id.clone().into()),
            ("v".to_owned(), 1_i64.into()),
        ]);
        if let Some(timestamp) = node.attrs.get("t") {
            retry_attrs.insert("t".to_owned(), timestamp.clone());
        }
        let mut content = vec![
            Node {
                tag: "retry".to_owned(),
                attrs: retry_attrs,
                content: None,
            },
            Node {
                tag: "registration".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Bytes(registration_id.to_be_bytes().to_vec())),
            },
        ];
        if retry_count > 1 || force_include_identity {
            match pre_keys.gen_one_pre_key().await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to get prekey for retry receipt")
                }
                Ok(key) => {
                    let device_identity = account.unwrap_or_default().encode_to_vec();
                    let bytes = |tag: &str, data: Vec<u8>| Node {
                        tag: tag.to_owned(),
                        attrs: Attrs::new(),
                        content: Some(NodeContent::Bytes(data)),
                    };
                    content.push(Node {
                        tag: "keys".to_owned(),
                        attrs: Attrs::new(),
                        content: Some(NodeContent::Nodes(vec![
                            bytes("type", vec![DJB_TYPE]),
                            bytes("identity", identity_public.to_vec()),
                            pre_key_to_node(&key),
                            pre_key_to_node(&signed_pre_key),
                            bytes("device-identity", device_identity),
                        ])),
                    });
                }
            }
        }
        let payload = Node {
            tag: "receipt".to_owned(),
            attrs,
            content: Some(NodeContent::Nodes(content)),
        };
        if let Err(error) = self.send_node(&payload).await {
            tracing::error!(error = %error, "failed to send retry receipt");
        }
    }

    /// Handles a retry receipt for one of our messages; acks it afterwards.
    pub(crate) async fn try_handle_retry_receipt(self: &Arc<Self>, receipt: &Receipt, node: &Node) {
        let ack = self.maybe_deferred_ack(node);
        let mut cancelled = false;
        if let Err(error) = self.handle_retry_receipt(receipt, node).await {
            tracing::error!(error = %error, "failed to handle retry receipt");
            cancelled = matches!(error.innermost(), ClientError::NotConnected);
        }
        self.finish_deferred_ack(ack, cancelled).await;
    }
}
