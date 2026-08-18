//! CreateReminder tool for scheduling a nudge for the current user.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use super::{
    ReminderEntityType, RemindersToolContext, ToolReminder, build_entity, reminder_error,
    utc_conversion_note,
};
use crate::domain::models::{CreateReminder as CreateReminderRequest, ReminderSchedule};
use crate::domain::ports::RemindersService;

/// Schedule a reminder for the current user.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateReminder",
    description = concat!(
        "\
Schedule a reminder for the current user. At `remindAt` it is delivered to their Macro inbox \
as a notification and stays there until they mark it done.\n\
\n\
A reminder is either attached to one Macro item — so clicking it opens that item — or \
standalone. Attached is the common case (\"remind me to reply to this email tomorrow\"); \
standalone is for everything else (\"remind me to book a flight\").\n\
\n\
Reminders are private: one is only ever delivered to its owner, and there is no way to set \
one for somebody else. Only one-off reminders can be created — if the user asks for a \
repeating one, say so rather than creating a single reminder and implying it repeats.\n\
\n",
        utc_conversion_note!(),
        "\n\
\n\
## Attaching to an item\n\
\n\
Pass `entityType` and `entityId` together, using ids from ListEntities, GetThread, or search. \
The user must already have access to what you attach. `entityType` accepts exactly these \
values, and a type not on the list cannot be attached even if ListEntities returns it:\n\
\n\
- `document` — a Macro document\n\
- `ai_chat` — an AI chat conversation\n\
- `project` — a project, shown as a folder in the app\n\
- `email` — an email thread\n\
- `channel` — a chat channel\n\
- `call` — a call record\n\
- `calendar_event` — a calendar event\n\
\n\
**A channel thread needs its parent channel's id.** `channel` is on the list; \
`channel_thread` is not. For a thread row, pass `entityType: \"channel\"` with the row's \
`channelId` — never the thread's own `id`, which will not resolve. Put what the thread is \
about in the description, since that is what tells two reminders on the same channel apart.\n\
\n\
For any other unattachable type, create a standalone reminder naming the thing in the \
description rather than guessing at a type."
    )
)]
pub struct CreateReminder {
    /// What to remind the user about.
    #[schemars(
        description = "What to remind the user about, written as the reminder text they will \
                       read — e.g. \"Reply to Dana about the Q3 budget\". Max 2000 characters."
    )]
    pub description: String,

    /// When the reminder fires.
    #[schemars(description = "When to fire, as an RFC 3339 timestamp in UTC (e.g. \
                       \"2026-08-08T14:00:00Z\"). Must be in the future. Seconds are dropped, \
                       so a reminder fires on the minute. Convert from the user's local \
                       timezone before sending — see \"Times are UTC\" in the tool \
                       description.")]
    pub remind_at: DateTime<Utc>,

    /// Type of the entity to attach the reminder to. Requires `entityId`.
    #[schemars(
        description = "Type of the thing the reminder is about — one of document, ai_chat, \
                       project, email, channel, call, calendar_event. Requires entityId; omit \
                       both for a standalone reminder."
    )]
    #[serde(default)]
    pub entity_type: Option<ReminderEntityType>,

    /// Id of the entity to attach the reminder to. Requires `entityType`.
    #[schemars(
        description = "Id of the thing the reminder is about, as a UUID. Must be the id of an \
                       entity of entityType — for a channel_thread row that means its \
                       channelId, not its own id. Requires entityType."
    )]
    #[serde(default)]
    pub entity_id: Option<Uuid>,
}

impl ToolAnnotated for CreateReminder {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create reminder");
}

#[async_trait]
impl<S, E> AsyncTool<RemindersToolContext<S, E>> for CreateReminder
where
    S: RemindersService,
    E: EntityAccessService,
{
    type Output = ToolReminder;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        remind_at = %self.remind_at,
        entity_type = ?self.entity_type,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<RemindersToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create reminder");

        let user_id = &request_context.user_id;
        let entity = build_entity(self.entity_type, self.entity_id)?;

        // A standalone reminder points at nothing, so there is no access to
        // prove. When there is an entity, the receipt is the only way its id
        // reaches the service — the request itself cannot name one.
        let entity_receipt = match &entity {
            Some(entity) => Some(service_context.entity_receipt(user_id, entity).await?),
            None => None,
        };

        let reminder = service_context
            .service
            .create_reminder(
                user_id,
                CreateReminderRequest {
                    description: self.description.clone(),
                    schedule: ReminderSchedule::Once {
                        remind_at: self.remind_at,
                    },
                },
                entity_receipt,
            )
            .await
            .map_err(reminder_error)?;

        Ok(ToolReminder::new(reminder, Utc::now()))
    }
}
