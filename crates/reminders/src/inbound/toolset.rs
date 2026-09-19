//! Toolset inbound adapter for reminders.
//!
//! A driving adapter like [`axum_router`](super::axum_router), but for the
//! agent loop. It goes through the same [`RemindersService`] port and the same
//! access receipts, so a tool can reach exactly what the HTTP API can and
//! nothing more.
//!
//! Only one-shot reminders are creatable here. Recurring schedules are modelled
//! and stored but never dispatched (see
//! [`DeliveryOutcome::SkippedRecurring`](crate::domain::models::DeliveryOutcome::SkippedRecurring)),
//! so a tool that accepted a cron would let the model promise a reminder that
//! silently never fires. Recurring reminders that already exist are still
//! listed, and say so.

mod create_reminder;
mod delete_reminder;
mod list_reminders;
mod update_reminder;

#[cfg(test)]
mod test;

/// The timezone rule, shared verbatim by every tool that takes a timestamp.
///
/// A macro rather than a `const` because `#[schemars(description = ...)]` is
/// built at compile time from literals, and `concat!` only concatenates
/// literals. One definition is the point: the same rule stated three ways is
/// how the three drift apart.
///
/// It is repeated into each tool's description rather than shared at runtime
/// because a tool schema has nowhere else to put it — descriptions are
/// independent fields, and tool search can load one of these tools without the
/// others, so a cross-reference could dangle.
macro_rules! utc_conversion_note {
    () => {
        "## Times are UTC — convert both ways\n\
         \n\
         Timestamps are absolute instants, in and out, while the user asks in their own \
         timezone. Getting this wrong silently sets the reminder to the wrong hour.\n\
         \n\
         - **In:** resolve their wording against their local time, then convert. For \
         America/New_York (UTC-4 in August), \"3pm tomorrow\" on 2026-08-12 is \
         `\"2026-08-13T19:00:00Z\"`, not `\"2026-08-13T15:00:00Z\"`.\n\
         - **Out:** report the response's UTC value back in their timezone — \
         `\"2026-08-13T19:00:00Z\"` is \"3:00 PM tomorrow\".\n\
         \n\
         Ask for their timezone rather than assuming UTC."
    };
}

pub(crate) use utc_conversion_note;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{AccessError, AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{Reminder, ReminderError, ReminderSchedule};
use crate::domain::ports::RemindersService;

pub use create_reminder::CreateReminder;
pub use delete_reminder::{DeleteReminder, DeleteReminderResponse};
pub use list_reminders::{ListReminders, ListRemindersResponse};
pub use update_reminder::UpdateReminder;

/// Service context for reminder AI tools.
pub struct RemindersToolContext<S: RemindersService, E: EntityAccessService> {
    /// The reminders service instance.
    pub service: Arc<S>,
    /// Mints the access receipts every reminder operation is gated on.
    pub entity_access_service: Arc<E>,
}

impl<S: RemindersService, E: EntityAccessService> Clone for RemindersToolContext<S, E> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<S: RemindersService, E: EntityAccessService> RemindersToolContext<S, E> {
    /// Create a new reminders tool context.
    pub fn new(service: S, entity_access_service: Arc<E>) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service,
        }
    }

    /// Prove the caller owns `reminder_id`.
    ///
    /// A reminder is never shared, so ownership is the whole access model and
    /// `Owner` is the only level this can come back with. Somebody else's
    /// reminder and one that does not exist give the same answer, which is what
    /// keeps an id from leaking.
    async fn owner_receipt(
        &self,
        user_id: &MacroUserIdStr<'_>,
        reminder_id: Uuid,
    ) -> Result<EntityAccessReceipt<OwnerAccessLevel>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<OwnerAccessLevel>(
                user_id,
                None,
                &reminder_id.to_string(),
                EntityType::Reminder,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!(
                    "No reminder with id {reminder_id} belongs to this user. \
                     Call ListReminders to see the user's reminders and their ids."
                ),
                internal_error: e.into(),
            })
    }

    /// Prove the caller may attach a reminder to `entity`.
    ///
    /// [`AnyEntityPermission`], not view access: entity permissions come in two
    /// shapes and a channel resolves to a role rather than an access level, so
    /// requiring view would reject every channel including ones the caller
    /// owns. Holding any permission at all is the bar, and no permission is an
    /// error rather than a value.
    async fn entity_receipt(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<EntityAccessReceipt<AnyEntityPermission>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<AnyEntityPermission>(
                user_id,
                None,
                entity.entity_id.as_ref(),
                entity.entity_type,
            )
            .await
            .map_err(|e| {
                // Say what actually went wrong. Collapsing these into one
                // message told a model with a wrong id that it lacked access,
                // which sends it looking in the wrong place.
                let description = match &e {
                    AccessError::NotFound(_) => format!(
                        "No {} exists with id {}.",
                        entity.entity_type.as_ref(),
                        entity.entity_id
                    ),
                    AccessError::BadRequest(msg) => msg.to_string(),
                    _ => format!(
                        "The user does not have access to {} {}.",
                        entity.entity_type.as_ref(),
                        entity.entity_id
                    ),
                };
                ToolCallError {
                    description,
                    internal_error: e.into(),
                }
            })
    }
}

/// Create the reminders toolset.
pub fn reminders_toolset<S, E>() -> AsyncToolCollection<RemindersToolContext<S, E>>
where
    S: RemindersService,
    E: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListReminders, RemindersToolContext<S, E>>()
        .add_tool::<CreateReminder, RemindersToolContext<S, E>>()
        .add_tool::<UpdateReminder, RemindersToolContext<S, E>>()
        .add_tool::<DeleteReminder, RemindersToolContext<S, E>>()
}

/// Turn a domain error into something the model can act on.
///
/// `BadRequest` is passed through verbatim — it is the service explaining what
/// was wrong with the request ("remindAt must be in the future"), which is
/// exactly what lets a model correct itself and retry.
fn reminder_error(error: ReminderError) -> ToolCallError {
    let description = match &error {
        ReminderError::NotFound => {
            "That reminder no longer exists. Call ListReminders for the current list.".to_string()
        }
        ReminderError::EntityNotFound => {
            "The entity the reminder would be attached to does not exist.".to_string()
        }
        ReminderError::BadRequest(message) => message.clone(),
        ReminderError::EntityAccessDenied => {
            "The user does not have access to that entity.".to_string()
        }
        ReminderError::Internal(_) => "The reminders service failed.".to_string(),
    };

    ToolCallError {
        description,
        internal_error: anyhow::Error::msg(format!("{error:?}")),
    }
}

/// Entity types a reminder can be attached to.
///
/// Deliberately narrower than [`EntityType`], which covers plenty of things a
/// reminder has no business pointing at. The names match the ones `ListEntities`
/// uses so the model sees one vocabulary across tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReminderEntityType {
    /// Macro document.
    Document,
    /// AI chat conversation.
    AiChat,
    /// Macro project (shown as a folder in the app UI).
    Project,
    /// Email thread.
    Email,
    /// Chat channel.
    Channel,
    /// Call record.
    Call,
    /// Calendar event.
    CalendarEvent,
}

impl From<ReminderEntityType> for EntityType {
    fn from(value: ReminderEntityType) -> Self {
        match value {
            ReminderEntityType::Document => EntityType::Document,
            ReminderEntityType::AiChat => EntityType::Chat,
            ReminderEntityType::Project => EntityType::Project,
            ReminderEntityType::Email => EntityType::EmailThread,
            ReminderEntityType::Channel => EntityType::Channel,
            ReminderEntityType::Call => EntityType::Call,
            ReminderEntityType::CalendarEvent => EntityType::CalendarEvent,
        }
    }
}

impl ReminderEntityType {
    /// The tool-facing name for a stored entity type, or `None` for one this
    /// toolset does not name.
    ///
    /// Stored reminders can reference types the create tool refuses (they are
    /// reachable from the UI), so a read has to survive meeting one rather than
    /// fail the whole list.
    fn from_entity_type(entity_type: EntityType) -> Option<Self> {
        match entity_type {
            EntityType::Document => Some(Self::Document),
            EntityType::Chat => Some(Self::AiChat),
            EntityType::Project => Some(Self::Project),
            EntityType::EmailThread => Some(Self::Email),
            EntityType::Channel => Some(Self::Channel),
            EntityType::Call => Some(Self::Call),
            EntityType::CalendarEvent => Some(Self::CalendarEvent),
            _ => None,
        }
    }
}

/// Pair an optional entity type and id, rejecting a half-supplied association.
///
/// Both or neither. A model that sends only one of them has almost certainly
/// lost the other, and silently creating a standalone reminder would hide that.
fn build_entity(
    entity_type: Option<ReminderEntityType>,
    entity_id: Option<Uuid>,
) -> Result<Option<Entity<'static>>, ToolCallError> {
    match (entity_type, entity_id) {
        (Some(entity_type), Some(entity_id)) => Ok(Some(
            EntityType::from(entity_type).with_entity_string(entity_id.to_string()),
        )),
        (None, None) => Ok(None),
        _ => Err(ToolCallError {
            description: "entityType and entityId must be provided together, or both omitted \
                          for a reminder that is not about anything in particular."
                .to_string(),
            internal_error: anyhow::anyhow!("half-supplied reminder entity association"),
        }),
    }
}

/// A reminder as the model sees it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolReminder {
    /// The reminder's id. Pass this to UpdateReminder or DeleteReminder.
    pub id: Uuid,
    /// What the user wanted to be reminded about.
    pub description: String,
    /// When the reminder fires next, RFC 3339 in UTC. The user thinks in their
    /// own timezone — convert before quoting this back to them.
    pub next_run_at: DateTime<Utc>,
    /// Whether `nextRunAt` has already passed, evaluated against the server
    /// clock. An overdue reminder is one the user has been notified about and
    /// has not dealt with yet.
    pub overdue: bool,
    /// For a repeating reminder, its cron expression and timezone. Absent on a
    /// one-shot, which is everything this toolset can create.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<String>,
    /// The type of thing the reminder is about, when it is about something and
    /// that type is one these tools name. The app can attach a reminder to
    /// kinds of thing this list does not cover, so `entityId` may be present
    /// with no `entityType` beside it — the reminder is about something, but
    /// not something these tools can name or filter on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<ReminderEntityType>,
    /// The id of the thing the reminder is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    /// Whether the user has marked the reminder as dealt with.
    pub completed: bool,
    /// Whether the reminder will fire at all. A disabled reminder keeps its
    /// schedule but is skipped by the dispatcher.
    pub enabled: bool,
}

impl ToolReminder {
    /// Render a stored reminder, resolving overdue-ness against `now`.
    fn new(reminder: Reminder, now: DateTime<Utc>) -> Self {
        let recurrence = match &reminder.schedule {
            ReminderSchedule::Once { .. } => None,
            ReminderSchedule::Recurring { cron, timezone } => {
                Some(format!("{} ({timezone})", cron.as_str()))
            }
        };

        Self {
            id: reminder.id,
            description: reminder.description,
            next_run_at: reminder.next_run_at,
            overdue: reminder.next_run_at <= now,
            recurrence,
            entity_type: reminder
                .entity_type
                .and_then(ReminderEntityType::from_entity_type),
            entity_id: reminder.entity_id,
            completed: reminder.completed_at.is_some(),
            enabled: reminder.enabled,
        }
    }
}
