//! What an [`crate::EntityType::ExternalChat`] is a chat of.

use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumString, IntoStaticStr};
use utoipa::ToSchema;

/// The messaging service an external chat lives in.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    Display,
    PartialEq,
    Eq,
    Hash,
    EnumString,
    IntoStaticStr,
    AsRefStr,
    ToSchema,
)]
pub enum ExternalChatProvider {
    /// A WhatsApp account linked as a device.
    #[serde(rename = "whatsapp")]
    #[strum(serialize = "whatsapp")]
    WhatsApp,
    /// A person's own Slack web session, for Slack Connect conversations.
    #[serde(rename = "slack")]
    #[strum(serialize = "slack")]
    Slack,
}

impl ExternalChatProvider {
    /// The service's name as people know it.
    pub fn label(self) -> &'static str {
        match self {
            Self::WhatsApp => "WhatsApp",
            Self::Slack => "Slack",
        }
    }
}

/// Whether an external chat is a group or a one-to-one chat.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    Display,
    PartialEq,
    Eq,
    Hash,
    EnumString,
    IntoStaticStr,
    AsRefStr,
    ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ExternalChatKind {
    /// A group chat.
    Group,
    /// A direct chat with one person.
    Direct,
}
