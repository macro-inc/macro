//! Stateless thread lookup planning. No conversation-sized history map is retained.

use uuid::Uuid;

use crate::domain::models::{ConversationId, SlackTimestamp, SourceMessageId, TeamId};

use super::export::NormalizedMessage;

#[cfg(test)]
mod test;

/// Exact source identity before attaching the importing team's namespace.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MessageIdentity {
    /// Source conversation, never inferred from the timestamp or filename date.
    pub conversation: ConversationId,
    /// Integer seconds/microseconds; no floating-point rounding.
    pub ts: SlackTimestamp,
}

impl MessageIdentity {
    /// Scope a lookup/dedupe key to the team's bound Slack workspace.
    pub fn in_team(self, team_id: TeamId) -> SourceMessageId {
        SourceMessageId {
            team_id,
            slack_channel_id: self.conversation,
            ts: self.ts,
        }
    }
}

/// Parent lookup requirement derived exclusively from thread_ts, never replies[].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadReference {
    /// No thread_ts, or a root's self-referencing thread_ts.
    Root,
    /// Look up this exact root, even when it is in a different day file/part/job.
    Reply(MessageIdentity),
}

/// Outcome after the worker resolves a parent using its bounded batch and durable
/// mappings. A missing parent is retained as metadata, not silently forgotten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadPlacement {
    /// Top-level source message.
    Root,
    /// Existing/imported root, already checked by the worker for target ownership.
    Reply(Uuid),
    /// Root is missing/skipped; import at top level with orphaned_thread_ts.
    /// A later archive does not automatically repair this relationship in v1.
    Orphan(SlackTimestamp),
}

impl NormalizedMessage {
    /// Return the lookup key without maintaining state across messages or files.
    pub fn thread_reference(&self) -> ThreadReference {
        match self.thread_ts {
            Some(ts) if ts != self.identity.ts => ThreadReference::Reply(MessageIdentity {
                conversation: self.identity.conversation.clone(),
                ts,
            }),
            _ => ThreadReference::Root,
        }
    }
}

impl ThreadReference {
    /// Key to resolve in the current bounded batch or the durable source mapping.
    /// Callers must finish lookup before treating absence as an orphan.
    pub fn parent_lookup(&self) -> Option<&MessageIdentity> {
        match self {
            Self::Root => None,
            Self::Reply(parent) => Some(parent),
        }
    }

    /// Apply a completed lookup. Supplying a parent does not itself authorize it:
    /// the historical sink still validates that it belongs to the target channel.
    pub fn resolve(&self, parent_id: Option<Uuid>) -> ThreadPlacement {
        match self {
            Self::Root => ThreadPlacement::Root,
            Self::Reply(parent) => match parent_id {
                Some(id) => ThreadPlacement::Reply(id),
                None => ThreadPlacement::Orphan(parent.ts),
            },
        }
    }
}
