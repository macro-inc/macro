//! LogTime: log time the user spent on a task.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::NaiveDate;
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{TimeTrackingToolContext, ToolTimeEntry, length, tool_error};
use crate::domain::{models::NewTimeEntry, service::TimeTrackingService};

/// Log time on a task as the requesting user.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "LogTime",
    description = "Log time the user spent on a task, as the user: there is no logging time for someone else. Needs edit access to the task. One entry is at most 24 hours (1440 minutes); split longer work across days. The task's Time logged property is the sum of its entries and changes only through LogTime, never SetEntityProperty. Returns the entry and the task's new Time logged."
)]
pub struct LogTime {
    /// The task's document id.
    #[schemars(description = "The task's document id (tasks are documents).")]
    pub task_id: String,
    /// Length in whole minutes.
    #[schemars(
        description = "Length in whole minutes, 1 to 1440. Convert what the user says: 1h 30m is 90.",
        range(min = 1, max = 1440)
    )]
    pub minutes: u16,
    /// The day the work was done.
    #[schemars(
        description = "The day the work was done, YYYY-MM-DD, in the user's own calendar. For today, use the user's current date where they are (the current time block when there is one), not UTC's."
    )]
    pub date: NaiveDate,
    /// What the time was spent on.
    #[schemars(
        description = "What the time was spent on, in a few words, only when the user says; at most 2000 characters."
    )]
    pub note: Option<String>,
}

/// What LogTime saved.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogTimeResponse {
    /// The entry as stored.
    pub entry: ToolTimeEntry,
    /// The task's Time logged after this entry, in minutes.
    pub total_minutes: u32,
    /// One line to report to the user.
    pub summary: String,
}

impl ToolAnnotated for LogTime {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Log time");
}

#[async_trait]
impl<S, A> AsyncTool<TimeTrackingToolContext<S, A>> for LogTime
where
    S: TimeTrackingService,
    A: EntityAccessService,
{
    type Output = LogTimeResponse;

    async fn call(
        &self,
        service_context: ServiceContext<TimeTrackingToolContext<S, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = service_context
            .task_receipt::<EditAccessLevel>(
                &request_context,
                &self.task_id,
                "The task was not found, or you need edit access to it to log time on it.",
            )
            .await?;
        let logged = service_context
            .service
            .log_entry(
                &receipt,
                NewTimeEntry {
                    id: None,
                    date: self.date,
                    minutes: self.minutes,
                    note: self.note.clone(),
                    started_at: None,
                    ended_at: None,
                },
            )
            .await
            .map_err(tool_error)?;
        let summary = format!(
            "Logged {} on {}; the task's Time logged is now {}.",
            length(u32::from(logged.entry.minutes)),
            logged.entry.date,
            length(logged.total_minutes),
        );
        Ok(LogTimeResponse {
            entry: logged.entry.into(),
            total_minutes: logged.total_minutes,
            summary,
        })
    }
}
