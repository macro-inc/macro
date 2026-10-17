//! The reminder Soup entity, kept as an uninhabited type for clients built
//! before reminders became email snoozes (#7536). Their shared Soup document
//! spreads `... on GraphqlSoupReminder`, and an unknown type fails validation
//! of the whole document, so every Soup list on those clients errored. Soup
//! never returns a reminder.

use std::convert::Infallible;

use async_graphql::{Enum, ID, Object};
use graphql_common::{GraphqlEntityType, GraphqlSoupEntityType};

use super::{GraphqlEntityMetadata, SoupCacheProjection, SoupEntityEdges};

/// How often a reminder fires. Never returned. Remove after 2026-11-30.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlReminderScheduleType {
    /// Fires once, at `remindAt`.
    Once,
    /// Fires repeatedly, on `cron` evaluated in `timezone`.
    Recurring,
}

/// The entity a reminder was about. Never returned. Remove after 2026-11-30.
pub struct GraphqlSoupReminderReference(Infallible);

impl GraphqlSoupReminderReference {
    /// Any resolver's value: the type has no values, so none ever runs.
    fn never<T>(&self) -> T {
        match self.0 {}
    }
}

/// The entity a reminder was about. Never returned. Remove after 2026-11-30.
#[Object(name = "GraphqlSoupReminderReference")]
impl GraphqlSoupReminderReference {
    /// The referenced entity's id.
    async fn id(&self) -> ID {
        self.never()
    }

    /// The referenced entity's type.
    async fn entity_type(&self) -> GraphqlEntityType {
        self.never()
    }

    /// File type, when the reference is a document.
    async fn file_type(&self) -> Option<String> {
        self.never()
    }

    /// Sub type, when the reference is a task or snippet document.
    async fn sub_type(&self) -> Option<String> {
        self.never()
    }
}

/// A removed reminder entity. Never returned. Remove after 2026-11-30.
pub struct GraphqlSoupReminder<E: SoupEntityEdges>(pub(super) Infallible, pub(super) E);

impl<E: SoupEntityEdges> GraphqlSoupReminder<E> {
    /// Any resolver's value: the type has no values, so none ever runs.
    fn never<T>(&self) -> T {
        match self.0 {}
    }
}

/// A removed reminder entity. Soup no longer returns reminders (#7536); the
/// type remains so documents from older clients validate. Remove after
/// 2026-11-30.
#[Object(name = "GraphqlSoupReminder")]
impl<E: SoupEntityEdges> GraphqlSoupReminder<E> {
    /// The unique identifier.
    pub(crate) async fn id(&self) -> ID {
        self.never()
    }

    /// Canonical entity kind.
    pub(crate) async fn entity_type(&self) -> GraphqlSoupEntityType {
        self.never()
    }

    /// Opaque cache projection metadata.
    pub(crate) async fn cache_projection(&self) -> Option<SoupCacheProjection> {
        self.never()
    }

    /// The reminder's description.
    pub(crate) async fn display_name(&self) -> Option<String> {
        self.never()
    }

    /// Common reminder metadata.
    pub(crate) async fn metadata(&self) -> GraphqlEntityMetadata {
        self.never()
    }

    /// The entity this reminder was about.
    async fn referenced_entity(&self) -> Option<GraphqlSoupReminderReference> {
        self.never()
    }

    /// What to remind the user about.
    async fn description(&self) -> String {
        self.never()
    }

    /// Whether the reminder fires once or repeatedly.
    async fn schedule_type(&self) -> GraphqlReminderScheduleType {
        self.never()
    }

    /// The instant a one-shot reminder fires at, in RFC 3339 format.
    async fn remind_at(&self) -> Option<String> {
        self.never()
    }

    /// The cron expression a recurring reminder fires on.
    async fn cron(&self) -> Option<String> {
        self.never()
    }

    /// The timezone a recurring reminder's cron is evaluated in.
    async fn timezone(&self) -> Option<String> {
        self.never()
    }

    /// The next firing, in RFC 3339 format.
    async fn next_run_at(&self) -> String {
        self.never()
    }

    /// When false, the dispatcher skips this reminder.
    async fn enabled(&self) -> bool {
        self.never()
    }

    /// When a one-shot reminder fired, in RFC 3339 format.
    async fn completed_at(&self) -> Option<String> {
        self.never()
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.never()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.never()
    }

    /// Common entity edges, including properties and viewer permissions.
    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.never()
    }

    /// The viewer's frecency score for this entity.
    pub(crate) async fn frecency_score(&self) -> Option<f64> {
        self.never()
    }
}
