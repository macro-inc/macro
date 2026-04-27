use crate::domain::models::graph;
use crate::domain::models::graph::{Edge, Vertex};
use model::contacts::ConnectionsMessage;
use model::document::ID;
use std::collections::{HashMap, HashSet};

/// A user identifier, aliased from the model document ID type.
pub type User = ID;

/// Creates a [`User`] from a string identifier.
pub fn create_user(id: &str) -> User {
    User { id: id.to_string() }
}

/// A group of user participants, stored as a set of vertices.
#[derive(Default, Debug)]
pub struct Group {
    /// The set of participants in this group.
    pub participants: HashSet<Vertex<User>>,
}

/// A connection between two users (an edge in the user graph).
pub type Connection<'a> = Edge<'a, User>;
/// A single user vertex in the graph.
pub type UserVertex = Vertex<User>;

impl Group {
    /// Creates edges from a single user vertex to all existing participants.
    pub fn append<'a, 'b>(&'a self, user: &'b Vertex<User>) -> Vec<Connection<'b>>
    where
        'a: 'b,
    {
        graph::append(&self.participants, user)
    }

    /// Generates all pairwise connections among participants.
    pub fn generate(&self) -> Vec<Connection<'_>> {
        graph::generate(&self.participants)
    }

    /// Creates a new group from a slice of user ID strings.
    pub fn new(group: &[String]) -> Self {
        Self::default().append_participants(group)
    }

    /// Adds participants to the group from a slice of user ID strings.
    pub fn append_participants(mut self, group: &[String]) -> Group {
        for user in group {
            self.participants.insert(Vertex::new(create_user(user)));
        }
        self
    }
}

/// Converts a group and its connections into a [`ConnectionsMessage`].
pub fn create_connections_message(group: &Group, connections: &[Connection]) -> ConnectionsMessage {
    let mut users = vec![];
    let mut user_to_index: HashMap<String, usize> = HashMap::new();

    for user in &group.participants {
        let id = user.data.id.clone();
        let pos = users.len();
        users.push(id);
        user_to_index.insert(users[pos].clone(), pos);
    }

    let mut connection_references = vec![];

    for con in connections {
        let user_a = &con.a.data.id;
        let user_b = &con.b.data.id;

        // TODO: error handling
        let user_a_index = if let Some(idx) = user_to_index.get(user_a) {
            idx
        } else {
            panic!("Could not find user '{}'", user_a);
        };
        let user_b_index = user_to_index.get(user_b).unwrap();
        connection_references.push((*user_a_index, *user_b_index));
    }

    ConnectionsMessage {
        users,
        connections: connection_references,
    }
}

/// Unpacks a [`ConnectionsMessage`] into a list of user vertices.
pub async fn unpack_users(msg: &ConnectionsMessage) -> Vec<Vertex<User>> {
    let mut vertex_list = vec![];

    for user in &msg.users {
        let vtx = Vertex::new(User {
            id: user.to_string(),
        });
        vertex_list.push(vtx);
    }

    vertex_list
}

/// Unpacks the connections from a [`ConnectionsMessage`] using the given user vertices.
pub async fn unpack_connections<'a, 'b>(
    msg: &'a ConnectionsMessage,
    users: &'b [Vertex<User>],
) -> Vec<Connection<'b>>
where
    'a: 'b,
{
    let mut connections = vec![];

    for con in &msg.connections {
        connections.push(Connection {
            a: &users[con.0],
            b: &users[con.1],
        })
    }

    connections
}

impl UserVertex {
    /// Generates a user vertex from a name string.
    pub fn generate(name: &str) -> Self {
        Vertex::new(create_user(name))
    }
}

#[cfg(test)]
mod test;
