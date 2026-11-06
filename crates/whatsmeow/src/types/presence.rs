// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/presence.go (MPL-2.0, Copyright (c) Tulir Asokan)

string_enum! {
    /// Online presence.
    pub enum Presence {
        /// Online.
        Available = "available",
        /// Offline.
        Unavailable = "unavailable",
    }
}

string_enum! {
    /// Typing state in a chat.
    pub enum ChatPresence {
        /// Typing.
        Composing = "composing",
        /// Stopped typing.
        Paused = "paused",
    }
}

string_enum! {
    /// What kind of message is being composed.
    pub enum ChatPresenceMedia {
        /// Text.
        Text = "",
        /// A voice message.
        Audio = "audio",
    }
}

string_enum! {
    /// The type of a receipt.
    #[derive(Default)]
    pub enum ReceiptType {
        /// The message was delivered to the device (but the user might not
        /// have noticed).
        #[default]
        Delivered = "",
        /// Sent by your other devices when a message you sent is delivered to them.
        Sender = "sender",
        /// The message was delivered, but decrypting it failed.
        Retry = "retry",
        /// The user opened the chat and saw the message.
        Read = "read",
        /// The current user read a message from a different device, and has
        /// read receipts disabled in privacy settings.
        ReadSelf = "read-self",
        /// The user opened a view-once media message.
        Played = "played",
        /// The current user opened a view-once media message from a different
        /// device, with read receipts disabled.
        PlayedSelf = "played-self",
        /// The server failed to deliver the message.
        ServerError = "server-error",
        /// Delivered to an inactive client.
        Inactive = "inactive",
        /// A peer message.
        PeerMsg = "peer_msg",
        /// A history sync.
        HistorySync = "hist_sync",
    }
}
