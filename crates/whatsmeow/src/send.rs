// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow send.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Deviations:
// - Go's variadic `SendRequestExtra` is an explicit [`SendRequestExtra`]
//   argument; `MessageDebugTimings` is not ported (each phase is a span).
// - Not ported: newsletters, bots (inline bot mode, Muse/WASA encryption),
//   broadcast lists (`ErrBroadcastListUnsupported`), reporting tokens,
//   `SetDisappearingTimer` for groups.

//! Sending messages: 1:1 and group fan-out, peer messages to our own
//! devices, and builders for revokes, reactions, edits and requests.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use chrono::{DateTime, Utc};
use prost::Message as _;
use sha2::{Digest, Sha256};
use tracing::Instrument;

use crate::binary::{AttributeValue, Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::message::pad_message;
use crate::proto::wa_common::MessageKey;
use crate::proto::wa_e2e::{
    self, KeepType, PeerDataOperationRequestType, peer_data_operation_request_message,
    protocol_message,
};
use crate::request::{DEFAULT_REQUEST_TIMEOUT, is_disconnect_node};
use crate::signal::{CiphertextType, PreKeyBundle, SignalError};
use crate::store::SessionCache;
use crate::types::events::DecryptFailMode;
use crate::types::{
    AddressingMode, BOT_SERVER, BROADCAST_SERVER, DEFAULT_USER_SERVER, EditAttribute, GROUP_SERVER,
    HIDDEN_USER_SERVER, HOSTED_LID_SERVER, HOSTED_SERVER, Jid, MESSENGER_SERVER, MessageId,
    MessageInfo, MessageServerId, MsgMetaInfo, NEWSLETTER_SERVER,
};

/// The prefix of message IDs WhatsApp web generates.
pub const WEB_MESSAGE_ID_PREFIX: &str = "3EB0";

/// How long a message can be edited after it was sent.
pub const EDIT_WINDOW: Duration = Duration::from_secs(20 * 60);

/// The reaction text that removes a reaction.
pub const REMOVE_REACTION_TEXT: &str = "";

/// What [`Client::send_message`] returns once the server acked the message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SendResponse {
    /// The message timestamp returned by the server.
    pub timestamp: Option<DateTime<Utc>>,
    /// The ID of the sent message.
    pub id: MessageId,
    /// The server ID (newsletters only).
    pub server_id: MessageServerId,
    /// The identity the message was sent with (LID or phone number).
    pub sender: Jid,
    /// The chat the message was actually sent to.
    pub chat: Jid,
}

/// The optional parameters of [`Client::send_message`].
#[derive(Clone, Debug, Default)]
pub struct SendRequestExtra {
    /// The message ID; a new one is generated when empty.
    pub id: MessageId,
    /// Send as a peer message to our own devices (protocol messages such as
    /// app state key requests).
    pub peer: bool,
    /// How long to wait for the server's ack; zero means
    /// [`DEFAULT_REQUEST_TIMEOUT`], `None` waits forever.
    pub timeout: Option<Duration>,
    /// The `<meta>` node attributes (threads).
    pub meta: Option<MsgMetaInfo>,
    /// Extra nodes to append to the message node; use only if you know what
    /// you are doing.
    pub additional_nodes: Vec<Node>,
    /// Refuse to send to read-only groups where we aren't admin.
    pub check_permissions: bool,
    /// Don't resend the message after reconnecting when the websocket drops
    /// before the server acked it; return a disconnect error instead, so the
    /// caller can record the outcome as unknown. Not in whatsmeow: #8304
    /// carried this as a patch (`NoDisconnectRetry`).
    pub no_disconnect_retry: bool,
}

/// Extra parts of the message node (`nodeExtraParams`).
#[derive(Clone, Debug, Default)]
pub(crate) struct NodeExtraParams {
    pub(crate) meta_node: Option<Node>,
    pub(crate) additional_nodes: Vec<Node>,
    pub(crate) addressing_mode: Option<AddressingMode>,
    pub(crate) peer_recipient_pn: Jid,
}

fn bytes_node(tag: &str, data: Vec<u8>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(data)),
    }
}

impl Client {
    /// A new message ID: `3EB0` and a hash of the time, our user and random
    /// bytes, as WhatsApp web does.
    pub async fn generate_message_id(&self) -> MessageId {
        let own_id = self.get_own_id().await;
        generate_message_id_with(&own_id, Utc::now().timestamp(), &rand::random::<[u8; 16]>())
    }

    /// Sends a message and waits for the server's ack.
    ///
    /// `to` is a user (phone number or LID, no device) or a group. Media must
    /// be uploaded first with [`Client::upload`].
    #[tracing::instrument(
        name = "whatsmeow.send_message",
        skip_all,
        fields(message_id, is_group = to.server == GROUP_SERVER, peer = extra.peer),
        err
    )]
    pub async fn send_message(
        self: &Arc<Self>,
        to: &Jid,
        mut message: wa_e2e::Message,
        extra: SendRequestExtra,
    ) -> Result<SendResponse, ClientError> {
        let mut to = to.clone();
        if to.device > 0 && !extra.peer {
            return Err(ClientError::RecipientAdJid);
        }
        let mut own_id = self.get_own_id().await;
        if own_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        let id = if extra.id.is_empty() {
            self.generate_message_id().await
        } else {
            extra.id.clone()
        };
        tracing::Span::current().record("message_id", id.as_str());
        let mut response = SendResponse {
            id: id.clone(),
            ..SendResponse::default()
        };

        let mut extra_params = NodeExtraParams::default();
        let mut group_participants = Vec::new();
        let mut cached_group = None;
        if to.server == GROUP_SERVER {
            let cached = self
                .get_cached_group_data(&to)
                .await
                .map_err(|error| error.wrap("failed to get group members"))?;
            group_participants = cached.members.clone();
            // whatsmeow notes this is fairly hacky: the identity a message is
            // sent with follows the group's addressing mode.
            if cached.addressing_mode == AddressingMode::Lid {
                own_id = self.get_own_lid().await;
                extra_params.addressing_mode = Some(AddressingMode::Lid);
            } else if cached.community_announcement_group && extra.meta.is_some() {
                own_id = self.get_own_lid().await;
                extra_params.addressing_mode = Some(AddressingMode::Pn);
            }
            cached_group = Some(cached);
        } else if to.server == BROADCAST_SERVER {
            return Err(ClientError::BroadcastListUnsupported);
        } else if to.server == HIDDEN_USER_SERVER {
            own_id = self.get_own_lid().await;
            let lids = Arc::clone(&self.store.read().await.lids);
            match lids.get_pn_for_lid(&to).await {
                Ok(pn) => extra_params.peer_recipient_pn = pn.unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(error = %error, "failed to get peer recipient phone number")
                }
            }
        } else if to.server == DEFAULT_USER_SERVER && !extra.peer {
            let lids = Arc::clone(&self.store.read().await.lids);
            let mut to_lid = lids
                .get_lid_for_pn(&to)
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to get LID for phone number")
                })?
                .unwrap_or_default();
            if to_lid.is_empty() {
                tracing::debug!("LID for recipient not found, fetching user info");
                let info = self
                    .get_user_info(std::slice::from_ref(&to))
                    .await
                    .map_err(|error| error.wrap("failed to get user info to fill LID cache"))?;
                to_lid = info
                    .get(&to)
                    .map(|info| info.lid.clone())
                    .unwrap_or_default();
                if to_lid.is_empty() {
                    return Err(ClientError::Other(
                        "no LID found for recipient from server".to_owned(),
                    ));
                }
            }
            extra_params.peer_recipient_pn = to.clone();
            to = to_lid;
            own_id = self.get_own_lid().await;
        }
        if let Some(meta) = &extra.meta {
            let mut attrs = Attrs::new();
            if let Some(deprecated) = meta.deprecated_lid_session {
                attrs.insert("deprecated_lid_session".to_owned(), deprecated.into());
            }
            if !meta.thread_message_id.is_empty() {
                attrs.insert(
                    "thread_msg_id".to_owned(),
                    meta.thread_message_id.clone().into(),
                );
                attrs.insert(
                    "thread_msg_sender_jid".to_owned(),
                    meta.thread_message_sender_jid.clone().into(),
                );
            }
            extra_params.meta_node = Some(Node {
                tag: "meta".to_owned(),
                attrs,
                content: None,
            });
        }
        extra_params.additional_nodes = extra.additional_nodes.clone();

        response.sender = own_id.clone();
        response.chat = to.clone();

        // Sending several messages at once can cause weird issues and makes
        // retries unsafe; it also protects the session prefetching.
        let _send_lock = self
            .message_send_lock
            .lock()
            .instrument(tracing::info_span!("whatsmeow.send_message.queue"))
            .await;

        // Peer message retries aren't implemented.
        if !extra.peer {
            self.add_recent_message(&to, &id, &message).await?;
        }
        if let Some(secret) = message
            .message_context_info
            .as_ref()
            .and_then(|context| context.message_secret.clone())
        {
            let msg_secrets = Arc::clone(&self.store.read().await.msg_secrets);
            match msg_secrets
                .put_message_secret(&to, &own_id, &id, secret)
                .await
            {
                Err(error) => {
                    tracing::warn!(error = %error, "failed to store message secret key for outgoing message")
                }
                Ok(()) => tracing::debug!("stored message secret key for outgoing message"),
            }
        }
        if extra.check_permissions
            && let Some(cached) = &cached_group
            && !cached.can_send(&own_id, &message)
        {
            return Err(ClientError::NoPermissionInGroup);
        }

        let waiter = self.wait_response(&id);
        let sent = match to.server.as_str() {
            GROUP_SERVER => {
                self.send_group(
                    &own_id,
                    &to,
                    &group_participants,
                    &id,
                    &message,
                    extra_params,
                )
                .await
            }
            DEFAULT_USER_SERVER | BOT_SERVER | HIDDEN_USER_SERVER => {
                if extra.peer {
                    self.send_peer_message_node(&to, &id, &mut message)
                        .await
                        .map(|data| (String::new(), data))
                } else {
                    self.send_dm(&own_id, &to, &id, &message, extra_params)
                        .await
                }
            }
            NEWSLETTER_SERVER => Err(ClientError::Other("newsletters aren't ported".to_owned())),
            other => Err(ClientError::Other(format!(
                "{} {other}",
                ClientError::UnknownServer
            ))),
        };
        let (phash, data) = match sent {
            Ok(sent) => sent,
            Err(error) => {
                self.cancel_response(&id);
                return Err(error);
            }
        };
        let timeout = extra.timeout.map(|timeout| {
            if timeout.is_zero() {
                DEFAULT_REQUEST_TIMEOUT
            } else {
                timeout
            }
        });
        let ack = async {
            match timeout {
                Some(timeout) => tokio::time::timeout(timeout, waiter).await.ok(),
                None => Some(waiter.await),
            }
        }
        .instrument(tracing::info_span!("whatsmeow.send_message.wait_ack"))
        .await;
        let response_node = match ack {
            None => {
                self.cancel_response(&id);
                return Err(ClientError::MessageTimedOut);
            }
            Some(Err(_)) => crate::client::xml_stream_end_node(),
            Some(Ok(node)) => node,
        };
        let response_node = if is_disconnect_node(&response_node) && extra.no_disconnect_retry {
            return Err(crate::errors::DisconnectedError {
                action: "message send".to_owned(),
                node: Some(response_node),
            }
            .into());
        } else if is_disconnect_node(&response_node) {
            self.retry_frame("message send", &id, &data, response_node, Duration::ZERO)
                .await?
        } else {
            response_node
        };
        let mut attrs = response_node.attr_getter();
        response.server_id = attrs.optional_int("server_id");
        response.timestamp = attrs.unix_time("t");
        let error_code = attrs.int("error");
        let expected_phash = attrs.optional_string("phash");
        if !expected_phash.is_empty() && phash != expected_phash {
            tracing::warn!(
                "server returned a different participant list hash, some devices may not have received the message"
            );
            match to.server.as_str() {
                GROUP_SERVER => {
                    self.group_cache.lock().await.remove(&to);
                }
                DEFAULT_USER_SERVER | HIDDEN_USER_SERVER | BOT_SERVER | HOSTED_SERVER
                | HOSTED_LID_SERVER => {
                    self.user_devices_cache.lock().await.remove(&to);
                }
                _ => {}
            }
        }
        if error_code != 0 {
            return Err(ClientError::Other(format!(
                "{} {error_code}",
                ClientError::ServerReturnedError
            )));
        }
        Ok(response)
    }

    /// Sends a protocol message to our own devices (app state key requests,
    /// requests to the phone).
    pub async fn send_peer_message(
        self: &Arc<Self>,
        message: wa_e2e::Message,
    ) -> Result<SendResponse, ClientError> {
        let own_id = self.get_own_id().await.to_non_ad();
        if own_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        self.send_message(
            &own_id,
            message,
            SendRequestExtra {
                peer: true,
                timeout: Some(Duration::ZERO),
                ..SendRequestExtra::default()
            },
        )
        .await
    }

    /// A key referring to an earlier message, for replies, revokes and
    /// reactions.
    pub async fn build_message_key(&self, chat: &Jid, sender: &Jid, id: &str) -> MessageKey {
        let own_id = self.get_own_id().await;
        let own_lid = self.get_own_lid().await;
        build_message_key_with(&own_id, &own_lid, chat, sender, id)
    }

    /// A message deleting an earlier message for everyone. Pass an empty
    /// `sender` for our own messages, or the sender as group admin.
    pub async fn build_revoke(&self, chat: &Jid, sender: &Jid, id: &str) -> wa_e2e::Message {
        wa_e2e::Message {
            protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                r#type: Some(protocol_message::Type::Revoke as i32),
                key: Some(self.build_message_key(chat, sender, id).await),
                ..Default::default()
            })),
            ..Default::default()
        }
    }

    /// A reaction to an earlier message; an empty reaction removes it.
    pub async fn build_reaction(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &str,
        reaction: &str,
    ) -> wa_e2e::Message {
        wa_e2e::Message {
            reaction_message: Some(wa_e2e::ReactionMessage {
                key: Some(self.build_message_key(chat, sender, id).await),
                text: Some(reaction.to_owned()),
                sender_timestamp_ms: Some(Utc::now().timestamp_millis()),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// A request asking our primary device to resend a message this device
    /// couldn't decrypt; send it with [`Client::send_peer_message`].
    pub fn build_unavailable_message_request(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &str,
    ) -> wa_e2e::Message {
        let own = self.own_ids_now();
        wa_e2e::Message {
            protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                r#type: Some(protocol_message::Type::PeerDataOperationRequestMessage as i32),
                peer_data_operation_request_message: Some(
                    wa_e2e::PeerDataOperationRequestMessage {
                        peer_data_operation_request_type: Some(
                            PeerDataOperationRequestType::PlaceholderMessageResend as i32,
                        ),
                        placeholder_message_resend_request: vec![
                            peer_data_operation_request_message::PlaceholderMessageResendRequest {
                                message_key: Some(build_message_key_with(
                                    &own.0, &own.1, chat, sender, id,
                                )),
                            },
                        ],
                        ..Default::default()
                    },
                ),
                ..Default::default()
            })),
            ..Default::default()
        }
    }

    /// A request for `count` messages before the given one from our primary
    /// device; the answer comes as an on-demand [`crate::Event::HistorySync`].
    pub fn build_history_sync_request(
        &self,
        last_known_message_info: &MessageInfo,
        count: i32,
    ) -> wa_e2e::Message {
        wa_e2e::Message {
            protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                r#type: Some(protocol_message::Type::PeerDataOperationRequestMessage as i32),
                peer_data_operation_request_message: Some(
                    wa_e2e::PeerDataOperationRequestMessage {
                        peer_data_operation_request_type: Some(
                            PeerDataOperationRequestType::HistorySyncOnDemand as i32,
                        ),
                        history_sync_on_demand_request: Some(
                            peer_data_operation_request_message::HistorySyncOnDemandRequest {
                                chat_jid: Some(last_known_message_info.chat.to_string()),
                                oldest_msg_id: Some(last_known_message_info.id.clone()),
                                oldest_msg_from_me: Some(last_known_message_info.is_from_me),
                                on_demand_msg_count: Some(count),
                                // Despite the name, this holds seconds.
                                oldest_msg_timestamp_ms: last_known_message_info
                                    .timestamp
                                    .map(|timestamp| timestamp.timestamp()),
                                ..Default::default()
                            },
                        ),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            })),
            ..Default::default()
        }
    }

    async fn send_group(
        self: &Arc<Self>,
        own_id: &Jid,
        to: &Jid,
        participants: &[Jid],
        id: &str,
        message: &wa_e2e::Message,
        extra_params: NodeExtraParams,
    ) -> Result<(String, Vec<u8>), ClientError> {
        let (plaintext, _) = marshal_message(to, message);
        let own_lid = self.get_own_lid().await;
        let sender_key_name = crate::signal::SenderKeyName {
            group_id: to.to_string(),
            sender: own_lid.signal_address(),
        };
        let (skd_plaintext, ciphertext) = async {
            let store = self.store.read().await;
            let signal_store = store.signal_store(None);
            let skdm = self
                .signal
                .create_sender_key_distribution_message(&signal_store, &sender_key_name)
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap(
                        "failed to create sender key distribution message to send group message",
                    )
                })?;
            let skd_message = wa_e2e::Message {
                sender_key_distribution_message: Some(wa_e2e::SenderKeyDistributionMessage {
                    group_id: Some(to.to_string()),
                    axolotl_sender_key_distribution_message: Some(skdm),
                }),
                ..Default::default()
            };
            let ciphertext = self
                .signal
                .group_encrypt(
                    &signal_store,
                    &sender_key_name,
                    &pad_message(plaintext.clone()),
                )
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to encrypt group message")
                })?;
            Ok::<_, ClientError>((skd_message.encode_to_vec(), ciphertext))
        }
        .instrument(tracing::info_span!("whatsmeow.send_message.group_encrypt"))
        .await?;

        let (mut node, all_devices) = self
            .prepare_message_node(
                to,
                id,
                message,
                participants,
                &skd_plaintext,
                None,
                &extra_params,
            )
            .await?;
        let phash = participant_list_hash_v2(&all_devices);
        node.attrs.insert("phash".to_owned(), phash.clone().into());
        let mut sk_attrs = Attrs::from([
            ("v".to_owned(), "2".into()),
            ("type".to_owned(), "skmsg".into()),
        ]);
        let media_type = get_media_type_from_message(message);
        if !media_type.is_empty() {
            sk_attrs.insert("mediatype".to_owned(), media_type.into());
        }
        push_child(
            &mut node,
            Node {
                tag: "enc".to_owned(),
                attrs: sk_attrs,
                content: Some(NodeContent::Bytes(ciphertext)),
            },
        );
        let _ = own_id;
        let data = self
            .send_node_and_get_data(&node)
            .instrument(tracing::info_span!("whatsmeow.send_message.send"))
            .await
            .map_err(|error| error.wrap("failed to send message node"))?;
        Ok((phash, data))
    }

    async fn send_peer_message_node(
        self: &Arc<Self>,
        to: &Jid,
        id: &str,
        message: &mut wa_e2e::Message,
    ) -> Result<Vec<u8>, ClientError> {
        let node = self.prepare_peer_message_node(to, id, message).await?;
        self.send_node_and_get_data(&node)
            .await
            .map_err(|error| error.wrap("failed to send message node"))
    }

    async fn send_dm(
        self: &Arc<Self>,
        own_id: &Jid,
        to: &Jid,
        id: &str,
        message: &wa_e2e::Message,
        extra_params: NodeExtraParams,
    ) -> Result<(String, Vec<u8>), ClientError> {
        let (message_plaintext, device_sent_plaintext) = marshal_message(to, message);
        let (mut node, all_devices) = self
            .prepare_message_node(
                to,
                id,
                message,
                &[to.clone(), own_id.to_non_ad()],
                &message_plaintext,
                device_sent_plaintext.as_deref(),
                &extra_params,
            )
            .await?;
        let phash = participant_list_hash_v2(&all_devices);

        let tc_token = self.ensure_tc_token(to).await.unwrap_or_else(|error| {
            tracing::warn!(error = %error, "failed to get privacy token");
            None
        });
        if let Some(token) = tc_token.filter(|token| !token.is_empty()) {
            push_child(&mut node, bytes_node("tctoken", token));
        } else if let Some(cs_token) = self.generate_cs_token(to).await {
            push_child(&mut node, bytes_node("cstoken", cs_token));
        }

        let data = self
            .send_node_and_get_data(&node)
            .instrument(tracing::info_span!("whatsmeow.send_message.send"))
            .await
            .map_err(|error| error.wrap("failed to send message node"))?;

        let storage_jid = self.resolve_tc_token_storage_lid(to).await;
        if crate::tctoken::should_send_tc_token_in_chat_action(to)
            && crate::tctoken::should_send_new_tc_token(self.get_tc_token_sender_ts(&storage_jid))
        {
            let client = Arc::clone(self);
            self.spawn(async move {
                client
                    .issue_privacy_token_and_save(storage_jid, Utc::now())
                    .await;
            });
        }
        Ok((phash, data))
    }

    async fn prepare_peer_message_node(
        self: &Arc<Self>,
        to: &Jid,
        id: &str,
        message: &wa_e2e::Message,
    ) -> Result<Node, ClientError> {
        let mut attrs = Attrs::from([
            ("id".to_owned(), id.into()),
            ("type".to_owned(), "text".into()),
            ("category".to_owned(), "peer".into()),
            ("to".to_owned(), to.into()),
        ]);
        let protocol = message.protocol_message.as_deref();
        if protocol.and_then(|protocol| protocol.r#type)
            == Some(protocol_message::Type::AppStateSyncKeyRequest as i32)
        {
            attrs.insert("push_priority".to_owned(), "high".into());
        } else if protocol
            .and_then(|protocol| protocol.peer_data_operation_request_message.as_ref())
            .and_then(|request| request.peer_data_operation_request_type)
            == Some(PeerDataOperationRequestType::HistorySyncOnDemand as i32)
        {
            attrs.insert("push_priority".to_owned(), "high_force".into());
            attrs.insert("privacy_sensitive".to_owned(), "1".into());
        }
        let plaintext = message.encode_to_vec();
        let mut encryption_identity = to.clone();
        if to.server == DEFAULT_USER_SERVER {
            let lids = Arc::clone(&self.store.read().await.lids);
            encryption_identity = lids
                .get_lid_for_pn(to)
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to get LID for phone number")
                })?
                .unwrap_or_default();
        }
        let (encrypted, is_pre_key) = self
            .encrypt_message_for_device(
                &plaintext,
                &encryption_identity,
                None,
                &Attrs::new(),
                None,
                None,
            )
            .await
            .map_err(|error| error.wrap("failed to encrypt peer message"))?;
        let mut content = vec![
            Node {
                tag: "meta".to_owned(),
                attrs: Attrs::from([("appdata".to_owned(), "default".into())]),
                content: None,
            },
            encrypted,
        ];
        if is_pre_key {
            content.push(self.make_device_identity_node().await);
        }
        Ok(Node {
            tag: "message".to_owned(),
            attrs,
            content: Some(NodeContent::Nodes(content)),
        })
    }

    /// The children of a message node after the encrypted part.
    pub(crate) async fn get_message_content(
        &self,
        base_node: Node,
        message: &wa_e2e::Message,
        message_attrs: &Attrs,
        include_identity: bool,
        extra_params: &NodeExtraParams,
    ) -> Vec<Node> {
        let mut content = vec![base_node];
        if include_identity {
            content.push(self.make_device_identity_node().await);
        }
        if matches!(message_attrs.get("type"), Some(AttributeValue::String(kind)) if kind == "poll")
        {
            let poll_type = if message.poll_update_message.is_some() {
                "vote"
            } else {
                "creation"
            };
            content.push(Node {
                tag: "meta".to_owned(),
                attrs: Attrs::from([("polltype".to_owned(), poll_type.into())]),
                content: None,
            });
        }
        if let Some(meta_node) = &extra_params.meta_node {
            content.push(meta_node.clone());
        }
        content.extend(extra_params.additional_nodes.iter().cloned());
        let button_type = get_button_type_from_message(message);
        if !button_type.is_empty() {
            content.push(Node {
                tag: "biz".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: button_type.to_owned(),
                    attrs: get_button_attributes(message),
                    content: None,
                }])),
            });
        }
        content
    }

    #[expect(clippy::too_many_arguments, reason = "mirrors Go's prepareMessageNode")]
    async fn prepare_message_node(
        self: &Arc<Self>,
        to: &Jid,
        id: &str,
        message: &wa_e2e::Message,
        participants: &[Jid],
        plaintext: &[u8],
        device_sent_plaintext: Option<&[u8]>,
        extra_params: &NodeExtraParams,
    ) -> Result<(Node, Vec<Jid>), ClientError> {
        let mut all_devices = self
            .get_user_devices(participants)
            .instrument(tracing::info_span!("whatsmeow.send_message.get_devices"))
            .await
            .map_err(|error| error.wrap("failed to get device list"))?;
        if to.server == GROUP_SERVER {
            all_devices
                .retain(|jid| jid.server != HOSTED_SERVER && jid.server != HOSTED_LID_SERVER);
        }
        let message_type = get_type_from_message(message);
        let mut enc_attrs = Attrs::new();
        // Only 1:1 messages (with a device sent plaintext) carry the media type.
        let enc_media_type = get_media_type_from_message(message);
        if device_sent_plaintext.is_some() && !enc_media_type.is_empty() {
            enc_attrs.insert("mediatype".to_owned(), enc_media_type.into());
        }
        let mut attrs = Attrs::from([
            ("id".to_owned(), id.into()),
            ("type".to_owned(), message_type.into()),
            ("to".to_owned(), to.into()),
        ]);
        if !extra_params.peer_recipient_pn.is_empty() {
            attrs.insert(
                "peer_recipient_pn".to_owned(),
                extra_params.peer_recipient_pn.clone().into(),
            );
        }
        if let Some(addressing_mode) = &extra_params.addressing_mode {
            attrs.insert(
                "addressing_mode".to_owned(),
                addressing_mode.as_str().into(),
            );
        }
        let edit = get_edit_attribute(message);
        if edit != EditAttribute::Empty {
            attrs.insert("edit".to_owned(), edit.as_str().into());
            enc_attrs.insert(
                "decrypt-fail".to_owned(),
                DecryptFailMode::Hide.as_str().into(),
            );
        }
        if message_type == "reaction" || message.poll_update_message.is_some() {
            enc_attrs.insert(
                "decrypt-fail".to_owned(),
                DecryptFailMode::Hide.as_str().into(),
            );
        }
        let (participant_nodes, include_identity) = self
            .encrypt_message_for_devices(
                &all_devices,
                id,
                plaintext,
                device_sent_plaintext,
                &enc_attrs,
            )
            .instrument(tracing::info_span!(
                "whatsmeow.send_message.peer_encrypt",
                devices = all_devices.len()
            ))
            .await?;
        let participant_node = Node {
            tag: "participants".to_owned(),
            attrs: Attrs::new(),
            content: Some(NodeContent::Nodes(participant_nodes)),
        };
        let content = self
            .get_message_content(
                participant_node,
                message,
                &attrs,
                include_identity,
                extra_params,
            )
            .await;
        Ok((
            Node {
                tag: "message".to_owned(),
                attrs,
                content: Some(NodeContent::Nodes(content)),
            },
            all_devices,
        ))
    }

    /// The `<device-identity>` node with our account signature.
    pub(crate) async fn make_device_identity_node(&self) -> Node {
        let account = self.store.read().await.account.clone().unwrap_or_default();
        bytes_node("device-identity", account.encode_to_vec())
    }

    async fn encrypt_message_for_devices(
        self: &Arc<Self>,
        all_devices: &[Jid],
        id: &str,
        message_plaintext: &[u8],
        device_sent_plaintext: Option<&[u8]>,
        enc_attrs: &Attrs,
    ) -> Result<(Vec<Node>, bool), ClientError> {
        let own_jid = self.get_own_id().await;
        let own_lid = self.get_own_lid().await;
        let mut include_identity = false;
        let mut participant_nodes = Vec::with_capacity(all_devices.len());

        let pn_devices: Vec<Jid> = all_devices
            .iter()
            .filter(|jid| jid.server == DEFAULT_USER_SERVER)
            .cloned()
            .collect();
        let lids = Arc::clone(&self.store.read().await.lids);
        let lid_mappings = lids
            .get_many_lids_for_pns(&pn_devices)
            .await
            .map_err(|error| ClientError::from(error).wrap("failed to fetch LID mappings"))?;

        let mut encryption_identities = HashMap::with_capacity(all_devices.len());
        let mut session_address_to_jid = HashMap::with_capacity(all_devices.len());
        let mut session_addresses = Vec::with_capacity(all_devices.len());
        for jid in all_devices {
            if *jid == own_jid || *jid == own_lid {
                continue;
            }
            let mut encryption_identity = jid.clone();
            if jid.server == DEFAULT_USER_SERVER
                && let Some(lid_for_pn) = lid_mappings.get(jid).filter(|lid| !lid.is_empty())
            {
                self.migrate_session_store_for_send(jid, lid_for_pn).await;
                encryption_identity = lid_for_pn.clone();
            }
            let address = encryption_identity.signal_address().to_string();
            encryption_identities.insert(jid.clone(), encryption_identity);
            session_addresses.push(address.clone());
            session_address_to_jid.insert(address, jid.clone());
        }

        let (existing_sessions, cache) = self
            .store
            .read()
            .await
            .with_cached_sessions(&session_addresses)
            .await
            .map_err(|error| ClientError::from(error).wrap("failed to prefetch sessions"))?;
        let retry_devices: Vec<Jid> = existing_sessions
            .iter()
            .filter(|(_, exists)| !**exists)
            .filter_map(|(address, _)| session_address_to_jid.get(address).cloned())
            .collect();
        let bundles = self.fetch_pre_keys_no_error(&retry_devices).await;

        for jid in all_devices {
            if *jid == own_jid || *jid == own_lid {
                continue;
            }
            let plaintext = match device_sent_plaintext {
                Some(device_sent) if jid.user == own_jid.user || jid.user == own_lid.user => {
                    device_sent
                }
                _ => message_plaintext,
            };
            let Some(encryption_identity) = encryption_identities.get(jid) else {
                continue;
            };
            let result = self
                .encrypt_message_for_device(
                    plaintext,
                    encryption_identity,
                    bundles.get(jid),
                    enc_attrs,
                    Some(&existing_sessions),
                    cache.as_ref(),
                )
                .await;
            match result {
                Err(error) => {
                    tracing::warn!(error = %error, message_id = id, "failed to encrypt message for a device");
                    continue;
                }
                Ok((encrypted, is_pre_key)) => {
                    participant_nodes.push(Node {
                        tag: "to".to_owned(),
                        attrs: Attrs::from([("jid".to_owned(), jid.into())]),
                        content: Some(NodeContent::Nodes(vec![encrypted])),
                    });
                    include_identity |= is_pre_key;
                }
            }
        }
        if let Some(cache) = &cache {
            self.store
                .read()
                .await
                .put_cached_sessions(cache)
                .await
                .map_err(|error| ClientError::from(error).wrap("failed to save cached sessions"))?;
        }
        Ok((participant_nodes, include_identity))
    }

    async fn migrate_session_store_for_send(&self, pn: &Jid, lid: &Jid) {
        let sessions = Arc::clone(&self.store.read().await.sessions);
        if let Err(error) = sessions.migrate_pn_to_lid(pn, lid).await {
            tracing::error!(error = %error, "failed to migrate signal store from phone number to LID");
        }
    }

    /// Encrypts a padded plaintext for one device, starting a session from
    /// the bundle when there is one. Returns the `<enc>` node and whether it
    /// is a prekey message (which needs our device identity alongside).
    pub(crate) async fn encrypt_message_for_device(
        self: &Arc<Self>,
        plaintext: &[u8],
        to: &Jid,
        bundle: Option<&PreKeyBundle>,
        extra_attrs: &Attrs,
        existing_sessions: Option<&HashMap<String, bool>>,
        cache: Option<&SessionCache>,
    ) -> Result<(Node, bool), ClientError> {
        let address = to.signal_address();
        if let Some(bundle) = bundle {
            tracing::debug!("processing prekey bundle");
            let mut result = self.process_bundle_once(&address, bundle, cache).await;
            if self.config.auto_trust_identity
                && matches!(result, Err(SignalError::UntrustedIdentity))
            {
                tracing::warn!(
                    "untrusted identity while processing prekey bundle, clearing stored identity and retrying"
                );
                self.clear_untrusted_identity_for_send(to)
                    .await
                    .map_err(|error| error.wrap("failed to clear untrusted identity"))?;
                result = self.process_bundle_once(&address, bundle, cache).await;
            }
            result.map_err(|error| {
                ClientError::from(error).wrap("failed to process prekey bundle")
            })?;
        } else {
            let session_exists =
                match existing_sessions.and_then(|sessions| sessions.get(&address.to_string())) {
                    Some(exists) => *exists,
                    None => {
                        let store = self.store.read().await;
                        store.sessions.has_session(&address.to_string()).await?
                    }
                };
            if !session_exists {
                return Err(ClientError::NoSession.wrap(format!("with {address}")));
            }
        }
        let ciphertext = {
            let store = self.store.read().await;
            let signal_store = store.signal_store(cache);
            self.signal
                .encrypt(&signal_store, &address, &pad_message(plaintext.to_vec()))
                .await
                .map_err(|error| ClientError::from(error).wrap("cipher encryption failed"))?
        };
        let mut attrs = Attrs::from([
            ("v".to_owned(), "2".into()),
            ("type".to_owned(), "msg".into()),
        ]);
        if ciphertext.kind == CiphertextType::PreKey {
            attrs.insert("type".to_owned(), "pkmsg".into());
        }
        for (key, value) in extra_attrs {
            attrs.insert(key.clone(), value.clone());
        }
        let include_device_identity =
            matches!(attrs.get("type"), Some(AttributeValue::String(kind)) if kind == "pkmsg");
        Ok((
            Node {
                tag: "enc".to_owned(),
                attrs,
                content: Some(NodeContent::Bytes(ciphertext.serialized)),
            },
            include_device_identity,
        ))
    }

    async fn process_bundle_once(
        &self,
        address: &crate::signal::SignalAddress,
        bundle: &PreKeyBundle,
        cache: Option<&SessionCache>,
    ) -> Result<(), SignalError> {
        let store = self.store.read().await;
        let signal_store = store.signal_store(cache);
        self.signal
            .process_bundle(&signal_store, address, bundle)
            .await
    }

    async fn clear_untrusted_identity_for_send(
        self: &Arc<Self>,
        target: &Jid,
    ) -> Result<(), ClientError> {
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
        self.spawn_dispatch(crate::Event::IdentityChange(
            crate::types::events::IdentityChange {
                jid: target.clone(),
                timestamp: Some(Utc::now()),
                implicit: true,
            },
        ));
        Ok(())
    }

    /// Our JID and LID without awaiting the store lock, for the synchronous
    /// builders; empty if the store is being written.
    fn own_ids_now(&self) -> (Jid, Jid) {
        match self.store.try_read() {
            Ok(store) => (store.get_jid(), store.get_lid()),
            Err(_) => (Jid::default(), Jid::default()),
        }
    }
}

fn push_child(node: &mut Node, child: Node) {
    match &mut node.content {
        Some(NodeContent::Nodes(children)) => children.push(child),
        _ => node.content = Some(NodeContent::Nodes(vec![child])),
    }
}

/// `GenerateMessageID` with its inputs as parameters, for tests.
pub fn generate_message_id_with(own_id: &Jid, unix_seconds: i64, random: &[u8; 16]) -> MessageId {
    let mut data = Vec::with_capacity(8 + 20 + 16);
    data.extend_from_slice(
        &u64::try_from(unix_seconds)
            .unwrap_or_default()
            .to_be_bytes(),
    );
    if !own_id.is_empty() {
        data.extend_from_slice(own_id.user.as_bytes());
        data.extend_from_slice(b"@c.us");
    }
    data.extend_from_slice(random);
    let hash = Sha256::digest(&data);
    format!("{WEB_MESSAGE_ID_PREFIX}{}", hex::encode_upper(&hash[..9]))
}

/// `BuildMessageKey` with our JIDs as parameters.
pub fn build_message_key_with(
    own_id: &Jid,
    own_lid: &Jid,
    chat: &Jid,
    sender: &Jid,
    id: &str,
) -> MessageKey {
    let mut key = MessageKey {
        from_me: Some(true),
        id: Some(id.to_owned()),
        remote_jid: Some(chat.to_string()),
        participant: None,
    };
    if !sender.is_empty() && sender.user != own_id.user && sender.user != own_lid.user {
        key.from_me = Some(false);
        if chat.server != DEFAULT_USER_SERVER
            && chat.server != HIDDEN_USER_SERVER
            && chat.server != MESSENGER_SERVER
        {
            key.participant = Some(sender.to_non_ad().to_string());
        }
    }
    key
}

/// An edit replacing an earlier message's content.
pub fn build_edit(chat: &Jid, id: &str, new_content: wa_e2e::Message) -> wa_e2e::Message {
    wa_e2e::Message {
        edited_message: Some(Box::new(wa_e2e::FutureProofMessage {
            message: Some(Box::new(wa_e2e::Message {
                protocol_message: Some(Box::new(wa_e2e::ProtocolMessage {
                    key: Some(MessageKey {
                        from_me: Some(true),
                        id: Some(id.to_owned()),
                        remote_jid: Some(chat.to_string()),
                        participant: None,
                    }),
                    r#type: Some(protocol_message::Type::MessageEdit as i32),
                    edited_message: Some(Box::new(new_content)),
                    timestamp_ms: Some(Utc::now().timestamp_millis()),
                    ..Default::default()
                })),
                ..Default::default()
            })),
        })),
        ..Default::default()
    }
}

/// The participant hash of a device list: `2:` and the base64 of the first
/// six bytes of SHA-256 over the sorted AD strings.
pub fn participant_list_hash_v2(participants: &[Jid]) -> String {
    let mut participant_strings: Vec<String> = participants.iter().map(Jid::ad_string).collect();
    participant_strings.sort();
    let hash = Sha256::digest(participant_strings.concat().as_bytes());
    format!("2:{}", STANDARD_NO_PAD.encode(&hash[..6]))
}

/// The protobuf of a message, and for chats other than groups the
/// `DeviceSentMessage` our other devices get.
pub(crate) fn marshal_message(to: &Jid, message: &wa_e2e::Message) -> (Vec<u8>, Option<Vec<u8>>) {
    let plaintext = message.encode_to_vec();
    let device_sent = (to.server != GROUP_SERVER && to.server != NEWSLETTER_SERVER).then(|| {
        wa_e2e::Message {
            device_sent_message: Some(Box::new(wa_e2e::DeviceSentMessage {
                destination_jid: Some(to.to_string()),
                message: Some(Box::new(message.clone())),
                phash: None,
            })),
            message_context_info: message.message_context_info.clone(),
            ..Default::default()
        }
        .encode_to_vec()
    });
    (plaintext, device_sent)
}

fn inner(wrapper: Option<&wa_e2e::FutureProofMessage>) -> Option<&wa_e2e::Message> {
    wrapper.and_then(|wrapper| wrapper.message.as_deref())
}

fn unwrapped(message: &wa_e2e::Message) -> Option<&wa_e2e::Message> {
    if message.view_once_message.is_some() {
        return inner(message.view_once_message.as_deref());
    }
    if message.view_once_message_v2.is_some() {
        return inner(message.view_once_message_v2.as_deref());
    }
    if message.view_once_message_v2_extension.is_some() {
        return inner(message.view_once_message_v2_extension.as_deref());
    }
    if message.lottie_sticker_message.is_some() {
        return inner(message.lottie_sticker_message.as_deref());
    }
    if message.ephemeral_message.is_some() {
        return inner(message.ephemeral_message.as_deref());
    }
    if message.document_with_caption_message.is_some() {
        return inner(message.document_with_caption_message.as_deref());
    }
    None
}

fn is_wrapper(message: &wa_e2e::Message) -> bool {
    message.view_once_message.is_some()
        || message.view_once_message_v2.is_some()
        || message.view_once_message_v2_extension.is_some()
        || message.lottie_sticker_message.is_some()
        || message.ephemeral_message.is_some()
        || message.document_with_caption_message.is_some()
}

/// The `type` attribute of a message node.
pub fn get_type_from_message(message: &wa_e2e::Message) -> &'static str {
    if is_wrapper(message) {
        return unwrapped(message).map_or("text", get_type_from_message);
    }
    if message.reaction_message.is_some() || message.enc_reaction_message.is_some() {
        "reaction"
    } else if message.poll_creation_message.is_some() || message.poll_update_message.is_some() {
        "poll"
    } else if !get_media_type_from_message(message).is_empty() {
        "media"
    } else {
        "text"
    }
}

/// The `mediatype` attribute of a message node, empty for non-media.
pub fn get_media_type_from_message(message: &wa_e2e::Message) -> &'static str {
    if is_wrapper(message) {
        return unwrapped(message).map_or("", get_media_type_from_message);
    }
    if message
        .extended_text_message
        .as_ref()
        .is_some_and(|text| text.title.is_some())
    {
        "url"
    } else if message.image_message.is_some() {
        "image"
    } else if message.sticker_message.is_some() {
        "sticker"
    } else if message.document_message.is_some() {
        "document"
    } else if let Some(audio) = &message.audio_message {
        if audio.ptt.unwrap_or_default() {
            "ptt"
        } else {
            "audio"
        }
    } else if let Some(video) = &message.video_message {
        if video.gif_playback.unwrap_or_default() {
            "gif"
        } else {
            "video"
        }
    } else if message.contact_message.is_some() {
        "vcard"
    } else if message.contacts_array_message.is_some() {
        "contact_array"
    } else if message.list_message.is_some() {
        "list"
    } else if message.list_response_message.is_some() {
        "list_response"
    } else if message.buttons_response_message.is_some() {
        "buttons_response"
    } else if message.order_message.is_some() {
        "order"
    } else if message.product_message.is_some() {
        "product"
    } else if message.interactive_response_message.is_some() {
        "native_flow_response"
    } else {
        ""
    }
}

fn get_button_type_from_message(message: &wa_e2e::Message) -> &'static str {
    if message.view_once_message.is_some() {
        return inner(message.view_once_message.as_deref())
            .map_or("", get_button_type_from_message);
    }
    if message.view_once_message_v2.is_some() {
        return inner(message.view_once_message_v2.as_deref())
            .map_or("", get_button_type_from_message);
    }
    if message.ephemeral_message.is_some() {
        return inner(message.ephemeral_message.as_deref())
            .map_or("", get_button_type_from_message);
    }
    if message.buttons_message.is_some() {
        "buttons"
    } else if message.buttons_response_message.is_some() {
        "buttons_response"
    } else if message.list_message.is_some() {
        "list"
    } else if message.list_response_message.is_some() {
        "list_response"
    } else if message.interactive_response_message.is_some() {
        "interactive_response"
    } else {
        ""
    }
}

fn get_button_attributes(message: &wa_e2e::Message) -> Attrs {
    if message.view_once_message.is_some() {
        return inner(message.view_once_message.as_deref())
            .map_or_else(Attrs::new, get_button_attributes);
    }
    if message.view_once_message_v2.is_some() {
        return inner(message.view_once_message_v2.as_deref())
            .map_or_else(Attrs::new, get_button_attributes);
    }
    if message.ephemeral_message.is_some() {
        return inner(message.ephemeral_message.as_deref())
            .map_or_else(Attrs::new, get_button_attributes);
    }
    if message.template_message.is_some() {
        return Attrs::new();
    }
    match &message.list_message {
        Some(list) => {
            let list_type =
                wa_e2e::list_message::ListType::try_from(list.list_type.unwrap_or_default())
                    .map(|list_type| list_type.as_str_name().to_lowercase())
                    .unwrap_or_default();
            Attrs::from([
                ("v".to_owned(), "2".into()),
                ("type".to_owned(), list_type.into()),
            ])
        }
        None => Attrs::new(),
    }
}

/// The `edit` attribute of a message node.
pub fn get_edit_attribute(message: &wa_e2e::Message) -> EditAttribute {
    if let Some(edited) = inner(message.edited_message.as_deref()) {
        return get_edit_attribute(edited);
    }
    if let Some(protocol) = message.protocol_message.as_deref()
        && let Some(key) = &protocol.key
    {
        let protocol_type = protocol.r#type;
        if protocol_type == Some(protocol_message::Type::Revoke as i32) {
            return if key.from_me.unwrap_or_default() {
                EditAttribute::SenderRevoke
            } else {
                EditAttribute::AdminRevoke
            };
        }
        if protocol_type == Some(protocol_message::Type::MessageEdit as i32)
            && protocol.edited_message.is_some()
        {
            return EditAttribute::MessageEdit;
        }
        return EditAttribute::Empty;
    }
    if message.reaction_message.as_ref().is_some_and(|reaction| {
        reaction.text.as_deref().unwrap_or_default() == REMOVE_REACTION_TEXT
    }) {
        return EditAttribute::SenderRevoke;
    }
    if message.keep_in_chat_message.as_ref().is_some_and(|keep| {
        keep.key
            .as_ref()
            .and_then(|key| key.from_me)
            .unwrap_or_default()
            && keep.keep_type == Some(KeepType::UndoKeepForAll as i32)
    }) {
        return EditAttribute::SenderRevoke;
    }
    if message.pin_in_chat_message.is_some() {
        return EditAttribute::PinInChat;
    }
    EditAttribute::Empty
}

#[cfg(test)]
mod test;
