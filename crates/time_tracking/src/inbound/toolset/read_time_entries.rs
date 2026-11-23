//! ReadTimeEntries: a task's Time logged and its most recent entries.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{TimeTrackingToolContext, ToolTimeEntry, length, tool_error};
use crate::domain::{models::TimeEntryPageRequest, service::TimeTrackingService};

/// How many of a task's newest entries the tool returns.
pub(super) const RECENT_ENTRIES: u8 = 50;

/// Read a task's logged time.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "ReadTimeEntries",
    description = "Read the time logged on a task: its Time logged total and its 50 most recent entries, newest day first, each with who logged it, the day, the length in minutes and the note. Everyone who can view the task sees everyone's entries. Use it to answer how much time was spent on a task and by whom; when truncated is true, sums per person cover only the entries returned, so say so. LogTime adds time."
)]
pub struct ReadTimeEntries {
    /// The task's document id.
    #[schemars(description = "The task's document id (tasks are documents).")]
    pub task_id: String,
}

/// A task's logged time.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadTimeEntriesResponse {
    /// The task's Time logged, in minutes: the sum of all its entries.
    pub total_minutes: u32,
    /// The most recent entries, newest day first.
    pub entries: Vec<ToolTimeEntry>,
    /// Whether the task has older entries than these.
    pub truncated: bool,
    /// One line to report to the user.
    pub summary: String,
}

impl ToolAnnotated for ReadTimeEntries {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read time entries");
}

#[async_trait]
impl<S, A> AsyncTool<TimeTrackingToolContext<S, A>> for ReadTimeEntries
where
    S: TimeTrackingService,
    A: EntityAccessService,
{
    type Output = ReadTimeEntriesResponse;

    async fn call(
        &self,
        service_context: ServiceContext<TimeTrackingToolContext<S, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = service_context
            .task_receipt::<ViewAccessLevel>(
                &request_context,
                &self.task_id,
                "The task was not found or you cannot view it.",
            )
            .await?;
        let page = service_context
            .service
            .list_entries(
                &receipt,
                TimeEntryPageRequest {
                    limit: Some(RECENT_ENTRIES),
                    after: None,
                },
            )
            .await
            .map_err(tool_error)?;
        let truncated = page.next_cursor.is_some();
        let summary = match (page.entries.len(), truncated) {
            (0, _) => "No time has been logged on this task.".to_string(),
            (shown, false) => format!(
                "{} logged in {shown} {}.",
                length(page.total_minutes),
                if shown == 1 { "entry" } else { "entries" },
            ),
            (shown, true) => format!(
                "{} logged in all; showing the {shown} most recent entries, so totals per person \
                 are partial.",
                length(page.total_minutes),
            ),
        };
        Ok(ReadTimeEntriesResponse {
            total_minutes: page.total_minutes,
            entries: page.entries.into_iter().map(ToolTimeEntry::from).collect(),
            truncated,
            summary,
        })
    }
}
