//! Routine drafts in progress, in `scheduled_action_draft`.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::models::{CreatedItem, RoutineCheck};
use crate::domain::ports::{DraftHandBacks, HandedBack, StaleDraft};

#[cfg(test)]
mod test;

pub struct PgDraftHandBacks {
    pool: PgPool,
}

impl PgDraftHandBacks {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl DraftHandBacks for PgDraftHandBacks {
    async fn begin(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        agent: bot_id::BotId,
    ) -> Result<()> {
        sqlx::query!(
            "INSERT INTO scheduled_action_draft (session_id, owner_id, bot_id) VALUES ($1, $2, $3)",
            session,
            owner.as_ref(),
            agent.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("start a routine draft")?;
        Ok(())
    }

    async fn record(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        check: &RoutineCheck,
        created: &[CreatedItem],
    ) -> Result<bool> {
        let checked = serde_json::to_value(check).context("encode a draft's check")?;
        let created = serde_json::to_value(created).context("encode what a draft created")?;
        // What it created adds up across checks, each item once.
        let updated = sqlx::query!(
            r#"
            UPDATE scheduled_action_draft SET
                checked = $3,
                checks = checks + 1,
                created = (
                    SELECT COALESCE(jsonb_agg(DISTINCT item), '[]')
                    FROM jsonb_array_elements(created || $4::jsonb) AS item
                )
            WHERE session_id = $1 AND owner_id = $2
            "#,
            session,
            owner.as_ref(),
            checked,
            created,
        )
        .execute(&self.pool)
        .await
        .context("keep a draft's check")?;
        Ok(updated.rows_affected() > 0)
    }

    async fn handed_back(&self, session: Uuid) -> Result<HandedBack> {
        let row = sqlx::query!(
            "SELECT checked, checks, created FROM scheduled_action_draft WHERE session_id = $1",
            session,
        )
        .fetch_optional(&self.pool)
        .await
        .context("read a draft's check")?;
        let Some(row) = row else {
            return Ok(HandedBack::default());
        };
        Ok(HandedBack {
            // A check this build can't read is no answer.
            check: row
                .checked
                .and_then(|checked| serde_json::from_value(checked).ok()),
            checks: u32::try_from(row.checks).unwrap_or_default(),
            created: serde_json::from_value(row.created).unwrap_or_default(),
        })
    }

    async fn finish(&self, session: Uuid) -> Result<()> {
        sqlx::query!(
            "DELETE FROM scheduled_action_draft WHERE session_id = $1",
            session
        )
        .execute(&self.pool)
        .await
        .context("finish a routine draft")?;
        Ok(())
    }

    async fn stale(&self, before: DateTime<Utc>, limit: u16) -> Result<Vec<StaleDraft>> {
        let rows = sqlx::query!(
            r#"
            SELECT session_id, owner_id, bot_id FROM scheduled_action_draft
            WHERE created_at < $1 ORDER BY created_at LIMIT $2
            "#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .context("list stale routine drafts")?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(StaleDraft {
                    session: row.session_id,
                    owner: MacroUserIdStr::try_from(row.owner_id).ok()?,
                    agent: bot_id::BotId::new_from_uuid(row.bot_id),
                })
            })
            .collect())
    }
}
