//! Each repo's push budget, a token bucket in its `agent_repos` row, so every
//! replica of the service draws from the same one.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::ports::PushRateLimiter;

/// Allows `pushes_per_minute` pushes per repo, refilling continuously.
#[derive(Clone)]
pub struct PgPushRateLimiter {
    pool: PgPool,
    pushes_per_minute: u32,
}

impl PgPushRateLimiter {
    /// A limiter over MacroDB's `agent_repos`.
    pub fn new(pool: PgPool, pushes_per_minute: u32) -> Self {
        Self {
            pool,
            pushes_per_minute,
        }
    }
}

impl PushRateLimiter for PgPushRateLimiter {
    type Err = sqlx::Error;

    #[tracing::instrument(name = "agent_git.push_budget", skip_all, fields(repo_id = %agent_credentials::telemetry_id(agent_user_id.as_ref()), allowed), err)]
    async fn try_acquire_push(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, sqlx::Error> {
        // One statement: refill by the time since the last refill, then take a
        // token if there is a whole one. A missing row takes nothing.
        let taken = sqlx::query_scalar!(
            r#"
            WITH bucket AS (
                SELECT LEAST(
                    $2::float8,
                    COALESCE(push_tokens, $2::float8)
                        + EXTRACT(EPOCH FROM now() - COALESCE(push_tokens_refilled_at, now()))::float8
                            * $2::float8 / 60
                ) AS tokens
                FROM agent_repos
                WHERE agent_user_id = $1
                FOR UPDATE
            )
            UPDATE agent_repos
            SET push_tokens = bucket.tokens - 1, push_tokens_refilled_at = now()
            FROM bucket
            WHERE agent_user_id = $1 AND bucket.tokens >= 1
            RETURNING true AS "taken!"
            "#,
            agent_user_id.as_ref(),
            f64::from(self.pushes_per_minute),
        )
        .fetch_optional(&self.pool)
        .await?
        .is_some();
        tracing::Span::current().record("allowed", taken);
        Ok(taken)
    }
}
