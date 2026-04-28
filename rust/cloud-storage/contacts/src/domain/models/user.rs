use crate::domain::models::graph::{UndirectedGraph, Vertex};

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

/// A group of user participants.
#[derive(Default, Debug)]
pub struct Group {
    users: Vec<User>,
}

impl Group {
    /// Creates a new group from a slice of user ID strings.
    pub fn new(group: &[String]) -> Self {
        Self::default().append_participants(group)
    }

    /// Adds participants to the group from a slice of user ID strings.
    pub fn append_participants(mut self, group: &[String]) -> Group {
        for user in group {
            self.users.push(create_user(user));
        }
        self
    }

    /// Generates all pairwise connections among participants.
    pub fn generate(&self) -> Vec<(String, String)> {
        UndirectedGraph::new(self.users.iter().map(Vertex::new))
            .complete()
            .inner()
            .edges()
            .map(|e| (e.a().data().id.clone(), e.b().data().id.clone()))
            .collect()
    }
}

#[cfg(test)]
mod test;
