//! Auto-archive settings and the guarded archive itself.

use super::*;
use crate::domain::auto_archive::{
    AutoArchiveOverrides, AutoArchivePreferences, AutoArchiveReason, AutoArchiveRecord,
    AutoArchiveRepo, SessionAutoArchive,
};

impl<B: BotFacts + 'static> AutoArchiveRepo for PgAgentSessionRepo<B> {
    async fn user_auto_archive_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<AutoArchivePreferences> {
        let row = sqlx::query!(
            r#"
            SELECT on_pull_request_merged, on_runtime_closed
            FROM user_agent_session_auto_archive
            WHERE user_id = $1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("read user auto-archive preferences")?;
        Ok(row
            .map(|row| AutoArchivePreferences {
                on_pull_request_merged: row.on_pull_request_merged,
                on_runtime_closed: row.on_runtime_closed,
            })
            .unwrap_or_default())
    }

    async fn set_user_auto_archive_preferences(
        &self,
        user: &MacroUserIdStr<'static>,
        preferences: AutoArchivePreferences,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO user_agent_session_auto_archive
                (user_id, on_pull_request_merged, on_runtime_closed, modified_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET on_pull_request_merged = EXCLUDED.on_pull_request_merged,
                on_runtime_closed = EXCLUDED.on_runtime_closed,
                modified_at = NOW()
            "#,
            user.as_ref(),
            preferences.on_pull_request_merged,
            preferences.on_runtime_closed,
        )
        .execute(&self.pool)
        .await
        .context("persist user auto-archive preferences")?;
        Ok(())
    }

    async fn session_auto_archive(&self, session: AgentSessionId) -> Result<SessionAutoArchive> {
        let row = sqlx::query!(
            r#"
            SELECT
                override.on_pull_request_merged AS "override_on_pull_request_merged?",
                override.on_runtime_closed AS "override_on_runtime_closed?",
                COALESCE(defaults.on_pull_request_merged, false) AS "default_on_pull_request_merged!",
                COALESCE(defaults.on_runtime_closed, false) AS "default_on_runtime_closed!",
                archive.reason AS "reason?",
                archive.archived_at AS "archived_at?"
            FROM agent_session session
            LEFT JOIN agent_session_auto_archive_override override
                ON override.agent_session_id = session.id
            LEFT JOIN user_agent_session_auto_archive defaults
                ON defaults.user_id = session.owner_id
            LEFT JOIN agent_session_auto_archive archive
                ON archive.agent_session_id = session.id
            WHERE session.id = $1
            "#,
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("read session auto-archive")?
        .ok_or_else(|| anyhow::anyhow!("agent session not found"))?;
        let archived = match (row.reason, row.archived_at) {
            (Some(reason), Some(archived_at)) => Some(AutoArchiveRecord {
                reason: reason
                    .parse::<AutoArchiveReason>()
                    .context("read auto-archive reason")?,
                archived_at,
            }),
            _ => None,
        };
        Ok(SessionAutoArchive {
            overrides: AutoArchiveOverrides {
                on_pull_request_merged: row.override_on_pull_request_merged,
                on_runtime_closed: row.override_on_runtime_closed,
            },
            defaults: AutoArchivePreferences {
                on_pull_request_merged: row.default_on_pull_request_merged,
                on_runtime_closed: row.default_on_runtime_closed,
            },
            archived,
        })
    }

    async fn set_session_auto_archive_overrides(
        &self,
        session: AgentSessionId,
        overrides: AutoArchiveOverrides,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO agent_session_auto_archive_override
                (agent_session_id, on_pull_request_merged, on_runtime_closed, modified_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (agent_session_id) DO UPDATE
            SET on_pull_request_merged = EXCLUDED.on_pull_request_merged,
                on_runtime_closed = EXCLUDED.on_runtime_closed,
                modified_at = NOW()
            "#,
            session.as_uuid(),
            overrides.on_pull_request_merged,
            overrides.on_runtime_closed,
        )
        .execute(&self.pool)
        .await
        .context("persist session auto-archive overrides")?;
        Ok(())
    }

    async fn sessions_with_merged_pull_requests(
        &self,
        github_key: &str,
    ) -> Result<Vec<AgentSessionId>> {
        let ids = sqlx::query_scalar!(
            r#"
            SELECT link.agent_session_id
            FROM agent_session_pull_request link
            WHERE lower(link.github_key) = lower($1)
              AND NOT EXISTS (
                  SELECT 1
                  FROM agent_session_pull_request other
                  LEFT JOIN github_pull_request pull_request
                      ON lower(pull_request.github_key) = lower(other.github_key)
                  WHERE other.agent_session_id = link.agent_session_id
                    AND pull_request.status IS DISTINCT FROM 'merged'
                    AND pull_request.status IS DISTINCT FROM 'closed'
              )
              AND EXISTS (
                  SELECT 1
                  FROM agent_session_pull_request other
                  JOIN github_pull_request pull_request
                      ON lower(pull_request.github_key) = lower(other.github_key)
                  WHERE other.agent_session_id = link.agent_session_id
                    AND pull_request.status = 'merged'
              )
            ORDER BY link.agent_session_id
            "#,
            github_key,
        )
        .fetch_all(&self.pool)
        .await
        .context("list sessions with merged pull requests")?;
        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }

    async fn auto_archive(
        &self,
        session: AgentSessionId,
        reason: AutoArchiveReason,
    ) -> Result<bool> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin agent session auto-archive")?;
        // Lock the row first, so a turn starting or a prompt queued concurrently either lands
        // before the checks below see it or waits for the archive and is refused.
        let eligible = sqlx::query_scalar!(
            r#"
            SELECT session.id
            FROM agent_session session
            LEFT JOIN agent_session_auto_archive_override override
                ON override.agent_session_id = session.id
            LEFT JOIN user_agent_session_auto_archive defaults
                ON defaults.user_id = session.owner_id
            WHERE session.id = $1
              AND NOT session.is_archived
              AND CASE $2::text
                  WHEN 'pull_request_merged' THEN COALESCE(
                      override.on_pull_request_merged, defaults.on_pull_request_merged, false)
                  WHEN 'runtime_closed' THEN COALESCE(
                      override.on_runtime_closed, defaults.on_runtime_closed, false)
                  ELSE false
              END
              AND session.turn_state IS DISTINCT FROM 'starting'
              AND session.turn_state IS DISTINCT FROM 'running'
              AND session.turn_state IS DISTINCT FROM 'blocked'
              AND NOT EXISTS (
                  SELECT 1 FROM agent_session_auto_archive archive
                  WHERE archive.agent_session_id = session.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_conversation_sessions conversation
                  WHERE conversation.session_id = session.id AND conversation.is_current
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_session_queue queue
                  WHERE queue.agent_session_id = session.id
                    AND jsonb_array_length(queue.entries) > 0
              )
            FOR UPDATE OF session
            "#,
            session.as_uuid(),
            reason.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("check agent session auto-archive")?;
        if eligible.is_none() {
            return Ok(false);
        }
        sqlx::query!(
            r#"
            INSERT INTO agent_session_auto_archive (agent_session_id, reason)
            VALUES ($1, $2)
            "#,
            session.as_uuid(),
            reason.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .context("record agent session auto-archive")?;
        let modified_at = sqlx::query_scalar!(
            r#"
            UPDATE agent_session
            SET is_archived = true, modified_at = NOW()
            WHERE id = $1
            RETURNING modified_at
            "#,
            session.as_uuid(),
        )
        .fetch_one(&mut *transaction)
        .await
        .context("archive agent session")?;
        touch_entity_updated(&mut transaction, session, Some(modified_at)).await?;
        transaction
            .commit()
            .await
            .context("commit agent session auto-archive")?;
        Ok(true)
    }
}
