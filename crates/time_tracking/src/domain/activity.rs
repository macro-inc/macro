//! What counts as activity in time tracking: logging time on a task, recorded
//! on the task with the person who logged it. Correcting or deleting an entry
//! is not new work, so it records nothing; the task's Time logged shows the
//! result. The note never reaches activity.

#[cfg(test)]
mod test;

use activity::{
    Action, Activity, ActivitySource, Actor, DomainActivity, EntityType, Ingest, TimeLog,
    TimeLogSource, event_time,
};
use uuid::Uuid;

use super::{
    events::{TimeEntryChange, TimeEntryTopicEvent},
    models::TimeEntrySource,
};

/// Time logged on a task, an activity on the task document.
struct TimeLoggedOnTask<'a>(&'a TimeEntryChange);

impl DomainActivity for TimeLoggedOnTask<'_> {
    const ENTITY_TYPE: EntityType = EntityType::Document;

    fn entity_id(&self) -> &str {
        &self.0.task_id
    }

    fn into_action(self) -> Action {
        Action::TimeLogged(TimeLog {
            minutes: u32::from(self.0.minutes),
            entry_date: self.0.entry_date,
            source: match self.0.source {
                TimeEntrySource::Manual => TimeLogSource::Manual,
                TimeEntrySource::Timer => TimeLogSource::Timer,
            },
        })
    }
}

impl ActivitySource for TimeEntryTopicEvent {
    /// Exhaustive on purpose: a new event variant fails compilation here until
    /// someone classifies it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        match self {
            Self::Logged(change) => Ingest::Insert(vec![Activity::from_domain(
                event_id,
                0,
                Actor::new_from_user(change.user_id.clone()),
                None,
                TimeLoggedOnTask(change),
                event_time(event_id),
            )]),
            Self::Updated(_) | Self::Deleted(_) => Ingest::Ignore,
        }
    }
}
