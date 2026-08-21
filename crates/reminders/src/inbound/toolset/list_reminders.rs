//! ListReminders tool for reading the current user's reminders.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::Utc;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{ReminderEntityType, RemindersToolContext, ToolReminder, build_entity, reminder_error};
use crate::domain::models::{SoupOrder, SoupReminderQuery, entity_token};
use crate::domain::ports::RemindersService;

/// How many reminders come back when the caller does not say.
const DEFAULT_LIMIT: u32 = 20;

/// The most any one call will return, however large a `limit` is asked for.
const MAX_LIMIT: u32 = 100;

/// Read the current user's reminders.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListReminders",
    description = "\
Read the current user's reminders, soonest first. **Filtered by default: only reminders the \
user has not marked done**, which is what \"what are my reminders\" means. Pass \
`completed: true` for the ones they have dealt with. To re-read a reminder you already have \
the id for, pass it in `reminderIds`.\n\
\n\
Filters:\n\
- `overdue: true` / `false` — already fired and waiting on the user, or still upcoming\n\
- `completed: true` / `false` — dealt with, or still outstanding\n\
- `entityType` + `entityId` — reminders about one specific thing. `entityType` takes the same \
values CreateReminder accepts: document, ai_chat, project, email, channel, call, \
calendar_event\n\
\n\
The two flags are independent and compose: firing does not complete a reminder, so overdue \
and not completed is the needs-attention case, and a completed reminder never fires whether \
or not its time has passed.\n\
\n\
Each reminder comes back with its `id` (pass to UpdateReminder or DeleteReminder), \
`description`, `nextRunAt`, `overdue`, and what it is attached to. `nextRunAt` is UTC, so \
convert before quoting it: for America/New_York (UTC-4 in August), `\"2026-08-13T19:00:00Z\"` \
is \"3:00 PM tomorrow\".\n\
\n\
A `recurrence` field means the reminder repeats — rare, and currently broken: nothing in the \
app creates one and the dispatcher never fires them, so it sits at its `nextRunAt` without \
arriving. Say that rather than implying it is scheduled."
)]
pub struct ListReminders {
    /// Restrict to these reminder ids.
    #[schemars(
        description = "Return only these reminders, by id. Use this to re-read a reminder you \
                       already know the id of. Omit to list all of them."
    )]
    #[serde(default)]
    pub reminder_ids: Option<Vec<Uuid>>,

    /// Restrict to reminders attached to an entity of this type. Requires
    /// `entity_id`.
    #[schemars(
        description = "Return only reminders attached to a thing of this type. Requires \
                       entityId."
    )]
    #[serde(default)]
    pub entity_type: Option<ReminderEntityType>,

    /// Restrict to reminders attached to this entity. Requires `entity_type`.
    #[schemars(
        description = "Return only reminders attached to the thing with this id. Requires \
                       entityType."
    )]
    #[serde(default)]
    pub entity_id: Option<Uuid>,

    /// Filter on whether the owner marked the reminder done. Defaults to
    /// outstanding reminders only.
    #[schemars(
        description = "Filter on whether the user has marked the reminder done. Defaults to \
                       false — only reminders still outstanding. Set true for ones already \
                       dealt with."
    )]
    #[serde(default)]
    pub completed: Option<bool>,

    /// Filter on whether the reminder has come due. `None` returns both.
    #[schemars(
        description = "Filter on whether the reminder has already fired. True returns only \
                       reminders past their time, false only ones still upcoming. Omit for \
                       both."
    )]
    #[serde(default)]
    pub overdue: Option<bool>,

    /// Page size, clamped into range.
    #[schemars(
        description = "Maximum number of reminders to return. Defaults to 20, capped at 100."
    )]
    #[serde(default)]
    pub limit: Option<u32>,
}

impl ToolAnnotated for ListReminders {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List reminders");
}

/// Response from the ListReminders tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRemindersResponse {
    /// The matching reminders, soonest firing first.
    pub reminders: Vec<ToolReminder>,
    /// A human-readable summary of what came back.
    pub summary: String,
}

#[async_trait]
impl<S, E> AsyncTool<RemindersToolContext<S, E>> for ListReminders
where
    S: RemindersService,
    E: EntityAccessService,
{
    type Output = ListRemindersResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        completed = ?self.completed,
        overdue = ?self.overdue,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<RemindersToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List reminders");

        // No access check on the entity filter: this only narrows the caller's
        // own reminders, so an id they cannot see simply matches nothing.
        let entity = build_entity(self.entity_type, self.entity_id)?;
        let entities: Vec<String> = entity.iter().map(entity_token).collect();
        let ids = self.reminder_ids.clone().unwrap_or_default();
        let limit = self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

        let reminders = service_context
            .service
            .list_reminders_for_soup(
                &request_context.user_id,
                SoupReminderQuery {
                    ids: &ids,
                    entities: &entities,
                    // Outstanding reminders are what the question almost always
                    // means, so default to those rather than to everything.
                    completed: Some(self.completed.unwrap_or(false)),
                    fired: self.overdue,
                    // Soonest first, and with no cursor this picks the rows
                    // rather than merely arranging them: the other direction
                    // would return the furthest-future reminders and never an
                    // overdue one.
                    order: SoupOrder::SoonestFirst,
                    limit: i64::from(limit),
                },
            )
            .await
            .map_err(reminder_error)?;

        let now = Utc::now();
        let reminders: Vec<ToolReminder> = reminders
            .into_iter()
            .map(|r| ToolReminder::new(r.reminder, now))
            .collect();

        let summary = build_summary(&reminders, limit);
        Ok(ListRemindersResponse { reminders, summary })
    }
}

/// Say what came back, and say when it was cut short.
///
/// A full page is indistinguishable from a complete list otherwise, and a model
/// that cannot tell will happily report "you have 20 reminders" when there are
/// eighty.
pub(super) fn build_summary(reminders: &[ToolReminder], limit: u32) -> String {
    if reminders.is_empty() {
        return "No reminders match.".to_string();
    }

    let count = reminders.len();
    let overdue = reminders.iter().filter(|r| r.overdue).count();
    let plural = if count == 1 { "" } else { "s" };

    let mut summary = if overdue > 0 {
        format!("Found {count} reminder{plural}, {overdue} of them overdue.")
    } else {
        format!("Found {count} reminder{plural}.")
    };

    if count as u32 >= limit {
        summary.push_str(" This is the maximum for one call; there may be more.");
    }

    summary
}
