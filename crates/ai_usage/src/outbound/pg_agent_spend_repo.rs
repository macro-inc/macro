//! Postgres reads behind the agent spend pane: per-bucket sums of `ai_usage`
//! and the team roles that decide who manages an agent account.

#[cfg(test)]
mod test;

use crate::domain::Result;
use crate::domain::spend::{AgentManagers, AgentSpendRepo, SpendPoint, SpendWindow};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Postgres-backed [`AgentSpendRepo`] and [`AgentManagers`].
#[derive(Clone)]
pub struct PgAgentSpendRepo {
    pool: PgPool,
}

impl PgAgentSpendRepo {
    /// Create a repo over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentSpendRepo for PgAgentSpendRepo {
    async fn spend_by_bucket(
        &self,
        user: &MacroUserIdStr<'_>,
        window: &SpendWindow,
    ) -> Result<Vec<SpendPoint>> {
        let bucket: &'static str = window.bucket.into();

        // The sum reads every row of the user in the window (index-only, on
        // ai_usage_user_id_created_at_total_idx), so its cost grows with the
        // user's usage: bound it. The pool sets no timeout of its own.
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        let rows = sqlx::query!(
            r#"
            SELECT
                date_trunc($4, created_at, 'UTC') AS "start!",
                SUM(total::float8) AS "cost_usd!"
            FROM ai_usage
            WHERE user_id = $1
              AND created_at >= $2
              AND created_at < $3
              AND total IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            "#,
            user.as_ref(),
            window.from,
            window.until,
            bucket,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(rows
            .into_iter()
            .map(|row| SpendPoint {
                start: row.start,
                cost_usd: row.cost_usd,
            })
            .collect())
    }
}

impl AgentManagers for PgAgentSpendRepo {
    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<bool> {
        let is_agent = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = $1 AND "isAgent") AS "is_agent!""#,
            user.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(is_agent)
    }

    async fn manages_agent(
        &self,
        actor: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<bool> {
        let manages = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM "User" agent
                JOIN team_user member ON member.user_id = agent.id
                JOIN team_user manager
                    ON manager.team_id = member.team_id
                   AND manager.user_id = $1
                WHERE agent.id = $2
                  AND agent."isAgent"
                  AND manager.team_role IN ('owner', 'admin')
            ) AS "manages!"
            "#,
            actor.as_ref(),
            agent.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(manages)
    }
}
