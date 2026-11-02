//! A task listed in a project.

use uuid::Uuid;

/// A live task whose Project property names exactly one project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectTask {
    /// The task's document id.
    pub id: String,
    /// The task's Status option, when it has one.
    pub status: Option<Uuid>,
}
