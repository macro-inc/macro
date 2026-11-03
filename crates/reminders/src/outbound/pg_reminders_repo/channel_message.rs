use super::PgRemindersRepo;
use crate::domain::{
    channel_message::{ChannelMessageFacts, ChannelMessageReminder, ChannelMessageReminderRepo},
    models::ReminderError,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

fn db(error: sqlx::Error) -> ReminderError {
    ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl ChannelMessageReminderRepo for PgRemindersRepo {
    type Err = ReminderError;

    async fn message_in_channel(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<ChannelMessageFacts>, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT thread_id FROM comms_messages
               WHERE id = $1
                 AND parent_entity_type = 'channel'
                 AND parent_entity_id = $2
                 AND deleted_at IS NULL"#,
            message_id,
            channel_id.to_string(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;
        Ok(row.map(|row| ChannelMessageFacts {
            thread_id: row.thread_id,
        }))
    }

    async fn active_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> Result<Option<ChannelMessageReminder>, Self::Err> {
        let row = sqlx::query!(
            r#"SELECT r.id, r.description, r.remind_at AS "remind_at!",
                      m.channel_id, m.message_id, m.thread_id
               FROM reminder_channel_message m
               JOIN reminder r ON r.id = m.reminder_id AND r.user_id = m.user_id
               WHERE m.user_id = $1 AND m.message_id = $2
                 AND r.enabled AND r.completed_at IS NULL"#,
            user.as_ref(),
            message_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;
        Ok(row.map(|row| ChannelMessageReminder {
            reminder_id: row.id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            thread_id: row.thread_id,
            description: row.description,
            remind_at: row.remind_at,
        }))
    }

    async fn existing_reminder_id(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> Result<Option<Uuid>, Self::Err> {
        sqlx::query_scalar!(
            r#"SELECT reminder_id FROM reminder_channel_message
               WHERE user_id = $1 AND message_id = $2"#,
            user.as_ref(),
            message_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)
    }

    async fn save_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        reminder: &ChannelMessageReminder,
    ) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        sqlx::query!(
            r#"INSERT INTO reminder (
                   id, user_id, description, entity_type, entity_id, remind_at, next_run_at, enabled, completed_at
               ) VALUES ($1, $2, $3, 'channel_message', $4, $5, $5, true, NULL)
               ON CONFLICT (id) DO UPDATE SET
                   description = EXCLUDED.description,
                   remind_at = EXCLUDED.remind_at,
                   next_run_at = EXCLUDED.next_run_at,
                   enabled = true,
                   completed_at = NULL,
                   updated_at = now()
               WHERE reminder.user_id = EXCLUDED.user_id"#,
            reminder.reminder_id,
            user.as_ref(),
            reminder.description,
            reminder.message_id,
            reminder.remind_at,
        )
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        sqlx::query!(
            r#"INSERT INTO reminder_channel_message (reminder_id, user_id, channel_id, message_id, thread_id)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (reminder_id) DO UPDATE SET
                   channel_id = EXCLUDED.channel_id,
                   message_id = EXCLUDED.message_id,
                   thread_id = EXCLUDED.thread_id
               WHERE reminder_channel_message.user_id = EXCLUDED.user_id"#,
            reminder.reminder_id,
            user.as_ref(),
            reminder.channel_id,
            reminder.message_id,
            reminder.thread_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        tx.commit().await.map_err(db)
    }

    async fn remove_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let removed = sqlx::query!(
            r#"UPDATE reminder r
               SET enabled = false, completed_at = now(), updated_at = now()
               FROM reminder_channel_message m
               WHERE m.reminder_id = r.id AND m.user_id = r.user_id
                 AND m.user_id = $1 AND m.message_id = $2
                 AND r.completed_at IS NULL"#,
            user.as_ref(),
            message_id,
        )
        .execute(&self.pool)
        .await
        .map_err(db)?;
        Ok(removed.rows_affected() > 0)
    }
}
