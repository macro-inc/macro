use crate::domain::models::graph;
use crate::domain::models::graph::{Edge, Vertex};
use std::collections::HashSet;

/// A user identifier.
#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct User {
    /// The string ID for this user.
    pub id: String,
}

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

impl UserVertex {
    /// Generates a user vertex from a name string.
    pub fn generate(name: &str) -> Self {
        Vertex::new(create_user(name))
    }
}

#[cfg(test)]
mod test;
