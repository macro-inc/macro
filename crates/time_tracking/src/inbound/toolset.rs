//! AI tools for logging and reading time on a task, for hosts that call tools
//! directly (chat, channel bots, MCP). Code-mode sessions use the SDK instead.

mod log_time;
mod read_time_entries;

#[cfg(test)]
mod test;

pub use log_time::{LogTime, LogTimeResponse};
pub use read_time_entries::{ReadTimeEntries, ReadTimeEntriesResponse};

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError, ToolResult};
use chrono::NaiveDate;
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{
    models::{TIME_TRACKING_OFF, TimeEntry, TimeEntrySource, TimeTrackingError},
    service::TimeTrackingService,
};

/// Services the time tools share.
pub struct TimeTrackingToolContext<S, A> {
    /// Entry rules, permissions and the task's Time logged.
    pub service: Arc<S>,
    /// Mints the receipts that prove the caller's access to the task.
    pub access: Arc<A>,
}

impl<S, A> Clone for TimeTrackingToolContext<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
        }
    }
}

impl<S, A: EntityAccessService> TimeTrackingToolContext<S, A> {
    /// The requesting user's receipt for the task. Time is always the user's
    /// own, so the receipt is never a bot's.
    async fn task_receipt<T: RequiredPermission>(
        &self,
        request: &RequestContext,
        task_id: &str,
        refusal: &str,
    ) -> ToolResult<EntityAccessReceipt<T>> {
        self.access
            .generate_entity_access_receipt::<T>(
                &request.user_id,
                None,
                task_id,
                EntityType::Document,
            )
            .await
            .map_err(|error| ToolCallError {
                description: refusal.to_string(),
                internal_error: error.into(),
            })
    }
}

/// The time tools.
pub fn time_tracking_toolset<S, A>() -> AsyncToolCollection<TimeTrackingToolContext<S, A>>
where
    S: TimeTrackingService,
    A: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<LogTime, TimeTrackingToolContext<S, A>>()
        .add_tool::<ReadTimeEntries, TimeTrackingToolContext<S, A>>()
}

/// One time entry in a tool response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTimeEntry {
    /// The entry's id.
    pub id: Uuid,
    /// The user who logged it.
    pub user_id: String,
    /// The day the work was done, in that person's own calendar.
    pub date: NaiveDate,
    /// Length in whole minutes.
    pub minutes: u16,
    /// What the time was spent on, if noted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Whether it was typed or saved by a timer.
    pub source: TimeEntrySource,
}

impl From<TimeEntry> for ToolTimeEntry {
    fn from(entry: TimeEntry) -> Self {
        Self {
            id: entry.id,
            user_id: entry.user_id.as_ref().to_string(),
            date: entry.date,
            minutes: entry.minutes,
            note: entry.note,
            source: entry.source,
        }
    }
}

/// `4h 35m`, `45m` or `2h`, for summaries the model repeats to people.
fn length(minutes: u32) -> String {
    match (minutes / 60, minutes % 60) {
        (0, minutes) => format!("{minutes}m"),
        (hours, 0) => format!("{hours}h"),
        (hours, minutes) => format!("{hours}h {minutes}m"),
    }
}

/// What a refused or failed call tells the model, so it can tell the user.
fn tool_error(error: TimeTrackingError) -> ToolCallError {
    let description = match &error {
        TimeTrackingError::NotFound(TIME_TRACKING_OFF) => {
            "Time tracking is not turned on for this person yet, so nothing was logged. The task \
             exists: tell them time tracking isn't available to them yet, and don't retry or look \
             for the task."
                .to_string()
        }
        TimeTrackingError::NotFound(_) => {
            "The task was not found, is not a task, or is in the trash.".to_string()
        }
        TimeTrackingError::NotAuthor => {
            "Only the person who logged this time can change or delete it.".to_string()
        }
        TimeTrackingError::InvalidInput(message) => message.clone(),
        TimeTrackingError::Busy => "The task is busy with other changes; try again.".to_string(),
        TimeTrackingError::TimerOverLimit(_)
        | TimeTrackingError::Conflict(_)
        | TimeTrackingError::Internal(_) => "Time tracking failed; try again later.".to_string(),
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}
