use crate::domain::models::graph::{UndirectedGraph, Vertex};
use macro_user_id::user_id::MacroUserIdStr;

/// A user identifier.
#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct User {
    /// The typed ID for this user.
    pub id: MacroUserIdStr<'static>,
}

/// A group of user participants.
#[derive(Default, Debug)]
pub struct Group {
    users: Vec<User>,
}

impl Group {
    /// Creates a new group from a slice of user IDs.
    pub fn new(group: &[MacroUserIdStr<'static>]) -> Self {
        Self::default().append_participants(group)
    }

    /// Adds participants to the group.
    pub fn append_participants(mut self, group: &[MacroUserIdStr<'static>]) -> Group {
        for user in group {
            self.users.push(User { id: user.clone() });
        }
        self
    }

    /// Generates all pairwise connections among participants.
    pub fn generate(&self) -> Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)> {
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
