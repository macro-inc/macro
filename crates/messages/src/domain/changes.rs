//! Targets recorded by committed channel writes.

use uuid::Uuid;

/// The current state a log row asks a client to load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelChangeKind {
    /// A message, including its reactions or thread state, changed.
    Message(Uuid),
    /// A system activity shown by the channel timeline was recorded.
    Activity(Uuid),
    /// The channel history was rewritten in bulk.
    Reset,
}
