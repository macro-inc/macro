// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/events/appstate.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `time.UnixMilli(action.GetTimestamp())` is never the zero time, so
// the timestamps here aren't optional. Go's nil action pointers are `None`.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::appstate::WaPatchName;
use crate::errors::ClientError;
use crate::proto::wa_sync_action::{
    ArchiveChatAction, ClearChatAction, ContactAction, DeleteChatAction, DeleteMessageForMeAction,
    LabelAssociationAction, LabelEditAction, MarkChatAsReadAction, MuteAction, PinAction,
    PushNameSetting as PushNameSettingAction, StarAction, SyncActionValue,
    UnarchiveChatsSetting as UnarchiveChatsSettingAction, UserStatusMuteAction,
};
use crate::types::{Jid, MessageInfo};

/// An entry in the user's contact list was changed from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct Contact {
    /// The contact who was changed.
    pub jid: Jid,
    /// When the change happened.
    pub timestamp: DateTime<Utc>,
    /// The new contact info.
    pub action: Option<ContactAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A message arrived with a different push name than the cached one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PushName {
    /// The user whose push name changed.
    pub jid: Jid,
    /// The user's other JID (LID or phone number), if known.
    pub jid_alt: Jid,
    /// The message where the change was first noticed.
    pub message: Option<MessageInfo>,
    /// The previous push name from the local cache.
    pub old_push_name: String,
    /// The new push name from the message.
    pub new_push_name: String,
}

/// A message arrived with a different verified business name than the
/// cached one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BusinessName {
    /// The business.
    pub jid: Jid,
    /// The message where the change was noticed, if any.
    pub message: Option<MessageInfo>,
    /// The previous name.
    pub old_business_name: String,
    /// The new name.
    pub new_business_name: String,
}

/// A chat was pinned or unpinned from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct Pin {
    /// The chat.
    pub jid: Jid,
    /// When the (un)pinning happened.
    pub timestamp: DateTime<Utc>,
    /// Whether the chat is now pinned.
    pub action: Option<PinAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A message was starred or unstarred from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct Star {
    /// The chat of the message.
    pub chat_jid: Jid,
    /// In groups, who sent the message (empty when the user sent it).
    pub sender_jid: Jid,
    /// Whether the user sent the message.
    pub is_from_me: bool,
    /// The message.
    pub message_id: String,
    /// When the (un)starring happened.
    pub timestamp: DateTime<Utc>,
    /// Whether the message is now starred.
    pub action: Option<StarAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A message was deleted for the user only, from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct DeleteForMe {
    /// The chat of the message.
    pub chat_jid: Jid,
    /// In groups, who sent the message (empty when the user sent it).
    pub sender_jid: Jid,
    /// Whether the user sent the message.
    pub is_from_me: bool,
    /// The message.
    pub message_id: String,
    /// When the deletion happened.
    pub timestamp: DateTime<Utc>,
    /// More about the deletion.
    pub action: Option<DeleteMessageForMeAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A chat was muted or unmuted from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct Mute {
    /// The chat.
    pub jid: Jid,
    /// When the (un)muting happened.
    pub timestamp: DateTime<Utc>,
    /// The chat's mute status.
    pub action: Option<MuteAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A chat was archived or unarchived from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct Archive {
    /// The chat.
    pub jid: Jid,
    /// When the (un)archiving happened.
    pub timestamp: DateTime<Utc>,
    /// The chat's archive status.
    pub action: Option<ArchiveChatAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A whole chat was marked as read or unread from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct MarkChatAsRead {
    /// The chat.
    pub jid: Jid,
    /// When the marking happened.
    pub timestamp: DateTime<Utc>,
    /// Whether the chat is read, and its latest messages.
    pub action: Option<MarkChatAsReadAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A chat was cleared on another device (unlike [`DeleteChat`]).
#[derive(Clone, Debug, PartialEq)]
pub struct ClearChat {
    /// The chat.
    pub jid: Jid,
    /// When the clear happened.
    pub timestamp: DateTime<Utc>,
    /// More about the clear.
    pub action: Option<ClearChatAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
    /// Whether media was deleted too.
    pub delete_media: bool,
}

/// A chat was deleted on another device.
#[derive(Clone, Debug, PartialEq)]
pub struct DeleteChat {
    /// The chat.
    pub jid: Jid,
    /// When the deletion happened.
    pub timestamp: DateTime<Utc>,
    /// More about the deletion.
    pub action: Option<DeleteChatAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
    /// Whether media was deleted too.
    pub delete_media: bool,
}

/// The user's push name was changed from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct PushNameSetting {
    /// When the push name changed.
    pub timestamp: DateTime<Utc>,
    /// The new push name.
    pub action: Option<PushNameSettingAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// The "keep chats archived" setting was changed from another device.
#[derive(Clone, Debug, PartialEq)]
pub struct UnarchiveChatsSetting {
    /// When the setting changed.
    pub timestamp: DateTime<Utc>,
    /// The new setting.
    pub action: Option<UnarchiveChatsSettingAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// The user muted or unmuted another user's status updates.
#[derive(Clone, Debug, PartialEq)]
pub struct UserStatusMute {
    /// The user who was (un)muted.
    pub jid: Jid,
    /// When it happened.
    pub timestamp: DateTime<Utc>,
    /// The new mute status.
    pub action: Option<UserStatusMuteAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A label was edited from any device.
#[derive(Clone, Debug, PartialEq)]
pub struct LabelEdit {
    /// When the label was edited.
    pub timestamp: DateTime<Utc>,
    /// The label.
    pub label_id: String,
    /// The new label info.
    pub action: Option<LabelEditAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A chat was labeled or unlabeled from any device.
#[derive(Clone, Debug, PartialEq)]
pub struct LabelAssociationChat {
    /// The chat.
    pub jid: Jid,
    /// When the (un)labeling happened.
    pub timestamp: DateTime<Utc>,
    /// The label.
    pub label_id: String,
    /// The chat's label status.
    pub action: Option<LabelAssociationAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// A message was labeled or unlabeled from any device.
#[derive(Clone, Debug, PartialEq)]
pub struct LabelAssociationMessage {
    /// The chat of the message.
    pub jid: Jid,
    /// When the (un)labeling happened.
    pub timestamp: DateTime<Utc>,
    /// The label.
    pub label_id: String,
    /// The message.
    pub message_id: String,
    /// The message's label status.
    pub action: Option<LabelAssociationAction>,
    /// Whether the event comes from a full sync.
    pub from_full_sync: bool,
}

/// New data from app state syncing. Prefer the specific events like
/// [`Contact`] and [`Mute`].
#[derive(Clone, Debug, PartialEq)]
pub struct AppState {
    /// The mutation's index.
    pub index: Vec<String>,
    /// The mutation's value (Go embeds it).
    pub sync_action_value: Option<SyncActionValue>,
}

/// An app state collection was resynced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppStateSyncComplete {
    /// The collection.
    pub name: WaPatchName,
    /// Its version after the sync.
    pub version: u64,
    /// Whether the state came from a recovery snapshot.
    pub recovery: bool,
}

/// Syncing an app state collection failed.
#[derive(Clone, Debug)]
pub struct AppStateSyncError {
    /// The collection.
    pub name: WaPatchName,
    /// What failed.
    pub error: Arc<ClientError>,
    /// Whether it was a full sync.
    pub full_sync: bool,
}
