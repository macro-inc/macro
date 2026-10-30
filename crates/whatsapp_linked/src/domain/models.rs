//! Personal accounts, pairing, group rosters and the WhatsApp chat list, as
//! DSS and the web app see them. Session-service events live in
//! [`super::events`]; added chats and sends are `external_chat` models.

use chrono::{DateTime, Utc};
use external_chat::domain::models::{CannotAdd, CommunityReference, ExternalChatKind};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Account lifecycle. Transport outages are not stored: a connected account
/// stays connected while its session service reconnects.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppAccountState))]
#[strum(serialize_all = "snake_case")]
pub enum AccountState {
    /// A pairing transaction is in progress.
    Pairing,
    /// Paired with a verified identity; observation consent is active.
    Connected,
    /// WhatsApp ended the session; the owner must reconnect explicitly.
    LoggedOut,
    /// The owner ended observation consent.
    Disconnected,
}

impl AccountState {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// One person's account, never owned by a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppAccount))]
pub struct Account {
    /// Stable account identity.
    pub id: Uuid,
    /// Authenticated owner.
    pub user_id: String,
    /// WhatsApp-verified identity, absent until the first pairing succeeds.
    pub identity_jid: Option<String>,
    /// Lifecycle.
    pub state: AccountState,
    /// Explicit consent generation; reconnecting a socket never changes it.
    pub authorization_generation: i64,
}

/// Pairing transaction state.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppPairingState))]
#[strum(serialize_all = "snake_case")]
pub enum PairingState {
    /// Waiting for a session-service replica to start the device.
    Waiting,
    /// A QR code or pairing code is ready to show.
    Qr,
    /// WhatsApp asked for a passkey confirmation on the phone.
    Passkey,
    /// Paired; the account is connected.
    Success,
    /// The transaction timed out.
    Expired,
    /// The owner cancelled.
    Cancelled,
    /// Pairing failed or was rejected.
    Failed,
}

impl PairingState {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// Owner-bound pairing transaction, without its QR or pairing code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppPairing))]
pub struct Pairing {
    /// One-use transaction id.
    pub id: Uuid,
    /// Account being connected.
    pub account_id: Uuid,
    /// Current state.
    pub state: PairingState,
    /// Database-assigned deadline.
    pub expires_at: DateTime<Utc>,
}

/// Owner-only pairing status. Deliberately has no `Debug` implementation: the
/// QR and pairing code are secrets for the duration of the transaction.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppPairState))]
pub struct PairState {
    /// Current state.
    pub state: PairingState,
    /// Current QR content; rotates while the transaction waits.
    pub qr: Option<String>,
    /// Pairing code to type on the phone, when phone-number pairing is used.
    pub code: Option<String>,
    /// WhatsApp's WebAuthn request options while the state is `passkey`; the
    /// native authenticator answers through the passkey route.
    #[cfg_attr(feature = "schema", schema(value_type = Option<Object>))]
    pub challenge: Option<serde_json::Value>,
    /// Verified identity once paired.
    pub identity_jid: Option<String>,
    /// Same owner-bound deadline.
    pub expires_at: DateTime<Utc>,
}

/// Verified sender aliases, supplied only by protocol metadata. Stored in
/// roster metadata and retained events as camelCase JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    /// Phone-number or LID account JID.
    pub jid: String,
    /// Verified alternate identity, never inferred from a name or phone typed by a user.
    #[serde(default)]
    pub alternate_jid: Option<String>,
    /// Untrusted display name.
    #[serde(default)]
    pub display_name: Option<String>,
}

impl Identity {
    /// What to call this person: their WhatsApp name, else their phone number.
    pub fn label(&self) -> Option<String> {
        if let Some(name) = self.display_name.as_deref().map(str::trim)
            && !name.is_empty()
        {
            return Some(name.to_owned());
        }
        [Some(self.jid.as_str()), self.alternate_jid.as_deref()]
            .into_iter()
            .flatten()
            .find_map(super::jid::phone_number)
    }
}

/// Current remote participant; Macro access is a separate grant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    /// Identity evidence.
    #[serde(flatten)]
    pub identity: Identity,
    /// Group admin; only admins post in announcement groups.
    pub admin: bool,
}

/// One full metadata read of a group, never an incomplete membership delta.
/// The session service reports it and it is stored as roster metadata
/// (camelCase JSON); the API shows it as [`external_chat::domain::timeline::ExternalChatMembers`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    /// Remote group JID.
    pub jid: String,
    /// Current subject.
    pub name: String,
    /// Full roster.
    pub participants: Vec<Participant>,
    /// Only admins may post.
    pub announce: bool,
    /// Disappearing-messages timer in seconds while it is on. Macro keeps the
    /// messages; its sends carry the timer so phones treat them like their own.
    #[serde(default)]
    pub disappearing_seconds: Option<u32>,
    /// The community itself: it has no messages of its own and can't be added.
    #[serde(default)]
    pub community_parent: bool,
    /// The community a linked subgroup or announcement group belongs to.
    #[serde(default)]
    pub community_jid: Option<String>,
    /// The community's announcement group (everyone reads, admins post).
    #[serde(default)]
    pub community_announcements: bool,
    /// When the session service read this metadata.
    pub observed_at: DateTime<Utc>,
}

/// An external chat entity bound to a remote chat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatReference))]
pub struct ChatReference {
    /// External chat entity id.
    pub id: Uuid,
    /// Display name, following WhatsApp.
    pub name: String,
}

/// Another person's external chat entity the caller can view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = SharedExternalChatReference))]
pub struct SharedChatReference {
    /// External chat entity id.
    pub id: Uuid,
    /// Display name, following WhatsApp.
    pub name: String,
    /// Macro user who added the chat and shared it.
    pub owner_id: String,
}

impl GroupInfo {
    /// Match only protocol-verified aliases; never names.
    pub fn participant(&self, identity: &str) -> Option<&Participant> {
        self.participants.iter().find(|p| {
            p.identity.jid == identity || p.identity.alternate_jid.as_deref() == Some(identity)
        })
    }

    /// The WhatsApp subject, or for an unnamed group the names of its other
    /// members as WhatsApp shows them: "Ana, Ben, +2".
    pub fn display_name(&self, identity: &str) -> String {
        let subject = self.name.trim();
        if !subject.is_empty() {
            return subject.to_owned();
        }
        let others: Vec<&Participant> = self
            .participants
            .iter()
            .filter(|p| {
                p.identity.jid != identity && p.identity.alternate_jid.as_deref() != Some(identity)
            })
            .collect();
        let names: Vec<String> = others
            .iter()
            .filter_map(|p| p.identity.label())
            .take(2)
            .collect();
        if names.is_empty() {
            return "WhatsApp group".to_owned();
        }
        let rest = others.len() - names.len();
        if rest == 0 {
            names.join(", ")
        } else {
            format!("{}, +{rest}", names.join(", "))
        }
    }

    /// The community this group belongs to, named after `parent` (the
    /// community's own metadata) when known.
    pub fn community(&self, parent: Option<&GroupInfo>) -> Option<CommunityReference> {
        Some(CommunityReference::named(
            self.community_jid.clone()?,
            parent.map(|parent| parent.name.as_str()),
            self.community_announcements,
        ))
    }

    /// Whether the given identity may post under the group's current settings.
    pub fn can_post(&self, identity: &str) -> bool {
        self.participant(identity)
            .is_some_and(|p| !self.announce || p.admin)
            && !self.community_parent
    }
}

/// One chat of the caller's WhatsApp chat list, as WhatsApp Web lists it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppChat))]
pub struct Chat {
    /// WhatsApp chat JID: a group, or the other person's phone-number JID
    /// (LID when WhatsApp never told us the number).
    pub jid: String,
    /// Group or direct chat.
    pub kind: ExternalChatKind,
    /// Group: the subject, or member names for an unnamed group. Direct: the
    /// contact or WhatsApp name, else `+<phone>`. Always non-empty.
    pub name: String,
    /// The other person's phone number (`+<digits>`) of a direct chat, when
    /// WhatsApp told us it.
    pub phone_number: Option<String>,
    /// Newest activity WhatsApp reported (message or history sync); `null`
    /// when unknown, as for saved contacts never messaged. The list is
    /// sorted by it, newest first, unknown last.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Archived in WhatsApp.
    pub archived: bool,
    /// Pinned in WhatsApp.
    pub pinned: bool,
    /// The caller's own external chat for this chat, once added.
    pub added: Option<ChatReference>,
    /// Someone else's external chat for this chat shared with the caller,
    /// when the caller has not added their own.
    pub shared: Option<SharedChatReference>,
    /// "Add to Macro" works now.
    pub can_add: bool,
    /// Why it can't be added, when it is neither added, shared nor addable.
    pub cannot_add_reason: Option<CannotAdd>,
    /// The community a group belongs to (a community's group or its
    /// announcement group); `null` otherwise.
    pub community: Option<CommunityReference>,
}

/// The caller's WhatsApp chat list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppChats))]
pub struct ChatList {
    /// Newest activity first; chats with unknown activity last, by name.
    pub chats: Vec<Chat>,
}

/// Where a phone-number lookup is.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppLookupState))]
#[strum(serialize_all = "snake_case")]
pub enum LookupState {
    /// The account's session has not answered yet.
    Pending,
    /// The number has a WhatsApp account; its direct chat is in the chat list.
    Found,
    /// The number has no WhatsApp account.
    #[serde(rename = "not_on_whatsapp")]
    #[strum(serialize = "not_on_whatsapp")]
    NotOnWhatsApp,
    /// WhatsApp did not answer in time, or the account's session is offline.
    Failed,
}

impl LookupState {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// The owner asking whether a phone number has a WhatsApp account, to start
/// a direct chat with it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppLookup))]
pub struct Lookup {
    /// Poll `GET /whatsapp/lookups/{id}` with it.
    pub id: Uuid,
    /// The number asked about, E.164 (`+<digits>`).
    pub phone_number: String,
    /// Progress.
    pub state: LookupState,
    /// Found: the direct chat's JID, now addable from the chat list.
    pub chat_jid: Option<String>,
}

/// Lookups one account may start per [`LOOKUP_WINDOW_MINUTES`]. WhatsApp
/// bans accounts that query many numbers.
pub const LOOKUP_LIMIT: i64 = 20;
/// The window [`LOOKUP_LIMIT`] counts over; older lookups are deleted.
pub const LOOKUP_WINDOW_MINUTES: i32 = 60;
/// A lookup still pending this long after it started has failed.
pub const LOOKUP_EXPIRY_SECONDS: i32 = 60;

/// Most people one text send may @-mention.
pub const MENTION_LIMIT: usize = 64;

/// Largest WebAuthn challenge or assertion passed through a pairing.
pub const PASSKEY_LIMIT_BYTES: usize = 32 * 1024;

/// Days a participant's receipt is kept.
pub const RECEIPT_RETENTION_DAYS: i32 = 30;
/// Unattempted intents expire this long after they were created.
pub const SEND_EXPIRY_SECONDS: i64 = 10 * 60;

/// Owner-scoped account state, including not connected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppAccountView))]
pub struct AccountView {
    /// The caller's account, when one exists.
    pub account: Option<Account>,
}

/// Result of disconnecting an account.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppDisconnect))]
pub struct Disconnect {
    /// The session service was asked to log the device out of WhatsApp. It
    /// unlinks asynchronously; WhatsApp's Linked devices list is authoritative.
    pub remote_unlink_requested: bool,
}
