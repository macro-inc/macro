// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/events/events.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's zero `time.Time` is `None` and its `time.Duration` is
// `std::time::Duration`. Errors carried by events are `Arc`s so events stay
// `Clone`.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::binary::Node;
use crate::errors::ClientError;
use crate::proto::wa_companion_reg::ClientPairingProps;
use crate::proto::wa_e2e;
use crate::proto::wa_history_sync::HistorySync as HistorySyncData;
use crate::proto::wa_web::WebMessageInfo;
use crate::types::{
    ChatPresence as ChatPresenceState, ChatPresenceMedia, GroupAnnounce, GroupDelete,
    GroupEphemeral, GroupInfo as GroupInfoType, GroupLinkChange, GroupLocked,
    GroupMembershipApprovalMode, GroupName, GroupTopic, Jid, MessageId, MessageInfo, MessageSource,
    PrivacySettings as PrivacySettingsType, ReceiptType,
};

/// Every event the client emits.
#[expect(
    clippy::large_enum_variant,
    reason = "events are passed by reference to handlers; boxing every large one adds noise for callers"
)]
#[derive(Clone, Debug)]
pub enum Event {
    /// New QR codes to show for pairing.
    Qr(Qr),
    /// The ADV secret in the QR codes changed.
    RotateAdvSecret(RotateAdvSecret),
    /// Pairing succeeded.
    PairSuccess(PairSuccess),
    /// Pairing failed.
    PairError(PairError),
    /// The QR code was scanned by a phone without multidevice.
    QrScannedWithoutMultidevice(QrScannedWithoutMultidevice),
    /// Pairing needs a passkey assertion.
    PairPasskeyRequest(Box<PairPasskeyRequest>),
    /// Handling a passkey notification failed.
    PairPasskeyError(PairPasskeyError),
    /// The passkey was accepted; confirm the code.
    PairPasskeyConfirmation(PairPasskeyConfirmation),
    /// The phone answered a media retry request.
    MediaRetry(Box<MediaRetry>),
    /// The client connected and authenticated.
    Connected(Connected),
    /// A keepalive ping timed out.
    KeepAliveTimeout(KeepAliveTimeout),
    /// Keepalive pings work again.
    KeepAliveRestored(KeepAliveRestored),
    /// The device was logged out.
    LoggedOut(LoggedOut),
    /// Another client connected with the same keys.
    StreamReplaced(StreamReplaced),
    /// The server sent a 515 but login auto-reconnect is disabled.
    ManualLoginReconnect(ManualLoginReconnect),
    /// The account is temporarily banned.
    TemporaryBan(TemporaryBan),
    /// The server refused the connection.
    ConnectFailure(ConnectFailure),
    /// The client version is too old.
    ClientOutdated(ClientOutdated),
    /// Refreshing the Messenger crypto auth token failed.
    CatRefreshError(CatRefreshError),
    /// An unknown stream error.
    StreamError(StreamError),
    /// The websocket disconnected unexpectedly.
    Disconnected(Disconnected),
    /// A history sync blob was received.
    HistorySync(Box<HistorySync>),
    /// A message couldn't be decrypted.
    UndecryptableMessage(UndecryptableMessage),
    /// A message was received.
    Message(Box<Message>),
    /// A receipt was received.
    Receipt(Receipt),
    /// Someone started or stopped typing.
    ChatPresence(ChatPresence),
    /// Someone's online status changed.
    Presence(Presence),
    /// The user joined or was added to a group.
    JoinedGroup(Box<JoinedGroup>),
    /// A group's info or participants changed.
    GroupInfo(Box<GroupInfo>),
    /// A profile picture changed.
    Picture(Picture),
    /// A user's about text changed.
    UserAbout(UserAbout),
    /// A user's identity key changed.
    IdentityChange(IdentityChange),
    /// The user's privacy settings changed.
    PrivacySettings(PrivacySettings),
    /// The server is about to deliver the offline backlog.
    OfflineSyncPreview(OfflineSyncPreview),
    /// The offline backlog was delivered.
    OfflineSyncCompleted(OfflineSyncCompleted),
    /// The blocklist changed.
    Blocklist(Blocklist),
    /// A contact's push name changed.
    PushName(Box<super::PushName>),
    /// A contact's verified business name changed.
    BusinessName(Box<super::BusinessName>),
    /// A contact list entry changed on another device.
    Contact(Box<super::Contact>),
    /// A chat was (un)pinned on another device.
    Pin(Box<super::Pin>),
    /// A message was (un)starred on another device.
    Star(Box<super::Star>),
    /// A message was deleted for the user on another device.
    DeleteForMe(Box<super::DeleteForMe>),
    /// A chat was (un)muted on another device.
    Mute(Box<super::Mute>),
    /// A chat was (un)archived on another device.
    Archive(Box<super::Archive>),
    /// A chat was marked as read or unread on another device.
    MarkChatAsRead(Box<super::MarkChatAsRead>),
    /// A chat was cleared on another device.
    ClearChat(Box<super::ClearChat>),
    /// A chat was deleted on another device.
    DeleteChat(Box<super::DeleteChat>),
    /// The user's push name changed on another device.
    PushNameSetting(Box<super::PushNameSetting>),
    /// The "keep chats archived" setting changed on another device.
    UnarchiveChatsSetting(Box<super::UnarchiveChatsSetting>),
    /// Another user's status updates were (un)muted.
    UserStatusMute(Box<super::UserStatusMute>),
    /// A label was edited.
    LabelEdit(Box<super::LabelEdit>),
    /// A chat was (un)labeled.
    LabelAssociationChat(Box<super::LabelAssociationChat>),
    /// A message was (un)labeled.
    LabelAssociationMessage(Box<super::LabelAssociationMessage>),
    /// Raw data from app state syncing.
    AppState(Box<super::AppState>),
    /// An app state collection was resynced.
    AppStateSyncComplete(super::AppStateSyncComplete),
    /// Syncing an app state collection failed.
    AppStateSyncError(super::AppStateSyncError),
}

/// New QR codes for pairing: show the first one, then the next one every
/// 20 seconds (the first stays 60 seconds).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Qr {
    /// The QR code contents.
    pub codes: Vec<String>,
}

/// The ADV secret was rotated; replace it in the QR codes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RotateAdvSecret {
    /// The old secret, base64.
    pub old_secret: String,
    /// The new secret, base64.
    pub new_secret: String,
}

/// Pairing succeeded. The client disconnects and reconnects by itself.
#[derive(Clone, Debug, PartialEq)]
pub struct PairSuccess {
    /// The new device JID.
    pub id: Jid,
    /// The new device LID.
    pub lid: Jid,
    /// The business name, if any.
    pub business_name: String,
    /// The primary device's platform.
    pub platform: String,
    /// The pairing props.
    pub props: ClientPairingProps,
}

/// Pairing failed.
#[derive(Clone, Debug)]
pub struct PairError {
    /// The device JID.
    pub id: Jid,
    /// The device LID.
    pub lid: Jid,
    /// The business name, if any.
    pub business_name: String,
    /// The primary device's platform.
    pub platform: String,
    /// The pairing props.
    pub props: ClientPairingProps,
    /// What failed.
    pub error: Arc<ClientError>,
}

/// Pairing needs a passkey: ask the authenticator to sign the request and
/// pass the answer to `Client::send_passkey_response`.
#[derive(Clone, Debug, PartialEq)]
pub struct PairPasskeyRequest {
    /// The WebAuthn request options.
    pub public_key: crate::types::WebAuthnPublicKey,
}

/// Handling a passkey notification failed.
#[derive(Clone, Debug)]
pub struct PairPasskeyError {
    /// What failed.
    pub error: Arc<ClientError>,
    /// Whether this came from a continuation notification rather than the
    /// initial one.
    pub continuation: bool,
}

/// The passkey response was accepted. Show `code` to the user and call
/// `Client::send_passkey_confirmation`; with `skip_handoff_ux`, showing the
/// code can be skipped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairPasskeyConfirmation {
    /// The code, `ABCD-EFGH`.
    pub code: String,
    /// Whether the code needn't be shown.
    pub skip_handoff_ux: bool,
}

/// The error code of a failed media retry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MediaRetryError {
    /// The code; 2 means the media is no longer on the phone.
    pub code: i64,
}

/// The phone's answer to `Client::send_media_retry_receipt`. Decrypt it with
/// `mediaretry::decrypt_media_retry_notification` and the media key.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MediaRetry {
    /// The encrypted `MediaRetryNotification`.
    pub ciphertext: Vec<u8>,
    /// Its IV.
    pub iv: Vec<u8>,
    /// The error, if the phone couldn't re-upload.
    pub error: Option<MediaRetryError>,
    /// When the response was sent.
    pub timestamp: Option<DateTime<Utc>>,
    /// The message ID.
    pub message_id: MessageId,
    /// The chat of the message.
    pub chat_id: Jid,
    /// The sender of the message (groups only).
    pub sender_id: Jid,
    /// Whether we sent the message.
    pub from_me: bool,
}

/// The QR code was scanned by a phone without multidevice enabled.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QrScannedWithoutMultidevice;

/// The client connected and authenticated.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Connected;

/// A keepalive ping timed out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeepAliveTimeout {
    /// How many pings failed in a row.
    pub error_count: u32,
    /// When the last ping succeeded.
    pub last_success: DateTime<Utc>,
}

/// Keepalive pings work again.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KeepAliveRestored;

/// The device was logged out: the session is deleted and must be paired again.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoggedOut {
    /// Whether this came as a connect failure rather than a stream error.
    pub on_connect: bool,
    /// Why.
    pub reason: ConnectFailureReason,
}

/// Another client connected with the same keys.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StreamReplaced;

/// The server asked for a reconnect after login, but
/// `disable_login_auto_reconnect` is set.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ManualLoginReconnect;

/// Why the account is temporarily banned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TempBanReason(pub i64);

impl TempBanReason {
    /// Sent too many messages to people who don't have you in their address books.
    pub const SENT_TO_TOO_MANY_PEOPLE: TempBanReason = TempBanReason(101);
    /// Too many people blocked you.
    pub const BLOCKED_BY_USERS: TempBanReason = TempBanReason(102);
    /// Created too many groups with strangers.
    pub const CREATED_TOO_MANY_GROUPS: TempBanReason = TempBanReason(103);
    /// Sent the same message to too many people.
    pub const SENT_TOO_MANY_SAME_MESSAGE: TempBanReason = TempBanReason(104);
    /// Sent too many messages to a broadcast list.
    pub const BROADCAST_LIST: TempBanReason = TempBanReason(106);

    fn message(self) -> &'static str {
        match self {
            TempBanReason::SENT_TO_TOO_MANY_PEOPLE => {
                "you sent too many messages to people who don't have you in their address books"
            }
            TempBanReason::BLOCKED_BY_USERS => "too many people blocked you",
            TempBanReason::CREATED_TOO_MANY_GROUPS => {
                "you created too many groups with people who don't have you in their address books"
            }
            TempBanReason::SENT_TOO_MANY_SAME_MESSAGE => {
                "you sent the same message to too many people"
            }
            TempBanReason::BROADCAST_LIST => "you sent too many messages to a broadcast list",
            _ => "you may have violated the terms of service (unknown error)",
        }
    }
}

impl fmt::Display for TempBanReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.0, self.message())
    }
}

/// The account is temporarily banned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporaryBan {
    /// Why.
    pub code: TempBanReason,
    /// When the ban ends; zero when unknown.
    pub expire: Duration,
}

impl fmt::Display for TemporaryBan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.expire.is_zero() {
            write!(formatter, "You've been temporarily banned: {}", self.code)
        } else {
            write!(
                formatter,
                "You've been temporarily banned: {}. The ban expires in {:?}",
                self.code, self.expire
            )
        }
    }
}

/// Why the server refused the connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConnectFailureReason(pub i64);

impl ConnectFailureReason {
    /// A generic failure.
    pub const GENERIC: ConnectFailureReason = ConnectFailureReason(400);
    /// Logged out from another device.
    pub const LOGGED_OUT: ConnectFailureReason = ConnectFailureReason(401);
    /// The account is temporarily banned.
    pub const TEMP_BANNED: ConnectFailureReason = ConnectFailureReason(402);
    /// The primary device was logged out (LOCKED in WhatsApp web).
    pub const MAIN_DEVICE_GONE: ConnectFailureReason = ConnectFailureReason(403);
    /// Logged out for an unknown reason (BANNED in WhatsApp web).
    pub const UNKNOWN_LOGOUT: ConnectFailureReason = ConnectFailureReason(406);
    /// The client is out of date.
    pub const CLIENT_OUTDATED: ConnectFailureReason = ConnectFailureReason(405);
    /// The user agent was rejected.
    pub const BAD_USER_AGENT: ConnectFailureReason = ConnectFailureReason(409);
    /// The Messenger crypto auth token expired.
    pub const CAT_EXPIRED: ConnectFailureReason = ConnectFailureReason(413);
    /// The Messenger crypto auth token is invalid.
    pub const CAT_INVALID: ConnectFailureReason = ConnectFailureReason(414);
    /// Not found.
    pub const NOT_FOUND: ConnectFailureReason = ConnectFailureReason(415);
    /// Unknown client.
    pub const CLIENT_UNKNOWN: ConnectFailureReason = ConnectFailureReason(418);
    /// An internal server error.
    pub const INTERNAL_SERVER_ERROR: ConnectFailureReason = ConnectFailureReason(500);
    /// Experimental.
    pub const EXPERIMENTAL: ConnectFailureReason = ConnectFailureReason(501);
    /// The service is unavailable.
    pub const SERVICE_UNAVAILABLE: ConnectFailureReason = ConnectFailureReason(503);

    /// Whether the reason means the device was logged out.
    pub fn is_logged_out(self) -> bool {
        self == Self::LOGGED_OUT || self == Self::MAIN_DEVICE_GONE || self == Self::UNKNOWN_LOGOUT
    }

    /// The code as a string.
    pub fn number_string(self) -> String {
        self.0.to_string()
    }

    fn message(self) -> &'static str {
        match self {
            Self::LOGGED_OUT => "logged out from another device",
            Self::TEMP_BANNED => "account temporarily banned",
            Self::MAIN_DEVICE_GONE => "primary device was logged out",
            Self::UNKNOWN_LOGOUT => "logged out for unknown reason",
            Self::CLIENT_OUTDATED => "client is out of date",
            Self::BAD_USER_AGENT => "client user agent was rejected",
            Self::CAT_EXPIRED => "messenger crypto auth token has expired",
            Self::CAT_INVALID => "messenger crypto auth token is invalid",
            _ => "unknown error",
        }
    }
}

impl fmt::Display for ConnectFailureReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.0, self.message())
    }
}

/// The server refused the connection for a reason without its own event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectFailure {
    /// Why.
    pub reason: ConnectFailureReason,
    /// The server's message.
    pub message: String,
    /// The raw failure node.
    pub raw: Node,
}

/// The client version is too old; update the WA version.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClientOutdated;

/// Refreshing the Messenger crypto auth token failed.
#[derive(Clone, Debug)]
pub struct CatRefreshError {
    /// What failed.
    pub error: Arc<ClientError>,
}

/// An unknown stream error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamError {
    /// The error code.
    pub code: String,
    /// The raw error node.
    pub raw: Node,
}

/// The websocket disconnected unexpectedly; the client reconnects by itself
/// when auto-reconnect is on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Disconnected;

/// A history sync blob, downloaded and decoded.
#[derive(Clone, Debug, PartialEq)]
pub struct HistorySync {
    /// The decoded history.
    pub data: HistorySyncData,
    /// The notification it came from.
    pub notification: wa_e2e::HistorySyncNotification,
}

string_enum! {
    /// Whether to show a placeholder for an undecryptable message.
    #[derive(Default)]
    pub enum DecryptFailMode {
        /// Show it.
        #[default]
        Show = "",
        /// Hide it.
        Hide = "hide",
    }
}

string_enum! {
    /// Why a message is unavailable.
    #[derive(Default)]
    pub enum UnavailableType {
        /// Unknown.
        #[default]
        Unknown = "",
        /// A view-once message.
        ViewOnce = "view_once",
    }
}

/// A message couldn't be decrypted.
#[derive(Clone, Debug, PartialEq)]
pub struct UndecryptableMessage {
    /// The message metadata.
    pub info: MessageInfo,
    /// Whether the message was unavailable rather than undecryptable.
    pub is_unavailable: bool,
    /// Why it was unavailable.
    pub unavailable_type: UnavailableType,
    /// Whether to show a placeholder.
    pub decrypt_fail_mode: DecryptFailMode,
}

/// A message was received.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Message {
    /// The chat, sender and other metadata.
    pub info: MessageInfo,
    /// The message, unwrapped from ephemeral/view-once/edit wrappers.
    pub message: Option<wa_e2e::Message>,

    /// Unwrapped from an `EphemeralMessage`.
    pub is_ephemeral: bool,
    /// Unwrapped from a view-once message.
    pub is_view_once: bool,
    /// Unwrapped from a `ViewOnceMessageV2` or its extension.
    pub is_view_once_v2: bool,
    /// Unwrapped from a `ViewOnceMessageV2Extension`.
    pub is_view_once_v2_extension: bool,
    /// Unwrapped from a `DocumentWithCaptionMessage`.
    pub is_document_with_caption: bool,
    /// Unwrapped from a `LottieStickerMessage`.
    pub is_lottie_sticker: bool,
    /// Unwrapped from a `BotInvokeMessage`.
    pub is_bot_invoke: bool,
    /// Unwrapped from an `EditedMessage`.
    pub is_edit: bool,

    /// The source of a message parsed from history sync.
    pub source_web_msg: Option<WebMessageInfo>,
    /// The request ID, if this was requested from the phone.
    pub unavailable_request_id: MessageId,
    /// How many retry receipts were sent before it decrypted.
    pub retry_count: i64,

    /// The message as it was received, before unwrapping.
    pub raw_message: Option<wa_e2e::Message>,
}

impl Message {
    /// Fills [`Message::message`] from [`Message::raw_message`], unwrapping
    /// the wrappers and setting the flags.
    pub fn unwrap_raw(&mut self) -> &mut Self {
        self.message = self.raw_message.clone();
        if let Some(device_sent) = self
            .message
            .as_ref()
            .and_then(|message| message.device_sent_message.as_ref())
            && let Some(inner) = device_sent.message.as_ref()
        {
            self.info.device_sent_meta = Some(crate::types::DeviceSentMeta {
                destination_jid: device_sent.destination_jid.clone().unwrap_or_default(),
                phash: device_sent.phash.clone().unwrap_or_default(),
            });
            self.message = Some(inner.as_ref().clone());
        }
        macro_rules! unwrap_future_proof {
            ($field:ident, $($flag:ident),*) => {
                if let Some(inner) = self
                    .message
                    .as_ref()
                    .and_then(|message| message.$field.as_ref())
                    .and_then(|wrapper| wrapper.message.as_ref())
                {
                    self.message = Some(inner.as_ref().clone());
                    $(self.$flag = true;)*
                }
            };
        }
        unwrap_future_proof!(bot_invoke_message, is_bot_invoke);
        unwrap_future_proof!(ephemeral_message, is_ephemeral);
        unwrap_future_proof!(view_once_message, is_view_once);
        unwrap_future_proof!(view_once_message_v2, is_view_once, is_view_once_v2);
        unwrap_future_proof!(
            view_once_message_v2_extension,
            is_view_once,
            is_view_once_v2,
            is_view_once_v2_extension
        );
        unwrap_future_proof!(lottie_sticker_message, is_lottie_sticker);
        unwrap_future_proof!(document_with_caption_message, is_document_with_caption);
        unwrap_future_proof!(edited_message, is_edit);
        if let (Some(message), Some(raw)) = (self.message.as_mut(), self.raw_message.as_ref())
            && message.message_context_info.is_none()
            && raw.message_context_info.is_some()
        {
            message.message_context_info = raw.message_context_info.clone();
        }
        self
    }
}

/// A receipt: delivered, read, played, retry, …
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Receipt {
    /// Who sent the receipt and where.
    pub source: MessageSource,
    /// The receipted messages.
    pub message_ids: Vec<MessageId>,
    /// When.
    pub timestamp: Option<DateTime<Utc>>,
    /// The kind of receipt.
    pub r#type: ReceiptType,
    /// The sender of the messages, for receipts of other people's messages.
    pub message_sender: Jid,
}

/// Someone started or stopped typing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatPresence {
    /// Who and where.
    pub source: MessageSource,
    /// Composing or paused.
    pub state: ChatPresenceState,
    /// What kind of message is being composed.
    pub media: ChatPresenceMedia,
}

/// Someone's online status changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Presence {
    /// Whose.
    pub from: Jid,
    /// Whether they went offline.
    pub unavailable: bool,
    /// When they were last online, if known.
    pub last_seen: Option<DateTime<Utc>>,
}

/// The user joined or was added to a group.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinedGroup {
    /// `invite` if the user joined with an invite link.
    pub reason: String,
    /// `new` for a newly created group.
    pub r#type: String,
    /// The create key, if the user created the group.
    pub create_key: MessageId,
    /// Who added the user.
    pub sender: Option<Jid>,
    /// The phone number of who added the user.
    pub sender_pn: Option<Jid>,
    /// The notify value.
    pub notify: String,
    /// The group.
    pub group_info: GroupInfoType,
}

/// A group's info or participants changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupInfo {
    /// The group.
    pub jid: Jid,
    /// The notify value.
    pub notify: String,
    /// Who made the change.
    pub sender: Option<Jid>,
    /// The phone number of who made the change, if the sender is a LID.
    pub sender_pn: Option<Jid>,
    /// When.
    pub timestamp: Option<DateTime<Utc>>,

    /// A name change.
    pub name: Option<GroupName>,
    /// A topic change.
    pub topic: Option<GroupTopic>,
    /// A locked change.
    pub locked: Option<GroupLocked>,
    /// An announce change.
    pub announce: Option<GroupAnnounce>,
    /// A disappearing messages change.
    pub ephemeral: Option<GroupEphemeral>,
    /// A membership approval mode change.
    pub membership_approval_mode: Option<GroupMembershipApprovalMode>,
    /// The group was deleted.
    pub delete: Option<GroupDelete>,
    /// The group was linked.
    pub link: Option<GroupLinkChange>,
    /// The group was unlinked.
    pub unlink: Option<GroupLinkChange>,
    /// A new invite link.
    pub new_invite_link: Option<String>,

    /// The previous participant list version.
    pub prev_participant_version_id: String,
    /// The participant list version.
    pub participant_version_id: String,

    /// `invite` if the user joined via invite link.
    pub join_reason: String,

    /// Users who joined or were added.
    pub join: Vec<Jid>,
    /// Users who left or were removed.
    pub leave: Vec<Jid>,
    /// Users promoted to admins.
    pub promote: Vec<Jid>,
    /// Users demoted to normal users.
    pub demote: Vec<Jid>,
    /// Whether the group was suspended.
    pub suspended: bool,
    /// Whether the group was unsuspended.
    pub unsuspended: bool,
    /// Changes this port doesn't parse.
    pub unknown_changes: Vec<Node>,
}

/// A profile picture changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Picture {
    /// The user or group whose picture changed.
    pub jid: Jid,
    /// Who changed it.
    pub author: Jid,
    /// When.
    pub timestamp: Option<DateTime<Utc>>,
    /// Whether the picture was removed.
    pub remove: bool,
    /// The new picture ID if it wasn't removed.
    pub picture_id: String,
}

/// A user's about text changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UserAbout {
    /// Whose.
    pub jid: Jid,
    /// The new text.
    pub status: String,
    /// When.
    pub timestamp: Option<DateTime<Utc>>,
}

/// A user's identity key changed; their sessions were deleted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IdentityChange {
    /// Whose.
    pub jid: Jid,
    /// When.
    pub timestamp: Option<DateTime<Utc>>,
    /// Whether this was detected from an untrusted identity error rather
    /// than a notification.
    pub implicit: bool,
}

/// The user's privacy settings changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PrivacySettings {
    /// The new settings.
    pub new_settings: PrivacySettingsType,
    /// Whether group add changed.
    pub group_add_changed: bool,
    /// Whether last seen changed.
    pub last_seen_changed: bool,
    /// Whether status changed.
    pub status_changed: bool,
    /// Whether profile changed.
    pub profile_changed: bool,
    /// Whether read receipts changed.
    pub read_receipts_changed: bool,
    /// Whether online changed.
    pub online_changed: bool,
    /// Whether call add changed.
    pub call_add_changed: bool,
    /// Whether messages changed.
    pub messages_changed: bool,
    /// Whether defense changed.
    pub defense_changed: bool,
    /// Whether stickers changed.
    pub stickers_changed: bool,
}

/// The server is about to deliver the offline backlog.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OfflineSyncPreview {
    /// Total items.
    pub total: i64,
    /// App state changes.
    pub app_data_changes: i64,
    /// Messages.
    pub messages: i64,
    /// Notifications.
    pub notifications: i64,
    /// Receipts.
    pub receipts: i64,
}

/// The offline backlog was delivered.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OfflineSyncCompleted {
    /// How many items.
    pub count: i64,
}

string_enum! {
    /// A blocklist event action.
    #[derive(Default)]
    pub enum BlocklistAction {
        /// The whole list.
        #[default]
        Default = "",
        /// A change.
        Modify = "modify",
    }
}

/// The blocklist changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blocklist {
    /// Whether this is the whole list or a change.
    pub action: BlocklistAction,
    /// The list hash.
    pub d_hash: String,
    /// The previous list hash.
    pub prev_d_hash: String,
    /// The changes.
    pub changes: Vec<BlocklistChange>,
}

string_enum! {
    /// A blocklist change action.
    pub enum BlocklistChangeAction {
        /// Blocked.
        Block = "block",
        /// Unblocked.
        Unblock = "unblock",
    }
}

/// One blocklist change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlocklistChange {
    /// Who.
    pub jid: Jid,
    /// Blocked or unblocked.
    pub action: BlocklistChangeAction,
}
