//! What one pushed frame changed.

use std::borrow::Cow;

use super::FoldedMessage;
use super::metadata::SessionMetadata;

/// One change a pushed log frame implied. A push reports every change in
/// order; most frames report none.
///
/// Payloads are borrowed from the machine and carried whole rather than as
/// deltas: a consumer replaces what it holds under the same
/// [`FoldedMessage::id`], or replaces its metadata outright.
#[derive(Debug, Clone, PartialEq)]
pub enum FoldEvent<'a> {
    /// A message the machine had not derived before. Reported exactly once
    /// per message, before any update to it.
    NewMessage(Cow<'a, FoldedMessage>),
    /// A message the machine had already reported, whose content changed.
    MessageUpdate(Cow<'a, FoldedMessage>),
    /// The metadata changed - restating identical metadata reports nothing.
    MetadataUpdated(Cow<'a, SessionMetadata>),
}

/// A fold event that owns whatever it carries.
pub type OwnedFoldEvent = FoldEvent<'static>;

impl FoldEvent<'_> {
    /// The message that changed, or `None` when this event is not about a
    /// message.
    #[must_use]
    pub fn message(&self) -> Option<&FoldedMessage> {
        match self {
            Self::NewMessage(message) | Self::MessageUpdate(message) => Some(message.as_ref()),
            Self::MetadataUpdated(_) => None,
        }
    }

    /// Own the payload so this event can cross a task boundary.
    #[must_use]
    pub fn into_owned(self) -> OwnedFoldEvent {
        match self {
            Self::NewMessage(message) => FoldEvent::NewMessage(Cow::Owned(message.into_owned())),
            Self::MessageUpdate(message) => {
                FoldEvent::MessageUpdate(Cow::Owned(message.into_owned()))
            }
            Self::MetadataUpdated(metadata) => {
                FoldEvent::MetadataUpdated(Cow::Owned(metadata.into_owned()))
            }
        }
    }
}
