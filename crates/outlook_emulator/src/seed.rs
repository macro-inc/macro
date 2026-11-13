//! The seed file: the mailboxes and calendars an emulator starts with, as
//! YAML or JSON.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Everything an emulator starts with. Every field is optional.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Seed {
    /// The emulator's starting time. Defaults to the real time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<DateTime<Utc>>,
    /// The mailboxes.
    #[serde(default)]
    pub mailboxes: Vec<SeedMailbox>,
}

/// Why a seed could not be read.
#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    /// The text is neither valid YAML nor valid JSON for a [`Seed`].
    #[error("seed is not valid: {0}")]
    Parse(#[from] serde_yaml::Error),
    /// The seed file could not be read.
    #[error("seed file could not be read: {0}")]
    Read(#[from] std::io::Error),
    /// Something in a seeded mailbox could not be built.
    #[error("seed mailbox {mailbox}: {source}")]
    Mailbox {
        /// The mailbox it belongs to.
        mailbox: String,
        /// What was wrong.
        source: crate::EmulatorError,
    },
}

impl Seed {
    /// Parses a seed from YAML. JSON is a subset of YAML, so it parses too.
    pub fn parse(text: &str) -> Result<Self, SeedError> {
        Ok(serde_yaml::from_str(text)?)
    }

    /// Reads a seed from a YAML or JSON file.
    pub fn read(path: &std::path::Path) -> Result<Self, SeedError> {
        Self::parse(&std::fs::read_to_string(path)?)
    }

    /// A seed holding one empty mailbox per address.
    pub fn with_mailboxes<'a>(emails: impl IntoIterator<Item = &'a str>) -> Self {
        Self {
            mailboxes: emails.into_iter().map(SeedMailbox::new).collect(),
            ..Self::default()
        }
    }
}

/// One mailbox.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedMailbox {
    /// The mailbox address.
    pub email: String,
    /// The owner's display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The OAuth refresh token of the mailbox's grant. Defaults to
    /// `refresh-<email>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Leaves `xms_edov` out of the user's ID tokens: Microsoft has not
    /// verified that the account's organization owns the address's domain,
    /// so Sign in with Microsoft is refused.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unverified_email_domain: bool,
    /// The Macro email link (`email_links.id`) this mailbox is connected
    /// as, which the authentication-service stand-in answers tokens for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    /// Requests the mailbox may make per ten minutes before Graph answers
    /// 429. Defaults to Graph's 10,000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requests_per_ten_minutes: Option<u32>,
    /// Days a delta token stays valid. Forever when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_token_lifetime_days: Option<u32>,
    /// Leaves out the Archive folder, as in a mailbox that never archived.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub without_archive_folder: bool,
    /// Folders, besides Outlook's well-known ones.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<SeedFolder>,
    /// Master categories.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    /// Contacts in the default contacts folder.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contacts: Vec<SeedContact>,
    /// Messages, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<NewMessage>,
    /// `mailboxSettings.timeZone`: a Windows name such as `Pacific Standard
    /// Time`, an IANA name, or one Macro cannot map. Defaults to `UTC`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
    /// Calendars. Every mailbox has a default calendar named `Calendar`;
    /// an entry marked `default` describes it, and the others are added.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calendars: Vec<SeedCalendar>,
}

impl SeedMailbox {
    /// An empty mailbox.
    pub fn new(email: &str) -> Self {
        Self {
            email: email.to_string(),
            ..Self::default()
        }
    }
}

/// A mail folder.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedFolder {
    /// The display name, which messages name it by in a seed.
    pub name: String,
    /// The display name or well-known name of its parent. The mailbox root
    /// when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

/// A calendar.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedCalendar {
    /// The calendar's name.
    pub name: String,
    /// Whether this entry describes the mailbox's default calendar.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub default: bool,
    /// Graph's `color`, such as `lightBlue`. Defaults to `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Graph's `hexColor`, such as `#0078d4`. Empty when absent, as for a
    /// calendar whose colour is `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hex_color: Option<String>,
    /// Whether the owner can only read it (`canEdit` false), like a
    /// holiday calendar.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
    /// `allowedOnlineMeetingProviders`. Defaults to `teamsForBusiness`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub online_meeting_providers: Option<Vec<String>>,
    /// Its events.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<NewEvent>,
}

/// An event to put on a calendar: seeded, or added later.
///
/// It is the JSON a client posts to Graph to create an event (`subject`,
/// `start`, `end`, `isAllDay`, `recurrence`, `attendees`, `body`,
/// `location`, `showAs`, `singleValueExtendedProperties`, …). `start` and
/// `end` name an IANA zone or `UTC`. Besides those it may say what
/// Exchange decides or what someone else did:
///
/// - `organizer` (someone else's meeting), `responseStatus`, `iCalUId`,
///   `isCancelled`, `hasAttachments`, `onlineMeeting`, `onlineMeetingUrl`;
/// - `originalStartTimeZone` and `originalEndTimeZone`: the zone names
///   Graph answers, such as `Pacific Standard Time` or
///   `tzone://Microsoft/Custom`;
/// - `exceptions`: changed occurrences of a series, each the `date` the
///   series puts it on and the properties that differ;
/// - `cancelledOccurrences`: dates of deleted occurrences;
/// - `raw`: properties answered verbatim in place of the computed ones,
///   for an event a real mailbox holds that Graph's own writes never make.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(transparent)]
pub struct NewEvent(pub serde_json::Map<String, serde_json::Value>);

/// A contact.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedContact {
    /// The contact's address.
    pub email: String,
    /// Their display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A message to put in a mailbox: seeded, or delivered later.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NewMessage {
    /// The sender, as a header value (`Ada <ada@example.com>`). Defaults to
    /// the mailbox owner for a draft or a sent message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// The recipients, as a header value. Defaults to the mailbox address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// The copied recipients, as a header value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cc: Option<String>,
    /// The subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The plain-text body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The HTML body. Wins over `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Attachments.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<NewAttachment>,
    /// The folder: a well-known name (`inbox`, `sentitems`, `drafts`,
    /// `deleteditems`, `junkemail`, `archive`) or a folder's display name.
    /// Defaults to `inbox`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    /// Whether it is read. Defaults to unread in the inbox, read elsewhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
    /// Whether it is flagged.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flagged: bool,
    /// Its categories.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    /// Whether Focused Inbox puts it under Other.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub other: bool,
    /// When it was received (or sent). Defaults to the emulator's time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<DateTime<Utc>>,
    /// The `Message-ID`, without angle brackets. Defaults to a generated one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// The `Message-ID` this message replies to, without angle brackets. A
    /// reply joins the conversation of the message it names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
    /// The conversation to join, instead of threading by `in_reply_to`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// An iCalendar body. The message is then a meeting request
    /// (`eventMessage`) whose MIME source carries it as `text/calendar`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<String>,
}

/// An attachment of a [`NewMessage`].
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NewAttachment {
    /// The file name.
    pub filename: String,
    /// The content type. Defaults to `application/octet-stream`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// The content, as text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The content, as standard base64. Wins over `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
    /// A `Content-ID`, which makes the attachment inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
}
