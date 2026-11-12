// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow receipt.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `maybeDeferredAck` returns a closure to `defer`; here it returns a
// [`DeferredAck`] the handler finishes with `finish_deferred_ack`.

//! Receipts: receiving them, sending acks and sending read receipts.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use chrono::{DateTime, Utc};

use crate::binary::{AttributeValue, Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::{ClientError, element_missing};
use crate::types::events::{Event, Receipt};
use crate::types::{
    DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, MESSENGER_SERVER, MessageInfo, NEWSLETTER_SERVER,
    PrivacySetting, ReceiptType,
};

/// The stanza couldn't be parsed.
pub const NACK_PARSING_ERROR: i64 = 487;
/// Unrecognized stanza.
pub const NACK_UNRECOGNIZED_STANZA: i64 = 488;
/// Unrecognized stanza class.
pub const NACK_UNRECOGNIZED_STANZA_CLASS: i64 = 489;
/// Unrecognized stanza type.
pub const NACK_UNRECOGNIZED_STANZA_TYPE: i64 = 490;
/// The protobuf didn't decode.
pub const NACK_INVALID_PROTOBUF: i64 = 491;
/// Invalid hosted companion stanza.
pub const NACK_INVALID_HOSTED_COMPANION_STANZA: i64 = 493;
/// The message secret is missing.
pub const NACK_MISSING_MESSAGE_SECRET: i64 = 495;
/// The Signal counter is old (already decrypted).
pub const NACK_SIGNAL_ERROR_OLD_COUNTER: i64 = 496;
/// The message was deleted on the peer.
pub const NACK_MESSAGE_DELETED_ON_PEER: i64 = 499;
/// An unhandled error.
pub const NACK_UNHANDLED_ERROR: i64 = 500;
/// Admin revokes aren't supported.
pub const NACK_UNSUPPORTED_ADMIN_REVOKE: i64 = 550;
/// LID groups aren't supported.
pub const NACK_UNSUPPORTED_LID_GROUP: i64 = 551;
/// A database operation failed.
pub const NACK_DB_OPERATION_FAILED: i64 = 552;

/// An ack that is sent when the handler finishes (with `synchronous_ack`)
/// or was already sent in the background.
/// The attributes every receipt for a node starts with.
pub(crate) fn build_base_receipt(id: &str, node: &Node) -> Attrs {
    let mut attrs = Attrs::from([("id".to_owned(), id.into())]);
    if let Some(from) = node.attrs.get("from") {
        attrs.insert("to".to_owned(), from.clone());
    }
    if let Some(recipient) = node.attrs.get("recipient") {
        attrs.insert("recipient".to_owned(), recipient.clone());
    }
    if let Some(participant) = node.attrs.get("participant") {
        attrs.insert("participant".to_owned(), participant.clone());
    }
    attrs
}

#[must_use = "finish the ack with Client::finish_deferred_ack"]
pub(crate) struct DeferredAck {
    node: Option<Node>,
}

impl Client {
    pub(crate) async fn handle_receipt(self: &Arc<Self>, node: &Node) {
        match self.parse_receipt(node).await {
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse receipt");
                let client = Arc::clone(self);
                let node = node.clone();
                self.spawn(async move { client.send_ack(&node, NACK_PARSING_ERROR).await });
            }
            Ok((receipt, Some(participants))) => {
                let ack = self.maybe_deferred_ack(node);
                let mut cancelled = false;
                for participants_node in &participants {
                    cancelled = self
                        .handle_grouped_receipt(receipt.clone(), participants_node)
                        .await;
                }
                self.finish_deferred_ack(ack, cancelled).await;
            }
            Ok((receipt, None)) => {
                if receipt.r#type == ReceiptType::Retry {
                    // The retry receipt handler acks by itself.
                    let client = Arc::clone(self);
                    let retry_receipt = receipt.clone();
                    let retry_node = node.clone();
                    self.background_if_async_ack(async move {
                        client
                            .try_handle_retry_receipt(&retry_receipt, &retry_node)
                            .await;
                    })
                    .await;
                    self.dispatch_event(Event::Receipt(receipt)).await;
                } else {
                    let ack = self.maybe_deferred_ack(node);
                    let cancelled = self.dispatch_event(Event::Receipt(receipt)).await;
                    self.finish_deferred_ack(ack, cancelled).await;
                }
            }
        }
    }

    async fn handle_grouped_receipt(&self, partial_receipt: Receipt, participants: &Node) -> bool {
        let mut cancelled = false;
        let mut participants_attrs = participants.attr_getter();
        let mut partial_receipt = partial_receipt;
        partial_receipt.message_ids = vec![participants_attrs.string("key")];
        for child in participants.get_children() {
            if child.tag != "user" {
                tracing::warn!(tag = %child.tag, "unexpected node in grouped receipt participants");
                continue;
            }
            let mut attrs = child.attr_getter();
            let mut receipt = partial_receipt.clone();
            receipt.timestamp = attrs.unix_time("t");
            receipt.source.sender = attrs.jid("jid");
            if !attrs.ok() {
                tracing::warn!("failed to parse user node in grouped receipt");
                continue;
            }
            cancelled = self.dispatch_event(Event::Receipt(receipt)).await || cancelled;
        }
        cancelled
    }

    /// Parses a `<receipt>`; grouped receipts return their `<participants>`
    /// nodes too.
    pub(crate) async fn parse_receipt(
        &self,
        node: &Node,
    ) -> Result<(Receipt, Option<Vec<Node>>), ClientError> {
        let source = self.parse_message_source(node, false).await?;
        let mut attrs = node.attr_getter();
        let mut receipt = Receipt {
            timestamp: attrs.unix_time("t"),
            r#type: ReceiptType::from(attrs.optional_string("type")),
            message_sender: attrs.optional_jid_or_empty("recipient"),
            source,
            ..Receipt::default()
        };
        if receipt.source.is_group && receipt.source.sender.is_empty() {
            let participants: Vec<Node> =
                node.get_children_by_tag("participants").cloned().collect();
            if participants.is_empty() {
                return Err(element_missing("participants", "grouped receipt"));
            }
            return Ok((receipt, Some(participants)));
        }
        let main_message_id = attrs.string("id");
        attrs.error().map_err(|error| {
            ClientError::Other(format!("failed to parse read receipt attrs: {error}"))
        })?;
        let children = node.get_children();
        if children.len() == 1 && children[0].tag == "list" {
            receipt.message_ids = vec![main_message_id];
            for item in children[0].get_children() {
                if let Some(AttributeValue::String(id)) = item.attrs.get("id")
                    && item.tag == "item"
                {
                    receipt.message_ids.push(id.clone());
                }
            }
        } else {
            receipt.message_ids = vec![main_message_id];
        }
        Ok((receipt, None))
    }

    /// Sends a read receipt (or `played` with `receipt_type`) for messages
    /// one sender sent in a chat. `sender` is needed in groups.
    #[tracing::instrument(name = "whatsmeow.mark_read", skip_all, fields(count = ids.len()), err)]
    pub async fn mark_read(
        &self,
        ids: &[String],
        timestamp: DateTime<Utc>,
        chat: &Jid,
        sender: &Jid,
        receipt_type: Option<ReceiptType>,
    ) -> Result<(), ClientError> {
        let Some(first_id) = ids.first() else {
            return Err(ClientError::Other("no message IDs specified".to_owned()));
        };
        let receipt_type = receipt_type.unwrap_or(ReceiptType::Read);
        let mut attrs = Attrs::from([
            ("id".to_owned(), first_id.clone().into()),
            ("type".to_owned(), receipt_type.as_str().into()),
            ("to".to_owned(), chat.into()),
            ("t".to_owned(), timestamp.timestamp().into()),
        ]);
        if (chat.server == NEWSLETTER_SERVER
            || self.get_privacy_settings().await.read_receipts == PrivacySetting::None)
            && receipt_type == ReceiptType::Read
        {
            attrs.insert("type".to_owned(), ReceiptType::ReadSelf.as_str().into());
        }
        if !sender.is_empty()
            && chat.server != DEFAULT_USER_SERVER
            && chat.server != HIDDEN_USER_SERVER
            && chat.server != MESSENGER_SERVER
        {
            attrs.insert("participant".to_owned(), sender.to_non_ad().into());
        }
        let content = (ids.len() > 1).then(|| {
            NodeContent::Nodes(vec![Node {
                tag: "list".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(
                    ids[1..]
                        .iter()
                        .map(|id| Node {
                            tag: "item".to_owned(),
                            attrs: Attrs::from([("id".to_owned(), id.clone().into())]),
                            content: None,
                        })
                        .collect(),
                )),
            }])
        });
        self.send_node(&Node {
            tag: "receipt".to_owned(),
            attrs,
            content,
        })
        .await
    }

    /// Forces normal delivery receipts even when the client isn't marked
    /// online (`SetForceActiveDeliveryReceipts`).
    pub fn set_force_active_delivery_receipts(&self, active: bool) {
        self.send_active_receipts
            .store(if active { 2 } else { 0 }, Ordering::SeqCst);
    }

    pub(crate) async fn send_message_receipt(&self, info: &MessageInfo, node: &Node) {
        let mut attrs = build_base_receipt(&info.id, node);
        if info.is_from_me {
            let receipt_type = if info.r#type == "peer_msg" {
                ReceiptType::PeerMsg
            } else {
                ReceiptType::Sender
            };
            attrs.insert("type".to_owned(), receipt_type.as_str().into());
        } else if self.send_active_receipts.load(Ordering::SeqCst) == 0 {
            attrs.insert("type".to_owned(), ReceiptType::Inactive.as_str().into());
        }
        let receipt = Node {
            tag: "receipt".to_owned(),
            attrs,
            content: None,
        };
        if let Err(error) = self.send_node(&receipt).await {
            tracing::warn!(error = %error, "failed to send receipt");
        }
    }

    /// Runs the closure now with `synchronous_ack`, else in the background.
    pub(crate) async fn background_if_async_ack<Task>(&self, task: Task)
    where
        Task: Future<Output = ()> + Send + 'static,
    {
        if self.config.synchronous_ack {
            task.await;
        } else {
            self.spawn(task);
        }
    }

    /// Acks the node in the background now, or defers the ack until the
    /// handler finishes when `synchronous_ack` is set.
    pub(crate) fn maybe_deferred_ack(self: &Arc<Self>, node: &Node) -> DeferredAck {
        if self.config.synchronous_ack {
            DeferredAck {
                node: Some(node.clone()),
            }
        } else {
            let client = Arc::clone(self);
            let node = node.clone();
            self.spawn(async move { client.send_ack(&node, 0).await });
            DeferredAck { node: None }
        }
    }

    /// Sends a deferred ack, unless the event was cancelled (a handler failed).
    pub(crate) async fn finish_deferred_ack(&self, ack: DeferredAck, cancelled: bool) {
        let Some(node) = ack.node else {
            return;
        };
        if cancelled || self.background.is_cancelled() {
            tracing::debug!(cancelled, tag = %node.tag, "not sending ack for node");
            return;
        }
        self.send_ack(&node, 0).await;
    }

    /// Acks (or with a nonzero `error`, nacks) a node.
    pub(crate) async fn send_ack(&self, node: &Node, error: i64) {
        let mut attrs = Attrs::from([("class".to_owned(), node.tag.clone().into())]);
        if let Some(id) = node.attrs.get("id") {
            attrs.insert("id".to_owned(), id.clone());
        }
        if let Some(from) = node.attrs.get("from") {
            attrs.insert("to".to_owned(), from.clone());
        }
        if let Some(participant) = node.attrs.get("participant") {
            attrs.insert("participant".to_owned(), participant.clone());
        }
        if let Some(recipient) = node.attrs.get("recipient") {
            // Go maps bot recipients through `types.BotJIDMap` here; bots
            // aren't ported.
            attrs.insert("recipient".to_owned(), recipient.clone());
        }
        if let Some(receipt_type) = node.attrs.get("type")
            && node.tag != "message"
        {
            attrs.insert("type".to_owned(), receipt_type.clone());
        }
        if error != 0 {
            attrs.insert("error".to_owned(), error.into());
        }
        let ack = Node {
            tag: "ack".to_owned(),
            attrs,
            content: None,
        };
        if let Err(send_error) = self.send_node(&ack).await {
            let id = match node.attrs.get("id") {
                Some(AttributeValue::String(id)) => id.clone(),
                _ => String::new(),
            };
            tracing::warn!(error = %send_error, tag = %node.tag, id = %id, "failed to send acknowledgement");
        }
    }
}
