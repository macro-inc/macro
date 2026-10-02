use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use uuid::Uuid;

use super::{PgRemindersRepo, ReminderRow, RemindersRepoErr};
use crate::domain::{
    collection::ReminderCollectionRow,
    email_collection::{EmailReminderCandidate, EmailReminderCursor, EmailReminderSummary},
    email_followup::FollowupRecord,
};

#[derive(Deserialize)]
struct StoredEmailReminder {
    #[serde(flatten)]
    reminder: ReminderRow,
    followup: Option<serde_json::Value>,
    has_followup: bool,
}

impl PgRemindersRepo {
    pub(super) async fn read_email_candidates(
        &self,
        user: &MacroUserIdStr<'_>,
        thread_ids: Option<&[Uuid]>,
        cursor: Option<EmailReminderCursor>,
        as_of: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<EmailReminderCandidate>, RemindersRepoErr> {
        let rows = sqlx::query!(
            r#"
            WITH eligible AS MATERIALIZED (
                SELECT r.id, r.description, r.entity_type, r.entity_id,
                    r.remind_at, r.cron, r.timezone, r.next_run_at, r.enabled,
                    r.completed_at, r.created_at, r.updated_at, f.payload AS followup,
                    (f.reminder_id IS NOT NULL) AS has_followup
                FROM reminder r
                LEFT JOIN reminder_email_followup f ON f.reminder_id = r.id AND f.user_id = $1
                WHERE r.user_id = $1 AND r.entity_type = 'email_thread' AND r.entity_id IS NOT NULL
                    AND ($2::uuid[] IS NULL OR r.entity_id = ANY($2))
                    AND CASE WHEN f.reminder_id IS NOT NULL THEN
                        f.state IN ('archiving', 'pending', 'returning')
                        OR (f.state = 'returned' AND r.completed_at IS NULL)
                    ELSE
                        (r.enabled AND (r.completed_at IS NULL OR r.cron IS NOT NULL))
                        OR (r.cron IS NULL AND r.completed_at IS NULL AND r.next_run_at <= $3)
                    END
            ), grouped AS (
                SELECT entity_id, MIN(next_run_at) AS next_run_at
                FROM eligible GROUP BY entity_id
            ), candidates AS (
                SELECT entity_id, next_run_at FROM grouped
                WHERE $4::timestamptz IS NULL OR (next_run_at, entity_id) > ($4, $5)
                ORDER BY next_run_at, entity_id LIMIT $6
            )
            SELECT c.entity_id AS "thread_id!", c.next_run_at AS "next_run_at!",
                jsonb_agg(to_jsonb(r) ORDER BY r.next_run_at, r.created_at, r.id) AS "reminders!"
            FROM candidates c JOIN eligible r ON r.entity_id = c.entity_id
            GROUP BY c.entity_id, c.next_run_at
            ORDER BY c.next_run_at, c.entity_id
            "#,
            user.as_ref(),
            thread_ids,
            as_of,
            cursor.map(|c| c.next_run_at),
            cursor.map(|c| c.thread_id),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let mut decoded = Vec::new();
                if let Some(values) = row.reminders.as_array() {
                    for value in values {
                        let item = (|| {
                            let stored: StoredEmailReminder =
                                serde_json::from_value(value.clone()).ok()?;
                            let followup = match (stored.has_followup, stored.followup) {
                                (true, Some(payload)) => {
                                    let record: FollowupRecord =
                                        serde_json::from_value(payload).ok()?;
                                    if record.user_id.as_ref() != user.as_ref()
                                        || record.followup.thread_id != row.thread_id
                                        || record.followup.reminder_id != stored.reminder.id
                                    {
                                        return None;
                                    }
                                    Some(record.followup)
                                }
                                (true, None) => return None,
                                (false, _) => None,
                            };
                            Some(ReminderCollectionRow {
                                reminder: stored.reminder.into_reminder().ok()?,
                                reference: None,
                                email_followup: followup,
                            })
                        })();
                        if let Some(item) = item {
                            decoded.push(item);
                        } else {
                            tracing::warn!("skipping malformed email reminder projection");
                        }
                    }
                }
                let count = decoded.len() as u32;
                EmailReminderCandidate {
                    cursor: EmailReminderCursor {
                        as_of,
                        next_run_at: row.next_run_at,
                        thread_id: row.thread_id,
                    },
                    summary: decoded
                        .into_iter()
                        .next()
                        .map(|nearest| EmailReminderSummary {
                            thread_id: row.thread_id,
                            nearest,
                            count,
                        }),
                }
            })
            .collect())
    }
}
