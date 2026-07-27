#![deny(missing_docs)]
//! Defines all topics for kafka.
//! This file is also programmatically grabbed in infra to ensure all kafka topics are created.

#[cfg(test)]
mod test;

use sealed::sealed;

/// Errors that can occur for a Topic
#[derive(Debug, thiserror::Error)]
pub enum TopicError {
    /// The Kafka topic name is not known to this broker crate.
    #[error("unknown event topic: {0}")]
    UnknownTopic(String),
}

/// A Topic is mapped to a Kafka topic that events can be published to.
#[sealed]
pub trait Topic: Copy + Send + Sync + 'static {
    /// the statically known string name of this topic
    const TOPIC_STR: &'static str;
}

/// Defines each topic struct with its `Topic` impl, plus [`all_topic_names`]
/// so every declared topic is automatically included in the registry.
macro_rules! topics {
    ($($(#[$meta:meta])* $name:ident => $topic:literal),* $(,)?) => {
        $(
            $(#[$meta])*
            #[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Hash)]
            pub struct $name;

            #[sealed]
            impl Topic for $name {
                const TOPIC_STR: &'static str = $topic;
            }
        )*

        /// The names of all Kafka topics defined in this crate.
        pub fn all_topic_names() -> &'static [&'static str] {
            &[$($name::TOPIC_STR),*]
        }
    };
}

topics! {
    /// Example kafka topic.
    MacroExampleTopic => "macro.example",
    /// Bot lifecycle events (created / updated / deleted).
    MacroBotsTopic => "macro.bots",
    /// Document lifecycle events (created / updated / deleted / copied).
    MacroDocumentsTopic => "macro.documents",
    /// User-scoped full Soup items produced from entity updates.
    MacroSoupRealtimeTopic => "macro.soup",
    /// Project lifecycle events (created, updated, deleted, restored, permanently deleted, and uploaded).
    MacroProjectsTopic => "macro.projects",
    /// Team lifecycle, invite, and membership events.
    MacroTeamsTopic => "macro.teams",
    /// Channel lifecycle, message, participant, and attachment events.
    MacroChannelsTopic => "macro.channels",
    /// Email lifecycle events (links, messages, threads, labels).
    MacroEmailTopic => "macro.email",
    /// Webhook configuration lifecycle events (created / updated / deleted / validated).
    MacroWebhooksTopic => "macro.webhooks",
    /// Entity mention events (created / deleted) across channels and docs.
    MacroMentionsTopic => "macro.mentions",
    /// AI chat lifecycle events (created / updated / deleted / restored / copied).
    MacroChatsTopic => "macro.chats",
}
