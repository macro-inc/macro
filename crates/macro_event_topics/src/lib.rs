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
pub trait Topic: Default + Copy + Send + Sync + 'static {
    /// The kafka topic name as a string.
    fn as_str(&self) -> &'static str;
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
                fn as_str(&self) -> &'static str {
                    $topic
                }
            }
        )*

        /// The names of all Kafka topics defined in this crate.
        pub fn all_topic_names() -> Vec<&'static str> {
            vec![$($name.as_str()),*]
        }
    };
}

topics! {
    /// Example kafka topic.
    MacroExampleTopic => "macro.example",
    /// Document lifecycle events (created / updated / deleted / copied).
    MacroDocumentsTopic => "macro.documents",
    /// Project lifecycle events (created, updated, deleted, restored, permanently deleted, and uploaded).
    MacroProjectsTopic => "macro.projects",
    /// Channel lifecycle, message, participant, and attachment events.
    MacroChannelsTopic => "macro.channels",
    /// Email lifecycle events (links, messages, threads, labels).
    MacroEmailTopic => "macro.email",
    /// Webhook configuration lifecycle events (created / updated / deleted / validated).
    MacroWebhooksTopic => "macro.webhooks",
}
