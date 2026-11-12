//! The seed file: the mailboxes an emulator starts with, as YAML or JSON.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Everything an emulator starts with. Every field is optional.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Seed {
    /// The emulator's starting time. Defaults to the real time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<DateTime<Utc>>,
    /// Where push notifications are delivered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push: Option<PushConfig>,
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
    /// A message in the seed could not be built.
    #[error("seed mailbox {mailbox}: {source}")]
    Mailbox {
        /// The mailbox the message belongs to.
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

/// The push subscription: where Gmail watch notifications are posted, like a
/// Pub/Sub push subscription on the watch topic.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PushConfig {
    /// The webhook URL each notification is posted to.
    pub endpoint: String,
    /// The `aud` claim of the signed token. Defaults to Macro's webhook audience.
    #[serde(default = "default_audience")]
    pub audience: String,
}

/// The audience `gmail_client` expects on a push token.
pub const DEFAULT_PUSH_AUDIENCE: &str = "macro-gmail-webhook";

fn default_audience() -> String {
    DEFAULT_PUSH_AUDIENCE.to_string()
}

impl PushConfig {
    /// Push to `endpoint` with the default audience.
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            audience: default_audience(),
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
    /// The scopes of the grant. Defaults to the scopes Macro requests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    /// The history id before any seeded message. Defaults to 1000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_id: Option<u64>,
    /// Quota units the mailbox may spend per minute; unlimited when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_units_per_minute: Option<u32>,
    /// User labels, besides Gmail's system labels.
    #[serde(default)]
    pub labels: Vec<SeedLabel>,
    /// Send-as aliases, besides the primary address.
    #[serde(default)]
    pub send_as: Vec<SeedSendAs>,
    /// Contacts (`people/me/connections`).
    #[serde(default)]
    pub contacts: Vec<SeedContact>,
    /// Other contacts (`otherContacts`).
    #[serde(default)]
    pub other_contacts: Vec<SeedContact>,
    /// Messages, oldest first.
    #[serde(default)]
    pub messages: Vec<NewMessage>,
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

/// A user label.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedLabel {
    /// The label id. Defaults to the next `Label_<n>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The label name.
    pub name: String,
}

/// A send-as alias.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedSendAs {
    /// The alias address.
    pub email: String,
    /// Its display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Its HTML signature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Whether the alias is verified (`accepted`) or still `pending`.
    #[serde(default = "default_true")]
    pub verified: bool,
}

fn default_true() -> bool {
    true
}

/// A contact.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedContact {
    /// The contact's address.
    pub email: String,
    /// Their display name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Their photo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo_url: Option<String>,
}

/// A message to put in a mailbox: seeded, or delivered later.
///
/// Give either `raw` (a whole RFC 822 message) or the parts to build one from.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NewMessage {
    /// `From`, as a header value (`Ada <ada@example.com>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// `To`, as a header value. Defaults to the mailbox address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// `Cc`, as a header value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cc: Option<String>,
    /// `Subject`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The plain-text body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The HTML body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Attachments.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<NewAttachment>,
    /// Label ids. Defaults to `INBOX` and `UNREAD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    /// The `Date` header and Gmail's internal date. Defaults to the
    /// emulator's time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<DateTime<Utc>>,
    /// The `Message-ID`, without angle brackets. Defaults to a generated one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// The `Message-ID` this message replies to, without angle brackets. A
    /// reply joins the thread of the message it names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
    /// The Gmail thread id to join, instead of threading by `in_reply_to`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// A whole RFC 822 message. The fields that build one are then ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
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
}
