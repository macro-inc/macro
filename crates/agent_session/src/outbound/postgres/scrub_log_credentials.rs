use super::*;
use crate::domain::scrub_log_credentials::{FrameChange, StoredFrame, StoredFrameScrubRepo};

#[cfg(test)]
mod test;

impl<B: BotFacts + 'static> StoredFrameScrubRepo for PgAgentSessionRepo<B> {
    async fn frames_after(
        &self,
        after_id: Option<Uuid>,
        limit: NonZeroUsize,
    ) -> Result<Vec<StoredFrame>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, content
            FROM agent_session_log
            WHERE direction IN ('to_runtime', 'notification')
              AND ($1::uuid IS NULL OR id > $1)
            ORDER BY id
            LIMIT $2
            "#,
            after_id,
            i64::try_from(limit.get()).unwrap_or(i64::MAX),
        )
        .fetch_all(&self.pool)
        .await
        .context("read stored frames for cleanup")?;
        Ok(rows
            .into_iter()
            .map(|row| StoredFrame {
                id: row.id,
                content: row.content,
            })
            .collect())
    }

    async fn update_frames(&self, changes: Vec<FrameChange>) -> Result<u64> {
        let changes = serde_json::Value::Array(
            changes
                .into_iter()
                .map(|change| {
                    serde_json::json!({
                        "id": change.id,
                        "original": change.original,
                        "updated": change.updated,
                    })
                })
                .collect(),
        );
        let updated = sqlx::query!(
            r#"
            UPDATE agent_session_log AS log
            SET content = changes.updated
            FROM jsonb_to_recordset($1::jsonb)
                AS changes(id uuid, original jsonb, updated jsonb)
            WHERE log.id = changes.id
              AND log.direction IN ('to_runtime', 'notification')
              AND log.content = changes.original
            "#,
            changes,
        )
        .execute(&self.pool)
        .await
        .context("update unchanged stored frames")?;
        Ok(updated.rows_affected())
    }
}
