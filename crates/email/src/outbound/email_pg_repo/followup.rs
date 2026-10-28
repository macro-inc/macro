use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::EmailPgRepo;
use crate::domain::{
    followup::{EmailFollowupRepo, FollowupMessage},
    models::EmailErr,
};

impl EmailFollowupRepo for EmailPgRepo {
    async fn followup_messages(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> Result<Vec<FollowupMessage>, EmailErr> {
        sqlx::query_as!(
            FollowupMessage,
            r#"
            SELECT m.id, m.internal_date_ts AS received_at,
                (m.is_sent OR m.is_draft) AS "outgoing!",
                EXISTS (
                    SELECT 1 FROM email_links l
                    WHERE lower(l.email_address) = lower(c.email_address)
                      AND (l.macro_id = $3 OR EXISTS (
                          SELECT 1 FROM macro_user_links mul
                          WHERE mul.link_id = l.id AND mul.primary_macro_id = $3
                      ))
                ) AS "from_self!"
            FROM email_messages m
            LEFT JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.thread_id = $1 AND m.link_id = $2
            ORDER BY m.id
            "#,
            thread_id,
            link_id,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn followup_returned_at(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> Result<Option<DateTime<Utc>>, EmailErr> {
        sqlx::query_scalar!(
            "SELECT reminder_returned_at FROM email_threads WHERE id = $1 AND link_id = $2",
            thread_id,
            link_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map(Option::flatten)
        .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn set_followup_returned_at(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
        returned_at: Option<DateTime<Utc>>,
    ) -> Result<(), EmailErr> {
        sqlx::query!(
            "UPDATE email_threads SET reminder_returned_at = $3 WHERE id = $1 AND link_id = $2",
            thread_id,
            link_id,
            returned_at,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| EmailErr::RepoErr(e.into()))?;
        Ok(())
    }
}
