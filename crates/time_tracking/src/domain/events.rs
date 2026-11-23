//! Time entry facts published to `macro.time_entries` after each write commits.
//!
//! Every event is keyed by the task, so a task's events stay ordered, and
//! carries the task's new Time logged. A note is never published.

use chrono::NaiveDate;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroTimeEntriesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{TimeEntry, TimeEntrySource};

/// One entry's committed change and its task's Time logged afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeEntryChange {
    /// The entry.
    pub entry_id: Uuid,
    /// The task the entry is on.
    pub task_id: String,
    /// Who logged the entry.
    pub user_id: MacroUserIdStr<'static>,
    /// The entry's length in minutes; for a deletion, the length it had.
    pub minutes: u16,
    /// The entry's day; for a deletion, the day it had.
    pub entry_date: NaiveDate,
    /// How the entry was made.
    pub source: TimeEntrySource,
    /// The task's Time logged after the change, in minutes.
    pub total_minutes: u32,
}

impl TimeEntryChange {
    /// The change to `entry` that left its task at `total_minutes`.
    pub fn new(entry: &TimeEntry, total_minutes: u32) -> Self {
        Self {
            entry_id: entry.id,
            task_id: entry.task_id.clone(),
            user_id: entry.user_id.clone(),
            minutes: entry.minutes,
            entry_date: entry.date,
            source: entry.source,
            total_minutes,
        }
    }
}

/// Events on the time entries topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum TimeEntryTopicEvent {
    /// An entry was logged, typed or by a stopped timer.
    #[serde(rename = "time_entry.logged")]
    Logged(TimeEntryChange),
    /// An entry's day, length, note or span changed.
    #[serde(rename = "time_entry.updated")]
    Updated(TimeEntryChange),
    /// An entry was deleted.
    #[serde(rename = "time_entry.deleted")]
    Deleted(TimeEntryChange),
}

impl TopicEvent for TimeEntryTopicEvent {
    type Topic = MacroTimeEntriesTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// A time entry event keyed by its task.
#[derive(Debug, Clone)]
pub struct TimeEntryMacroEvent {
    key: String,
    event: Event<TimeEntryTopicEvent>,
}

impl TimeEntryMacroEvent {
    /// An entry was logged.
    pub fn logged(change: TimeEntryChange) -> Self {
        Self::keyed(TimeEntryTopicEvent::Logged(change))
    }

    /// An entry changed.
    pub fn updated(change: TimeEntryChange) -> Self {
        Self::keyed(TimeEntryTopicEvent::Updated(change))
    }

    /// An entry was deleted.
    pub fn deleted(change: TimeEntryChange) -> Self {
        Self::keyed(TimeEntryTopicEvent::Deleted(change))
    }

    fn keyed(event: TimeEntryTopicEvent) -> Self {
        let key = match &event {
            TimeEntryTopicEvent::Logged(change)
            | TimeEntryTopicEvent::Updated(change)
            | TimeEntryTopicEvent::Deleted(change) => change.task_id.clone(),
        };
        Self {
            key,
            event: Event::new(event),
        }
    }
}

impl MacroEvent for TimeEntryMacroEvent {
    type EventPayload = TimeEntryTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publishes committed time entry events. Publication is best effort: the
/// write already committed, so a failure is logged by the adapter, never
/// returned.
pub trait TimeEntryEventPublisher: Send + Sync + 'static {
    /// Hand the event to the broker.
    fn publish(&self, event: TimeEntryMacroEvent);
}
