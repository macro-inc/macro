//! PostgreSQL reads behind an agent's routines summary.

use std::str::FromStr;

use anyhow::Result;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::agent_routines::{AgentRoutine, TriggerKind};
use crate::domain::models::MAX_ACTION_TIME;
use crate::domain::ports::AgentRoutineStore;

#[cfg(test)]
mod test;

/// Reads `scheduled_action` for the list and `"User"` with `team_user` for
/// the agent and oversight checks.
pub struct PgAgentRoutines {
    pool: PgPool,
}

impl PgAgentRoutines {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentRoutineStore for PgAgentRoutines {
    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<bool> {
        let is_agent = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = $1 AND "isAgent") AS "is_agent!""#,
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(is_agent)
    }

    async fn oversees(
        &self,
        viewer: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<bool> {
        // A user belongs to at most one team (`team_user_user_id_unique`),
        // so this is three key lookups.
        let oversees = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM "User" agent
                JOIN team_user member ON member.user_id = agent.id
                JOIN team_user manager ON manager.team_id = member.team_id
                WHERE agent.id = $2 AND agent."isAgent"
                  AND manager.user_id = $1
                  AND manager.team_role IN ('owner', 'admin')
            ) AS "oversees!"
            "#,
            viewer.as_ref(),
            agent.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(oversees)
    }

    async fn top_level_routines(
        &self,
        owner: &MacroUserIdStr<'_>,
        limit: u8,
    ) -> Result<Vec<AgentRoutine>> {
        // Finished one-time sub-routines share their parent's owner and
        // accumulate without bound. `owner COLLATE "C"` and the
        // `parent_id IS NULL` predicate match
        // `scheduled_action_top_level_owner_idx`, which holds top-level rows
        // only and is the one owner index this comparison can use.
        let rows = sqlx::query!(
            r#"
            SELECT id, name, enabled, trigger_type, next_run_at,
                   (claim_token IS NOT NULL AND claimed >= $2) AS "running!"
            FROM scheduled_action
            WHERE owner COLLATE "C" = $1 AND parent_id IS NULL
            ORDER BY created_at, id
            LIMIT $3
            "#,
            owner.as_ref(),
            Utc::now() - MAX_ACTION_TIME,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;

        // A trigger type this code doesn't know (a newer replica's) leaves
        // that routine out of the summary instead of failing the list.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let trigger_kind = TriggerKind::from_str(&row.trigger_type)
                    .inspect_err(|_| {
                        tracing::warn!(
                            routine.id = %row.id,
                            routine.trigger_type = %row.trigger_type,
                            "unknown trigger type; routine left out of the agent summary"
                        );
                    })
                    .ok()?;
                Some(AgentRoutine {
                    id: row.id,
                    name: row.name,
                    enabled: row.enabled,
                    running: row.running,
                    trigger_kind,
                    next_run_at: row.next_run_at,
                    last_run: None,
                })
            })
            .collect())
    }
}
