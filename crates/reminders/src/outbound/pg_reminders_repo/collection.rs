use super::{PgRemindersRepo, ReminderRow, RemindersRepoErr};
use crate::domain::{
    collection::{CollectionQuery, ReminderCollectionRow},
    email_followup::FollowupRecord,
    models::ReminderReference,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::types::Json;

impl PgRemindersRepo {
    pub(super) async fn read_collection(
        &self,
        user: &MacroUserIdStr<'_>,
        query: &CollectionQuery,
        as_of: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<ReminderCollectionRow>, RemindersRepoErr> {
        let cursor = query.cursor;
        let rows = sqlx::query!(
            r#"
            WITH candidates AS (
                SELECT r.*, NOT (
                    (r.completed_at IS NULL AND r.next_run_at <= $3)
                    OR (r.enabled AND (r.completed_at IS NULL OR r.cron IS NOT NULL))
                ) AS history
                FROM reminder r
                WHERE r.user_id = $1
                  AND ($2::bool IS NULL OR (r.completed_at IS NOT NULL) = $2)
            )
            SELECT r.id, r.description, r.entity_type, r.entity_id,
                r.remind_at, r.cron, r.timezone, r.next_run_at, r.enabled,
                r.completed_at, r.created_at, r.updated_at,
                d."fileType" AS "file_type?", dst.sub_type::text AS "sub_type?",
                f.payload AS "followup?: Json<FollowupRecord>"
            FROM candidates r
            LEFT JOIN "Document" d ON r.entity_type = 'document'
                AND d.id = r.entity_id::text AND d."deletedAt" IS NULL
            LEFT JOIN document_sub_type dst ON dst.document_id = d.id
            LEFT JOIN reminder_email_followup f ON f.reminder_id = r.id AND f.user_id = $1
            WHERE $4::bool IS NULL
                OR (r.history, r.next_run_at, r.created_at, r.id) > ($4, $5, $6, $7)
            ORDER BY r.history, r.next_run_at, r.created_at, r.id
            LIMIT $8
            "#,
            user.as_ref(),
            query.completed,
            as_of,
            cursor.map(|c| c.history),
            cursor.map(|c| c.position.next_run_at),
            cursor.map(|c| c.position.created_at),
            cursor.map(|c| c.position.id),
            limit,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let reminder = ReminderRow {
                    id: row.id,
                    description: row.description,
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                    remind_at: row.remind_at,
                    cron: row.cron,
                    timezone: row.timezone,
                    next_run_at: row.next_run_at,
                    enabled: row.enabled,
                    completed_at: row.completed_at,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                }
                .into_reminder()?;
                let reference = (row.file_type.is_some() || row.sub_type.is_some()).then_some(
                    ReminderReference {
                        file_type: row.file_type,
                        sub_type: row.sub_type,
                    },
                );
                Ok(ReminderCollectionRow {
                    reminder,
                    reference,
                    email_followup: row.followup.map(|f| f.0.followup),
                })
            })
            .collect()
    }
}
