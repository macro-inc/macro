//! Parent-independent parsing of message mention identities.

use super::models::SimpleMention;
use bot_id::{BotId, BotIdStr};
use std::collections::HashSet;

/// Entity type used by message mentions that target a bot.
pub const BOT_MENTION_ENTITY_TYPE: &str = "bot";

/// Collect the bot ids mentioned in a message.
///
/// Bot mentions normally arrive tagged `bot`, but Macro AI is surfaced through
/// the user-mention UI, so a `user` mention whose id is exactly the Macro AI
/// bot is recognized as a bot mention too.
///
/// Ids must be in the canonical `bot|<uuid>` principal form; bare UUIDs are
/// rejected (historical bare-UUID content is normalized by migration).
///
/// Shared by message consumers that resolve agent mentions.
pub fn bot_mention_ids(mentions: &[SimpleMention]) -> Vec<BotId> {
    let mut seen = HashSet::new();
    mentions
        .iter()
        .filter_map(|mention| match mention.entity_type.as_str() {
            BOT_MENTION_ENTITY_TYPE => BotIdStr::parse_from_str(&mention.entity_id)
                .ok()
                .map(|id| id.bot_id()),
            "user" => BotIdStr::parse_from_str(&mention.entity_id)
                .ok()
                .map(|id| id.bot_id())
                .filter(|id| *id == bot_id::MACRO_AI_BOT_ID),
            _ => None,
        })
        .filter(|id| seen.insert(*id))
        .collect()
}

/// Parsed message reference vocabulary; recognizing a kind never grants access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageReferenceKind {
    /// A human principal, or the special Macro AI user mention.
    User,
    /// A canonical bot principal.
    Bot,
    /// A document.
    Document,
    /// A channel.
    Channel,
    /// An email thread (editors serialize this as `thread`).
    EmailThread,
    /// A call.
    Call,
    /// A calendar event.
    CalendarEvent,
    /// An AI chat.
    Chat,
    /// A project.
    Project,
    /// Static image attachment.
    StaticImage,
    /// Static video attachment.
    StaticVideo,
    /// Authored channel group; recipients are resolved separately.
    Group,
    /// A CRM company.
    CrmCompany,
    /// A CRM contact.
    CrmContact,
    /// An automation reference; recognized separately from message authorization support.
    Automation,
}
impl MessageReferenceKind {
    /// Normalize reference aliases from editors and Markdown extractors.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "user" => Self::User,
            "bot" => Self::Bot,
            "document" => Self::Document,
            "channel" => Self::Channel,
            "thread" | "email_thread" | "email" => Self::EmailThread,
            "call" => Self::Call,
            "calendar_event" => Self::CalendarEvent,
            "chat" => Self::Chat,
            "project" => Self::Project,
            "static/image" => Self::StaticImage,
            "static/video" => Self::StaticVideo,
            "group" => Self::Group,
            "crm_company" => Self::CrmCompany,
            "crm_contact" => Self::CrmContact,
            "automation" => Self::Automation,
            _ => return None,
        })
    }
}
