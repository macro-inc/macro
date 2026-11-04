// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/message.go (MPL-2.0, Copyright (c) Tulir Asokan)

use chrono::{DateTime, Utc};

use super::{Jid, MessageId, MessageServerId, VerifiedName};

string_enum! {
    /// Whether a chat addresses users by phone number or by LID.
    #[derive(Default)]
    pub enum AddressingMode {
        /// Phone numbers (`pn`).
        Pn = "pn",
        /// LIDs (`lid`).
        Lid = "lid",
        /// Not set.
        #[default]
        Empty = "",
    }
}

/// One recipient of a broadcast list message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BroadcastRecipient {
    /// The recipient's LID.
    pub lid: Jid,
    /// The recipient's phone number JID.
    pub pn: Jid,
}

/// Basic sender and chat information about a message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MessageSource {
    /// The chat where the message was sent.
    pub chat: Jid,
    /// The user who sent the message.
    pub sender: Jid,
    /// Whether the message was sent by the current user instead of someone else.
    pub is_from_me: bool,
    /// Whether the chat is a group chat or broadcast list.
    pub is_group: bool,

    /// The addressing mode of the message (phone number or LID).
    pub addressing_mode: AddressingMode,
    /// The alternative address of the user who sent the message.
    pub sender_alt: Jid,
    /// The alternative address of the recipient of the message for DMs.
    pub recipient_alt: Jid,

    /// When sending a read receipt to a broadcast list message, the chat is
    /// the broadcast list and the sender is you, so this holds the recipient.
    pub broadcast_list_owner: Jid,
    /// The recipients of a broadcast list message.
    pub broadcast_recipients: Vec<BroadcastRecipient>,
}

impl MessageSource {
    /// Whether the message was sent to a broadcast list instead of directly to
    /// the user; if so, it shows up in the direct chat with the sender.
    pub fn is_incoming_broadcast(&self) -> bool {
        (!self.is_from_me || !self.broadcast_list_owner.is_empty()) && self.chat.is_broadcast_list()
    }

    /// A log-friendly representation of who sent the message and where.
    pub fn source_string(&self) -> String {
        if self.sender != self.chat {
            format!("{} in {}", self.sender, self.chat)
        } else {
            self.chat.to_string()
        }
    }
}

/// Metadata from messages sent by another one of the user's own devices.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeviceSentMeta {
    /// The destination user.
    pub destination_jid: String,
    /// The participant hash.
    pub phash: String,
}

string_enum! {
    /// The `edit` attribute of a message.
    #[derive(Default)]
    pub enum EditAttribute {
        /// Not an edit.
        #[default]
        Empty = "",
        /// A message edit.
        MessageEdit = "1",
        /// Pinning a message in a chat.
        PinInChat = "2",
        /// An admin edit (only used in newsletters).
        AdminEdit = "3",
        /// The sender revoking (deleting) a message.
        SenderRevoke = "7",
        /// An admin revoking a message.
        AdminRevoke = "8",
    }
}

string_enum! {
    /// The edit type of a bot message.
    #[derive(Default)]
    pub enum BotEditType {
        /// The first part.
        First = "first",
        /// An inner part.
        Inner = "inner",
        /// The last part.
        Last = "last",
        /// The full message.
        Full = "full",
        /// Not set.
        #[default]
        Empty = "",
    }
}

/// Bot metadata of a message (`<bot>`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MsgBotInfo {
    /// The edit type.
    pub edit_type: BotEditType,
    /// The edited message.
    pub edit_target_id: MessageId,
    /// When the edited message was sent.
    pub edit_sender_timestamp_ms: Option<DateTime<Utc>>,
    /// The thread ID, for messages sent to bots.
    pub client_thread_id: String,
}

/// The `<meta>` metadata of a message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MsgMetaInfo {
    /// The bot target message ID.
    pub target_id: MessageId,
    /// The bot target sender.
    pub target_sender: Jid,
    /// The bot target chat.
    pub target_chat: Jid,

    /// The deprecated LID session flag.
    pub deprecated_lid_session: Option<bool>,

    /// The thread the message is in.
    pub thread_message_id: MessageId,
    /// The sender of the thread's root message.
    pub thread_message_sender_jid: Jid,
}

/// Metadata about an incoming message.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MessageInfo {
    /// Who sent the message and where.
    pub source: MessageSource,
    /// The message ID.
    pub id: MessageId,
    /// The server ID (newsletters only).
    pub server_id: MessageServerId,
    /// The message type (`text`, `media`, …).
    pub r#type: String,
    /// The sender's push name.
    pub push_name: String,
    /// When the message was sent; `None` is Go's zero time.
    pub timestamp: Option<DateTime<Utc>>,
    /// The message category.
    pub category: String,
    /// Whether the message was multicast.
    pub multicast: bool,
    /// The media type.
    pub media_type: String,
    /// The edit attribute.
    pub edit: EditAttribute,

    /// Bot metadata.
    pub msg_bot_info: MsgBotInfo,
    /// `<meta>` metadata.
    pub msg_meta_info: MsgMetaInfo,

    /// Whether this is a newsletter status.
    pub is_newsletter_status: bool,

    /// The sender's verified business name.
    pub verified_name: Option<VerifiedName>,
    /// Metadata for direct messages sent from another one of the user's own devices.
    pub device_sent_meta: Option<DeviceSentMeta>,
}

impl std::ops::Deref for MessageInfo {
    type Target = MessageSource;

    /// Go embeds `MessageSource` in `MessageInfo`.
    fn deref(&self) -> &MessageSource {
        &self.source
    }
}

impl std::ops::DerefMut for MessageInfo {
    fn deref_mut(&mut self) -> &mut MessageSource {
        &mut self.source
    }
}
