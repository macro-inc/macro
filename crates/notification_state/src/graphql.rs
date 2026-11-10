//! GraphQL state and lane adapters, also usable by browser-side filter materialization.

use crate::{NotificationLane, NotificationState};

/// The notification state as represented by GraphQL variables and responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "graphql", derive(async_graphql::Enum))]
#[cfg_attr(feature = "graphql", graphql(name = "NotificationState"))]
pub enum GraphqlNotificationState {
    /// Not yet acknowledged.
    Unseen,
    /// Acknowledged but not completed.
    Seen,
    /// Completed.
    Done,
}

impl From<NotificationState> for GraphqlNotificationState {
    fn from(state: NotificationState) -> Self {
        match state {
            NotificationState::Unseen => Self::Unseen,
            NotificationState::Seen => Self::Seen,
            NotificationState::Done => Self::Done,
        }
    }
}

impl From<GraphqlNotificationState> for NotificationState {
    fn from(state: GraphqlNotificationState) -> Self {
        match state {
            GraphqlNotificationState::Unseen => Self::Unseen,
            GraphqlNotificationState::Seen => Self::Seen,
            GraphqlNotificationState::Done => Self::Done,
        }
    }
}

/// The notification lane as represented by GraphQL variables and responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "graphql", derive(async_graphql::Enum))]
#[cfg_attr(feature = "graphql", graphql(name = "NotificationLane"))]
pub enum GraphqlNotificationLane {
    /// Delivered normally: pushed, digested and counted as unread.
    Signal,
    /// Stored and shown in the Noise view, but never pushed, digested or counted as unread.
    Noise,
}

impl From<NotificationLane> for GraphqlNotificationLane {
    fn from(lane: NotificationLane) -> Self {
        match lane {
            NotificationLane::Signal => Self::Signal,
            NotificationLane::Noise => Self::Noise,
        }
    }
}

impl From<GraphqlNotificationLane> for NotificationLane {
    fn from(lane: GraphqlNotificationLane) -> Self {
        match lane {
            GraphqlNotificationLane::Signal => Self::Signal,
            GraphqlNotificationLane::Noise => Self::Noise,
        }
    }
}
