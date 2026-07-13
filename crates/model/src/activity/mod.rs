use std::cmp::Ordering;

pub mod map_item;
use crate::project::Project;

use super::{chat::Chat, document::BasicDocument};
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
pub enum Activity {
    Document(BasicDocument),
    Chat(Chat),
}

impl PartialOrd for Activity {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Activity {
    fn cmp(&self, other: &Self) -> Ordering {
        let self_date = match self {
            Activity::Document(doc) => &doc.updated_at,
            Activity::Chat(chat) => &chat.updated_at,
        };
        let other_date = match other {
            Activity::Document(doc) => &doc.updated_at,
            Activity::Chat(chat) => &chat.updated_at,
        };
        self_date.cmp(other_date)
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
pub enum PinnedActivity {
    Document(BasicDocument),
    Chat(Chat),
    Project(Project),
}

impl PartialOrd for PinnedActivity {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PinnedActivity {
    fn cmp(&self, other: &Self) -> Ordering {
        let self_date = match self {
            PinnedActivity::Document(doc) => &doc.updated_at,
            PinnedActivity::Chat(chat) => &chat.updated_at,
            PinnedActivity::Project(project) => &project.updated_at,
        };
        let other_date = match other {
            PinnedActivity::Document(doc) => &doc.updated_at,
            PinnedActivity::Chat(chat) => &chat.updated_at,
            PinnedActivity::Project(project) => &project.updated_at,
        };
        self_date.cmp(other_date)
    }
}
