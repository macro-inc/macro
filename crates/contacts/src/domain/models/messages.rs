use super::list::InboxSource;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[cfg(test)]
mod test;

/// A contacts SQS message carrying the list of user IDs to connect. All users in the set will
/// get connected with all other users in the set.
#[derive(Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct ContactsNodes {
    /// User IDs whose pairwise connections should be upserted.
    pub users: HashSet<MacroUserIdStr<'static>>,
}

/// An explicit undirected relationship between two contacts users.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub struct ContactConnection {
    /// One endpoint of the relationship.
    pub first: MacroUserIdStr<'static>,
    /// The other endpoint of the relationship.
    pub second: MacroUserIdStr<'static>,
}

impl ContactConnection {
    /// Creates an explicit relationship between two users.
    pub fn new(first: MacroUserIdStr<'static>, second: MacroUserIdStr<'static>) -> Self {
        Self { first, second }
    }
}

/// A contacts SQS message carrying only explicitly requested relationships.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContactConnections {
    /// Relationships to upsert.
    pub connections: Vec<ContactConnection>,
}

impl ContactConnections {
    /// Creates an explicit-relationships message.
    pub fn new(connections: Vec<ContactConnection>) -> Self {
        Self { connections }
    }
}

/// A contacts SQS message carrying legacy relationships to remove, such as
/// the ones a team membership wrote once that membership ends.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContactDisconnections {
    /// Relationships to delete.
    pub disconnections: Vec<ContactConnection>,
}

impl ContactDisconnections {
    /// Creates a remove-relationships message.
    pub fn new(disconnections: Vec<ContactConnection>) -> Self {
        Self { disconnections }
    }
}

/// A change to directed, list-aware directory membership. Each variant names
/// bounded id lists; [`crate::domain::ports::ContactListIngress`] chunks them.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum DirectoryChange {
    /// Every user and every peer have interacted: each gains the other in
    /// their `interacted` list. Self-pairs are skipped.
    Interacted {
        /// One side of every pair.
        users: Vec<MacroUserIdStr<'static>>,
        /// The other side of every pair.
        peers: Vec<MacroUserIdStr<'static>>,
    },
    /// The inbox owner knows these contacts through that inbox. Owner to
    /// contact only.
    InboxContacts {
        /// The inbox the contacts were found in.
        inbox: InboxSource,
        /// People known through the inbox.
        contacts: Vec<MacroUserIdStr<'static>>,
    },
    /// Something outside the stored lists, such as a team roster, changed
    /// these users' directories. Notify only; nothing is written.
    Changed {
        /// Users whose clients re-read their directory.
        users: Vec<MacroUserIdStr<'static>>,
        /// Contacts each user re-reads. Empty means unknown: the clients fall
        /// back to their periodic scan.
        changed: Vec<MacroUserIdStr<'static>>,
    },
    /// The account is gone: drop its directory and remove it from every other.
    UserDeleted {
        /// The deleted user.
        user: MacroUserIdStr<'static>,
    },
}

/// A message accepted by the contacts queue consumer.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ContactsMessage {
    /// A list-aware directory change. Tried first: legacy bodies have no
    /// `type` and fall through to the shapes below.
    Change(DirectoryChange),
    /// The existing complete-graph message.
    Nodes(ContactsNodes),
    /// A message containing explicit relationships.
    Connections(ContactConnections),
    /// A message naming legacy relationships to delete.
    Disconnections(ContactDisconnections),
}

impl ContactsMessage {
    /// The message's shape, safe to record on a span.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Change(_) => "change",
            Self::Nodes(_) => "nodes",
            Self::Connections(_) => "connections",
            Self::Disconnections(_) => "disconnections",
        }
    }
}
