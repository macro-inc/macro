use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use reminders::domain::models::{Reminder, ReminderForSoup, ReminderSchedule};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How often a reminder fires, flattened for the wire.
///
/// The domain's [`ReminderSchedule`] is an internally-tagged enum carrying a
/// validated cron type; Soup only needs enough to render "once" vs "every
/// weekday at 9am", so the cron is exposed as a plain string.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SoupReminderSchedule {
    /// Fires once, at a fixed instant.
    #[serde(rename_all = "camelCase")]
    Once {
        /// The instant to fire at.
        remind_at: DateTime<Utc>,
    },
    /// Fires repeatedly, on a cron schedule evaluated in `timezone`.
    #[serde(rename_all = "camelCase")]
    Recurring {
        /// Cron expression, normalized to the 6-field form.
        cron: String,
        /// The timezone the cron expression is evaluated in.
        timezone: String,
    },
}

impl From<ReminderSchedule> for SoupReminderSchedule {
    fn from(schedule: ReminderSchedule) -> Self {
        match schedule {
            ReminderSchedule::Once { remind_at } => Self::Once { remind_at },
            ReminderSchedule::Recurring { cron, timezone } => Self::Recurring {
                cron: cron.as_str().to_string(),
                timezone: timezone.to_string(),
            },
        }
    }
}

/// The entity a reminder is about, resolved server-side.
///
/// A reminder has no block of its own — it opens, and is iconed as, whatever it
/// references. Which block that is depends on the referenced document's file
/// type, and the client's icon path is synchronous, so this is resolved here
/// rather than costing a fetch per row.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupReminderReference {
    /// The referenced entity's id.
    pub id: String,
    /// The referenced entity's type.
    #[cfg_attr(feature = "schema", schema(inline))]
    pub entity_type: EntityType,
    /// File type, when the reference is a document — `md`, `pdf`, and so on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// Sub type, when the reference is a task or snippet document.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<String>,
}

/// A reminder as displayed in Soup.
///
/// Reminders are user-owned rather than shared, so unlike most Soup items they
/// carry no access metadata — the repository only ever returns the caller's own.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupReminder<T = ()> {
    /// The reminder id.
    pub id: Uuid,
    /// What to remind the user about. Doubles as the display name.
    pub description: String,
    /// The entity this reminder is about, when attached to one, with enough
    /// detail for the client to render and open it without a second fetch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referenced_entity: Option<SoupReminderReference>,
    /// When and how often the reminder fires.
    pub schedule: SoupReminderSchedule,
    /// The next firing. This is what Soup sorts reminders on.
    pub next_run_at: DateTime<Utc>,
    /// When false, the dispatcher skips this reminder.
    pub enabled: bool,
    /// Set once a one-shot reminder has fired.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    /// When the reminder was created.
    pub created_at: DateTime<Utc>,
    /// When the reminder was last modified.
    pub updated_at: DateTime<Utc>,
    /// Extra fields passed from above
    #[serde(flatten)]
    pub extra: T,
}

impl<T> SoupReminder<T> {
    /// The entity this reminder is about, when it is attached to one.
    pub fn entity(&self) -> Option<Entity<'_>> {
        self.referenced_entity
            .as_ref()
            .map(|r| r.entity_type.with_entity_str(&r.id))
    }
}

impl From<ReminderForSoup> for SoupReminder<()> {
    fn from(row: ReminderForSoup) -> Self {
        let ReminderForSoup {
            reminder,
            reference,
        } = row;
        let Reminder {
            id,
            description,
            entity_type,
            entity_id,
            schedule,
            next_run_at,
            enabled,
            completed_at,
            created_at,
            updated_at,
        } = reminder;
        let referenced_entity = match (entity_type, entity_id) {
            (Some(entity_type), Some(id)) => Some(SoupReminderReference {
                id,
                entity_type,
                file_type: reference.as_ref().and_then(|r| r.file_type.clone()),
                sub_type: reference.and_then(|r| r.sub_type),
            }),
            _ => None,
        };
        SoupReminder {
            id,
            description,
            referenced_entity,
            schedule: schedule.into(),
            next_run_at,
            enabled,
            completed_at,
            created_at,
            updated_at,
            extra: (),
        }
    }
}
