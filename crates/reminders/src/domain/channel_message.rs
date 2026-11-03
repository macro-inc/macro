//! One-shot reminders that open a channel message.

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewOnly};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    models::{MAX_DESCRIPTION_LEN, ReminderError},
    ports::{Clock, SystemClock},
};

/// A channel message the caller can be reminded about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelMessageFacts {
    /// Thread root when the message is a reply.
    pub thread_id: Option<Uuid>,
}

/// An active reminder on one channel message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageReminder {
    /// Reminder row.
    #[schema(value_type = String, format = Uuid)]
    pub reminder_id: Uuid,
    /// Channel the message belongs to.
    #[schema(value_type = String, format = Uuid)]
    pub channel_id: Uuid,
    /// Message to open when the reminder fires.
    #[schema(value_type = String, format = Uuid)]
    pub message_id: Uuid,
    /// Thread root when the message is a reply.
    #[schema(value_type = Option<String>, format = Uuid)]
    pub thread_id: Option<Uuid>,
    /// Snippet shown in the notification.
    pub description: String,
    /// When to notify the owner.
    #[schema(value_type = String, format = DateTime)]
    pub remind_at: DateTime<Utc>,
}

/// Read response: the caller's active reminder, or none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageReminderResponse {
    /// Active reminder, when one is scheduled.
    pub reminder: Option<ChannelMessageReminder>,
}

/// Request to schedule or replace a message reminder.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SetChannelMessageReminder {
    /// When to notify the owner. Must be in the future.
    #[schema(value_type = String, format = DateTime)]
    pub remind_at: DateTime<Utc>,
    /// Snippet shown in the notification.
    pub description: String,
}

/// Persistence for channel-message reminders.
pub trait ChannelMessageReminderRepo: Send + Sync + Clone + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The live message in this channel, if the caller addressed one.
    fn message_in_channel(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<ChannelMessageFacts>, Self::Err>> + Send;

    /// The owner's active reminder on this message.
    fn active_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<ChannelMessageReminder>, Self::Err>> + Send;

    /// Reminder id already stored for this owner and message, including one
    /// that has already fired.
    fn existing_reminder_id(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Insert or replace the owner's reminder for this message.
    fn save_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        reminder: &ChannelMessageReminder,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mark the owner's active reminder on this message finished.
    fn remove_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Schedules a private reminder that opens one channel message.
#[derive(Clone)]
pub struct ChannelMessageReminderService<R, C = SystemClock> {
    repo: R,
    clock: C,
}

impl<R> ChannelMessageReminderService<R> {
    /// Schedule reminders using the system clock.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            clock: SystemClock,
        }
    }
}

impl<R, C> ChannelMessageReminderService<R, C> {
    /// Schedule reminders using an explicit clock.
    pub fn with_clock(repo: R, clock: C) -> Self {
        Self { repo, clock }
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> ReminderError {
    ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
}

fn channel_id(access: &EntityAccessReceipt<ViewOnly>) -> Result<Uuid, ReminderError> {
    let entity = access.entity();
    if entity.entity_type != EntityType::Channel {
        return Err(ReminderError::EntityAccessDenied);
    }
    Uuid::parse_str(&entity.entity_id).map_err(|_| ReminderError::EntityAccessDenied)
}

fn owner(access: &EntityAccessReceipt<ViewOnly>) -> Result<MacroUserIdStr<'static>, ReminderError> {
    access
        .get_authenticated_user()
        .cloned()
        .map_err(|_| ReminderError::EntityAccessDenied)
}

fn description(description: &str) -> Result<String, ReminderError> {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        return Err(ReminderError::BadRequest("description is required".into()));
    }
    Ok(trimmed.chars().take(MAX_DESCRIPTION_LEN).collect())
}

impl<R, C> ChannelMessageReminderService<R, C>
where
    R: ChannelMessageReminderRepo,
    C: Clock,
{
    /// The caller's active reminder on this message.
    pub async fn get(
        &self,
        access: &EntityAccessReceipt<ViewOnly>,
        message_id: Uuid,
    ) -> Result<Option<ChannelMessageReminder>, ReminderError> {
        let user = owner(access)?;
        let channel_id = channel_id(access)?;
        Ok(self
            .repo
            .active_reminder(&user, message_id)
            .await
            .map_err(internal)?
            .filter(|reminder| reminder.channel_id == channel_id))
    }

    /// Schedule or replace the caller's reminder for this message.
    pub async fn set(
        &self,
        access: &EntityAccessReceipt<ViewOnly>,
        message_id: Uuid,
        command: SetChannelMessageReminder,
    ) -> Result<ChannelMessageReminder, ReminderError> {
        let user = owner(access)?;
        let channel_id = channel_id(access)?;
        let facts = self
            .repo
            .message_in_channel(channel_id, message_id)
            .await
            .map_err(internal)?
            .ok_or(ReminderError::EntityNotFound)?;
        let remind_at = DateTime::from_timestamp_micros(command.remind_at.timestamp_micros())
            .unwrap_or(command.remind_at);
        if remind_at <= self.clock.now() {
            return Err(ReminderError::BadRequest(
                "remindAt must be in the future".into(),
            ));
        }
        let reminder_id = self
            .repo
            .existing_reminder_id(&user, message_id)
            .await
            .map_err(internal)?
            .unwrap_or_else(Uuid::now_v7);
        let reminder = ChannelMessageReminder {
            reminder_id,
            channel_id,
            message_id,
            thread_id: facts.thread_id,
            description: description(&command.description)?,
            remind_at,
        };
        self.repo
            .save_reminder(&user, &reminder)
            .await
            .map_err(internal)?;
        Ok(reminder)
    }

    /// Remove the caller's active reminder on this message.
    pub async fn remove(
        &self,
        access: &EntityAccessReceipt<ViewOnly>,
        message_id: Uuid,
    ) -> Result<(), ReminderError> {
        let user = owner(access)?;
        let channel_id = channel_id(access)?;
        let current = self
            .repo
            .active_reminder(&user, message_id)
            .await
            .map_err(internal)?;
        if current.is_none_or(|reminder| reminder.channel_id != channel_id) {
            return Err(ReminderError::NotFound);
        }
        let removed = self
            .repo
            .remove_reminder(&user, message_id)
            .await
            .map_err(internal)?;
        if removed {
            Ok(())
        } else {
            Err(ReminderError::NotFound)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use entity_access::domain::models::{Entity, EntityPermission, ParticipantRole};
    use macro_user_id::cowlike::CowLike;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct MemoryRepo {
        messages: Arc<Mutex<Vec<(Uuid, Uuid, Option<Uuid>)>>>,
        reminders: Arc<Mutex<Vec<(String, ChannelMessageReminder)>>>,
    }

    #[derive(Debug, thiserror::Error)]
    #[error("memory")]
    struct MemoryErr;

    impl ChannelMessageReminderRepo for MemoryRepo {
        type Err = MemoryErr;

        async fn message_in_channel(
            &self,
            channel_id: Uuid,
            message_id: Uuid,
        ) -> Result<Option<ChannelMessageFacts>, Self::Err> {
            Ok(self
                .messages
                .lock()
                .unwrap()
                .iter()
                .find(|(channel, message, _)| *channel == channel_id && *message == message_id)
                .map(|(_, _, thread_id)| ChannelMessageFacts {
                    thread_id: *thread_id,
                }))
        }

        async fn active_reminder(
            &self,
            user: &MacroUserIdStr<'_>,
            message_id: Uuid,
        ) -> Result<Option<ChannelMessageReminder>, Self::Err> {
            Ok(self
                .reminders
                .lock()
                .unwrap()
                .iter()
                .find(|(owner, reminder)| {
                    owner == user.as_ref() && reminder.message_id == message_id
                })
                .map(|(_, reminder)| reminder.clone()))
        }

        async fn existing_reminder_id(
            &self,
            user: &MacroUserIdStr<'_>,
            message_id: Uuid,
        ) -> Result<Option<Uuid>, Self::Err> {
            Ok(self
                .active_reminder(user, message_id)
                .await?
                .map(|reminder| reminder.reminder_id))
        }

        async fn save_reminder(
            &self,
            user: &MacroUserIdStr<'_>,
            reminder: &ChannelMessageReminder,
        ) -> Result<(), Self::Err> {
            let mut reminders = self.reminders.lock().unwrap();
            if let Some(existing) = reminders.iter_mut().find(|(owner, stored)| {
                owner == user.as_ref() && stored.message_id == reminder.message_id
            }) {
                existing.1 = reminder.clone();
            } else {
                reminders.push((user.as_ref().to_string(), reminder.clone()));
            }
            Ok(())
        }

        async fn remove_reminder(
            &self,
            user: &MacroUserIdStr<'_>,
            message_id: Uuid,
        ) -> Result<bool, Self::Err> {
            let mut reminders = self.reminders.lock().unwrap();
            let before = reminders.len();
            reminders.retain(|(owner, reminder)| {
                !(owner == user.as_ref() && reminder.message_id == message_id)
            });
            Ok(reminders.len() != before)
        }
    }

    struct FixedClock(DateTime<Utc>);

    impl Clock for FixedClock {
        fn now(&self) -> DateTime<Utc> {
            self.0
        }
    }

    fn access(channel_id: Uuid) -> EntityAccessReceipt<ViewOnly> {
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::parse_from_str("macro|reminders@macro.com")
                .unwrap()
                .into_owned(),
            Entity {
                entity_id: channel_id.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )
        .unwrap()
    }

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_700_000_000, 0).unwrap()
    }

    #[tokio::test]
    async fn set_replaces_the_same_message_and_keeps_its_thread() {
        let channel_id = Uuid::from_u128(1);
        let message_id = Uuid::from_u128(2);
        let thread_id = Uuid::from_u128(3);
        let repo = MemoryRepo::default();
        repo.messages
            .lock()
            .unwrap()
            .push((channel_id, message_id, Some(thread_id)));
        let service = ChannelMessageReminderService::with_clock(repo.clone(), FixedClock(now()));
        let receipt = access(channel_id);

        let created = service
            .set(
                &receipt,
                message_id,
                SetChannelMessageReminder {
                    remind_at: now() + chrono::Duration::hours(1),
                    description: "  ping  ".into(),
                },
            )
            .await
            .unwrap();
        let replaced = service
            .set(
                &receipt,
                message_id,
                SetChannelMessageReminder {
                    remind_at: now() + chrono::Duration::hours(2),
                    description: "later".into(),
                },
            )
            .await
            .unwrap();

        assert_eq!(replaced.reminder_id, created.reminder_id);
        assert_eq!(replaced.thread_id, Some(thread_id));
        assert_eq!(replaced.description, "later");
        assert_eq!(
            service
                .get(&receipt, message_id)
                .await
                .unwrap()
                .unwrap()
                .remind_at,
            replaced.remind_at
        );
    }

    #[tokio::test]
    async fn rejects_a_missing_message_and_a_past_time() {
        let channel_id = Uuid::from_u128(1);
        let repo = MemoryRepo::default();
        let service = ChannelMessageReminderService::with_clock(repo, FixedClock(now()));
        let receipt = access(channel_id);
        let missing = service
            .set(
                &receipt,
                Uuid::from_u128(9),
                SetChannelMessageReminder {
                    remind_at: now() + chrono::Duration::minutes(5),
                    description: "hello".into(),
                },
            )
            .await;
        assert!(matches!(missing, Err(ReminderError::EntityNotFound)));

        let message_id = Uuid::from_u128(2);
        service
            .repo
            .messages
            .lock()
            .unwrap()
            .push((channel_id, message_id, None));
        let past = service
            .set(
                &receipt,
                message_id,
                SetChannelMessageReminder {
                    remind_at: now(),
                    description: "hello".into(),
                },
            )
            .await;
        assert!(matches!(past, Err(ReminderError::BadRequest(_))));
    }
}
