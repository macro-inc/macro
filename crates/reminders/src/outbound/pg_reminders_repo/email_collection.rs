use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{PgRemindersRepo, ReminderRow, RemindersRepoErr};
use crate::domain::{
    collection::ReminderCollectionRow,
    email_collection::{EmailReminderCandidate, EmailReminderCursor, EmailReminderSummary},
    email_followup::FollowupRecord,
};

impl PgRemindersRepo {
    pub(super) async fn read_email_candidates(
        &self,
        user: &MacroUserIdStr<'_>,
        thread_ids: Option<&[Uuid]>,
        cursor: Option<EmailReminderCursor>,
        as_of: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<EmailReminderCandidate>, RemindersRepoErr> {
        // The active workflow index guarantees one snooze per user/thread.
        // Fired and legacy generic reminders are not part of this collection.
        let rows = sqlx::query!(
            r#"
            SELECT r.entity_id AS "thread_id!", r.next_run_at,
                to_jsonb(r) AS "reminder!", f.payload AS followup
            FROM reminder r
            JOIN reminder_email_followup f ON f.reminder_id = r.id AND f.user_id = $1
            WHERE r.user_id = $1 AND r.entity_type = 'email_thread' AND r.entity_id IS NOT NULL
                AND ($2::uuid[] IS NULL OR r.entity_id = ANY($2))
                AND f.state IN ('archiving', 'pending', 'returning')
                AND ($3::timestamptz IS NULL OR (r.next_run_at, r.entity_id) > ($3, $4))
            ORDER BY r.next_run_at, r.entity_id LIMIT $5
            "#,
            user.as_ref(),
            thread_ids,
            cursor.map(|c| c.next_run_at),
            cursor.map(|c| c.thread_id),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let summary = (|| {
                    let stored: ReminderRow = serde_json::from_value(row.reminder).ok()?;
                    let record: FollowupRecord = serde_json::from_value(row.followup).ok()?;
                    if record.user_id.as_ref() != user.as_ref()
                        || record.followup.thread_id != row.thread_id
                        || record.followup.reminder_id != stored.id
                    {
                        return None;
                    }
                    Some(EmailReminderSummary {
                        thread_id: row.thread_id,
                        nearest: ReminderCollectionRow {
                            reminder: stored.into_reminder().ok()?,
                            reference: None,
                            email_followup: Some(record.followup),
                        },
                        count: 1,
                    })
                })();
                if summary.is_none() {
                    tracing::warn!("skipping malformed email reminder projection");
                }
                EmailReminderCandidate {
                    cursor: EmailReminderCursor {
                        as_of,
                        next_run_at: row.next_run_at,
                        thread_id: row.thread_id,
                    },
                    summary,
                }
            })
            .collect())
    }
}
