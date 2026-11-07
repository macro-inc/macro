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

/// A message accepted by the contacts queue consumer.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ContactsMessage {
    /// The existing complete-graph message.
    Nodes(ContactsNodes),
    /// A message containing explicit relationships.
    Connections(ContactConnections),
}
