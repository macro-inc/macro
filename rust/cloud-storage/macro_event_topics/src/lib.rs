#![deny(missing_docs)]
//! Defines all topics for kafka.
//! This file is also programmatically grabbed in infra to ensure all kafka topics are created.

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
    /// The kafka topic name as a string.
    fn as_str(&self) -> &'static str;
}

/// Example kafka topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MacroExampleTopic;

#[sealed]
impl Topic for MacroExampleTopic {
    fn as_str(&self) -> &'static str {
        "macro.example"
    }
}
