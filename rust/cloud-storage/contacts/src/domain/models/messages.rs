use serde::{Deserialize, Serialize};

/// A message containing a group of users and their pairwise connections by index.
#[derive(Serialize, Deserialize, Debug)]
pub struct ConnectionsMessage {
    /// Ordered list of user IDs referenced by `connections`.
    pub users: Vec<String>,
    /// Pairs of indices into `users` representing connections.
    pub connections: Vec<(usize, usize)>,
}

/// Body of an add-participants message, adding users to an existing group.
#[derive(Serialize, Deserialize, Debug)]
pub struct AddParticipantsMessageBody {
    /// New participants being added.
    pub participants: Vec<String>,
    /// Existing group members.
    pub group: Vec<String>,
}

/// Body of a create-group message.
#[derive(Serialize, Deserialize, Debug)]
pub struct CreateGroupMessageBody {
    /// All participants in the new group.
    pub group: Vec<String>,
}

/// Envelope for all contact-related SQS messages.
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "body")]
pub enum Message {
    /// Adds a connection from an existing connections graph.
    #[serde(rename = "add_connection")]
    AddConnection(ConnectionsMessage),
    /// Adds participants to an existing group.
    #[serde(rename = "add_participants")]
    AddParticipants(AddParticipantsMessageBody),
    /// Creates a new group.
    #[serde(rename = "create_group")]
    CreateGroup(CreateGroupMessageBody),
}
