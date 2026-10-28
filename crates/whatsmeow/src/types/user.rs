// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/user.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: the bot, business profile, business link, contact QR link and
// status input types.

use chrono::{DateTime, Utc};

use super::{AddressingMode, Jid};
use crate::proto::wa_vname_cert::{VerifiedNameCertificate, verified_name_certificate};

/// A verified business name.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VerifiedName {
    /// The certificate.
    pub certificate: Option<VerifiedNameCertificate>,
    /// The certificate details.
    pub details: Option<verified_name_certificate::Details>,

    /// The verification level.
    pub verified_level: String,
    /// The version.
    pub version: i64,
    /// The host storage.
    pub host_storage: i64,
    /// The actual actors.
    pub actual_actors: i64,
    /// The privacy mode timestamp.
    pub privacy_mode_ts: Option<DateTime<Utc>>,
}

/// Information about a WhatsApp user.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UserInfo {
    /// The verified business name.
    pub verified_name: Option<VerifiedName>,
    /// The about text.
    pub status: String,
    /// The profile picture ID.
    pub picture_id: String,
    /// The user's devices.
    pub devices: Vec<Jid>,
    /// The user's LID.
    pub lid: Jid,
}

/// A user's profile picture.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProfilePictureInfo {
    /// The full URL for the image.
    pub url: String,
    /// The ID of the image, the same as [`UserInfo::picture_id`].
    pub id: String,
    /// The type of image (`image` or `preview`).
    pub r#type: String,
    /// The path to the image.
    pub direct_path: String,
    /// Some kind of hash (format unknown).
    pub hash: Vec<u8>,
}

/// Whether a phone number is on WhatsApp.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct IsOnWhatsAppResponse {
    /// The query string used.
    pub query: String,
    /// The canonical user ID.
    pub jid: Jid,
    /// Whether the phone is registered.
    pub is_in: bool,
    /// The phone number JID.
    pub phone_number: Jid,
    /// The verified business details, if the phone is a business.
    pub verified_name: Option<VerifiedName>,
}

string_enum! {
    /// A privacy setting value.
    #[derive(Default)]
    pub enum PrivacySetting {
        /// Not set.
        #[default]
        Undefined = "",
        /// Everyone.
        All = "all",
        /// Contacts.
        Contacts = "contacts",
        /// Some contacts.
        ContactAllowlist = "contact_allowlist",
        /// Contacts except some.
        ContactBlacklist = "contact_blacklist",
        /// Same as last seen.
        MatchLastSeen = "match_last_seen",
        /// Known.
        Known = "known",
        /// Nobody.
        None = "none",
        /// On (standard).
        OnStandard = "on_standard",
        /// Off.
        Off = "off",
    }
}

string_enum! {
    /// A privacy setting name.
    pub enum PrivacySettingType {
        /// Who can add you to groups.
        GroupAdd = "groupadd",
        /// Who can see your last seen.
        LastSeen = "last",
        /// Who can see your status.
        Status = "status",
        /// Who can see your profile picture.
        Profile = "profile",
        /// Read receipts.
        ReadReceipts = "readreceipts",
        /// Who can see you online.
        Online = "online",
        /// Who can call you.
        CallAdd = "calladd",
        /// Who can message you.
        Messages = "messages",
        /// Defense mode.
        Defense = "defense",
        /// Who can send you stickers.
        Stickers = "stickers",
    }
}

/// The user's privacy settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PrivacySettings {
    /// Who can add you to groups.
    pub group_add: PrivacySetting,
    /// Who can see your last seen.
    pub last_seen: PrivacySetting,
    /// Who can see your status.
    pub status: PrivacySetting,
    /// Who can see your profile picture.
    pub profile: PrivacySetting,
    /// Read receipts.
    pub read_receipts: PrivacySetting,
    /// Who can call you.
    pub call_add: PrivacySetting,
    /// Who can see you online.
    pub online: PrivacySetting,
    /// Who can message you.
    pub messages: PrivacySetting,
    /// Defense mode.
    pub defense: PrivacySetting,
    /// Who can send you stickers.
    pub stickers: PrivacySetting,
}

/// The cached names of a WhatsApp user. Go's `Found` flag is an `Option`
/// around this struct instead.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ContactInfo {
    /// The first name from the address book.
    pub first_name: String,
    /// The full name from the address book.
    pub full_name: String,
    /// The name the user set for themselves.
    pub push_name: String,
    /// The verified business name.
    pub business_name: String,
    /// Only for LID members encountered in groups, the phone number in the
    /// form "+1∙∙∙∙∙∙∙∙80".
    pub redacted_phone: String,
}

/// The cached local settings for a chat. Go's `Found` flag is an `Option`
/// around this struct instead.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalChatSettings {
    /// When the mute ends; `None` when not muted.
    pub muted_until: Option<DateTime<Utc>>,
    /// Whether the chat is pinned.
    pub pinned: bool,
    /// Whether the chat is archived.
    pub archived: bool,
}

/// One blocked user.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BlocklistItem {
    /// The blocked user's LID.
    pub lid: Jid,
    /// The blocked user's phone number JID.
    pub pn: Jid,
    /// Whether the block is active.
    pub active: bool,
}

/// The user's current list of blocked users.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blocklist {
    /// How the list addresses users.
    pub addressing_mode: AddressingMode,
    /// The list hash.
    pub d_hash: String,
    /// The blocked users.
    pub items: Vec<BlocklistItem>,
}

impl Blocklist {
    /// The LIDs of the blocked users.
    pub fn lids(&self) -> Vec<Jid> {
        self.items.iter().map(|item| item.lid.clone()).collect()
    }

    /// Whether the user (by LID or phone number) is blocked.
    pub fn is_blocked(&self, jid: &Jid) -> bool {
        self.items
            .iter()
            .any(|item| item.lid == *jid || item.pn == *jid)
    }
}
