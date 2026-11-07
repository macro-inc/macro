// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow presence.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Messenger (`MessengerConfig`) isn't ported, so presences always carry the
// push name.

//! Online presence and typing notifications.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::types::events::{ChatPresence as ChatPresenceEvent, Event, Presence as PresenceEvent};
use crate::types::{ChatPresence, ChatPresenceMedia, Jid, Presence};

impl Client {
    pub(crate) async fn handle_chat_state(&self, node: &Node) {
        let source = match self.parse_message_source(node, true).await {
            Ok(source) => source,
            Err(error) => {
                tracing::warn!(error = %error, "failed to parse chat state update");
                return;
            }
        };
        let children = node.get_children();
        if children.len() != 1 {
            tracing::warn!(
                children = children.len(),
                "failed to parse chat state update: unexpected number of children in element"
            );
            return;
        }
        let child = &children[0];
        let presence = ChatPresence::from(child.tag.as_str());
        if presence != ChatPresence::Composing && presence != ChatPresence::Paused {
            tracing::warn!(state = %child.tag, "unrecognized chat presence state");
        }
        let media = ChatPresenceMedia::from(child.attr_getter().optional_string("media"));
        self.dispatch_event(Event::ChatPresence(ChatPresenceEvent {
            source,
            state: presence,
            media,
        }))
        .await;
    }

    pub(crate) async fn handle_presence(&self, node: &Node) {
        let mut attrs = node.attr_getter();
        let from = attrs.jid("from");
        let presence_type = attrs.optional_string("type");
        let unavailable = presence_type == "unavailable";
        if !unavailable && !presence_type.is_empty() {
            tracing::debug!(presence_type = %presence_type, "unrecognized presence type in presence event");
        }
        let last_seen = attrs.optional_string("last");
        let last_seen = if !last_seen.is_empty() && last_seen != "deny" {
            attrs.unix_time("last")
        } else {
            None
        };
        if !attrs.ok() {
            tracing::warn!(error = ?attrs.error().err(), "error parsing presence event");
            return;
        }
        self.dispatch_event(Event::Presence(PresenceEvent {
            from,
            unavailable,
            last_seen,
        }))
        .await;
    }

    /// Updates the user's presence status on WhatsApp.
    ///
    /// Call this at least once after connecting so that the server has your
    /// push name; otherwise other users see "-" as the name.
    #[tracing::instrument(name = "whatsmeow.send_presence", skip_all, fields(state = %state), err)]
    pub async fn send_presence(self: &Arc<Self>, state: Presence) -> Result<(), ClientError> {
        let push_name = self.store.read().await.push_name.clone();
        if push_name.is_empty() {
            return Err(ClientError::NoPushName);
        }
        if state == Presence::Available {
            let client = Arc::clone(self);
            self.spawn(async move { client.send_unified_session().await });
            let _ = self.send_active_receipts.compare_exchange(
                0,
                1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
        } else {
            let _ = self.send_active_receipts.compare_exchange(
                1,
                0,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
        }
        self.send_node(&Node {
            tag: "presence".to_owned(),
            attrs: Attrs::from([
                ("type".to_owned(), state.as_str().into()),
                ("name".to_owned(), push_name.into()),
            ]),
            content: None,
        })
        .await
    }

    /// Asks the WhatsApp servers to send presence updates of a specific user
    /// to this client, as [`Event::Presence`].
    ///
    /// The servers seem to require you to be online to receive presences, so
    /// call [`Client::send_presence`] with [`Presence::Available`] first.
    ///
    /// Without a privacy token for the user this subscribes anyway, or returns
    /// [`ClientError::NoPrivacyToken`] with
    /// `error_on_subscribe_presence_without_token` (Go appends the JID to the
    /// message; the port leaves it out of errors).
    #[tracing::instrument(name = "whatsmeow.subscribe_presence", skip_all, err)]
    pub async fn subscribe_presence(&self, jid: &Jid) -> Result<(), ClientError> {
        let privacy_token = self
            .ensure_tc_token(jid)
            .await
            .map_err(|error| error.wrap("failed to get privacy token"))?;
        if privacy_token.is_none() {
            if self.config.error_on_subscribe_presence_without_token {
                return Err(ClientError::NoPrivacyToken);
            }
            tracing::debug!("trying to subscribe to presence without privacy token");
        }
        self.send_node(&Node {
            tag: "presence".to_owned(),
            attrs: Attrs::from([
                ("type".to_owned(), "subscribe".into()),
                ("to".to_owned(), jid.into()),
            ]),
            content: privacy_token.map(|token| {
                NodeContent::Nodes(vec![Node {
                    tag: "tctoken".to_owned(),
                    attrs: Attrs::new(),
                    content: Some(NodeContent::Bytes(token)),
                }])
            }),
        })
        .await
    }

    /// Updates the user's typing status in a chat. `media` can say the user
    /// is recording a voice message rather than typing text.
    #[tracing::instrument(name = "whatsmeow.send_chat_presence", skip_all, fields(state = %state), err)]
    pub async fn send_chat_presence(
        &self,
        jid: &Jid,
        state: ChatPresence,
        media: ChatPresenceMedia,
    ) -> Result<(), ClientError> {
        let mut attrs = Attrs::new();
        if state == ChatPresence::Composing && !media.as_str().is_empty() {
            attrs.insert("media".to_owned(), media.as_str().into());
        }
        self.send_node(&Node {
            tag: "chatstate".to_owned(),
            attrs: Attrs::from([("to".to_owned(), jid.into())]),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: state.as_str().to_owned(),
                attrs,
                content: None,
            }])),
        })
        .await
    }
}

#[cfg(test)]
mod test;
