//! Postgres aggregate CAS, capture leases, and a durable feedback outbox.

use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::domain::{
    model::{Result, Review, ReviewError},
    ports::ReviewRepo,
};

/// Review-owned Postgres adapter.
pub struct PgReviewRepo {
    pool: PgPool,
}

impl PgReviewRepo {
    /// Use the harness's existing pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ReviewRepo for PgReviewRepo {
    async fn cleanup_sessions(&self) -> Result<Vec<AgentSessionId>> {
        let rows = sqlx::query!("SELECT agent_session_id FROM agent_review_cleanup WHERE available_at < now() ORDER BY available_at LIMIT 4").fetch_all(&self.pool).await.map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(rows
            .into_iter()
            .map(|r| AgentSessionId::new_from_uuid(r.agent_session_id))
            .collect())
    }
    async fn finish_cleanup(&self, session: AgentSessionId) -> Result<()> {
        sqlx::query!(
            "DELETE FROM agent_review_cleanup WHERE agent_session_id = $1",
            session.as_uuid()
        )
        .execute(&self.pool)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }
    async fn load(&self, session: AgentSessionId) -> Result<Option<Review>> {
        let row = sqlx::query!(r#"SELECT state AS "state: Json<Review>" FROM agent_review WHERE agent_session_id = $1"#, session.as_uuid())
            .fetch_optional(&self.pool).await.map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(row.map(|r| r.state.0))
    }

    async fn save(
        &self,
        review: &Review,
        previous: Option<i64>,
        capture_claim: Option<Uuid>,
    ) -> Result<bool> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        if let Some(claim) = capture_claim {
            let valid = sqlx::query!("SELECT claim FROM agent_review_capture WHERE agent_session_id = $1 AND claim = $2 AND expires_at > now() FOR UPDATE", review.session_id, claim)
                .fetch_optional(&mut *tx).await.map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
            if valid.is_none() {
                return Err(ReviewError::Conflict);
            }
        }
        let changed = sqlx::query!(
            r#"
            INSERT INTO agent_review (agent_session_id, review_id, version, state)
            SELECT $1, $2, $3, $4 WHERE $5::bigint IS NULL
            ON CONFLICT (agent_session_id) DO NOTHING
        "#,
            review.session_id,
            review.id.0,
            review.version,
            Json(review) as _,
            previous
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
        .rows_affected();
        let changed = if previous.is_some() {
            sqlx::query!(
                r#"UPDATE agent_review SET version = $3, state = $4, updated_at = now()
                WHERE agent_session_id = $1 AND version = $2"#,
                review.session_id,
                previous,
                review.version,
                Json(review) as _
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
            .rows_affected()
        } else {
            changed
        };
        if changed == 0 {
            return Ok(false);
        }
        let pending: Vec<Uuid> = review
            .threads
            .iter()
            .flat_map(|t| &t.messages)
            .filter(|m| m.delivery == Some(crate::domain::model::Delivery::Pending))
            .map(|m| m.id)
            .collect();
        sqlx::query!(
            r#"INSERT INTO agent_review_feedback (agent_session_id, message_id)
            SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING"#,
            review.session_id,
            &pending
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        tx.commit()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(true)
    }

    async fn claim_capture(&self, session: AgentSessionId, claim: Uuid) -> Result<bool> {
        let row = sqlx::query!(r#"INSERT INTO agent_review_capture (agent_session_id, claim, expires_at)
            VALUES ($1, $2, now() + interval '5 minutes')
            ON CONFLICT (agent_session_id) DO UPDATE SET claim = EXCLUDED.claim, expires_at = EXCLUDED.expires_at
            WHERE agent_review_capture.expires_at < now() RETURNING claim"#, session.as_uuid(), claim)
            .fetch_optional(&self.pool).await.map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(row.is_some())
    }

    async fn release_capture(&self, session: AgentSessionId, claim: Uuid) -> Result<()> {
        sqlx::query!(
            "DELETE FROM agent_review_capture WHERE agent_session_id = $1 AND claim = $2",
            session.as_uuid(),
            claim
        )
        .execute(&self.pool)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }

    async fn pending_feedback(&self) -> Result<Vec<AgentSessionId>> {
        let rows = sqlx::query!(
            r#"SELECT DISTINCT agent_session_id FROM agent_review_feedback
            WHERE NOT delivered AND (lease_until IS NULL OR lease_until < now()) LIMIT 32"#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(rows
            .into_iter()
            .map(|r| AgentSessionId::new_from_uuid(r.agent_session_id))
            .collect())
    }

    async fn claim_feedback(&self, session: AgentSessionId, message: Uuid) -> Result<bool> {
        let row = sqlx::query!(
            r#"UPDATE agent_review_feedback SET lease_until = now() + interval '2 minutes'
            WHERE agent_session_id = $1 AND message_id = $2 AND NOT delivered
            AND (lease_until IS NULL OR lease_until < now()) RETURNING message_id"#,
            session.as_uuid(),
            message
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(row.is_some())
    }

    async fn finish_feedback(
        &self,
        session: AgentSessionId,
        message: Uuid,
        delivered: bool,
    ) -> Result<()> {
        sqlx::query!(r#"UPDATE agent_review_feedback SET delivered = $3, lease_until = now() + interval '30 seconds'
            WHERE agent_session_id = $1 AND message_id = $2"#, session.as_uuid(), message, delivered)
            .execute(&self.pool).await.map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
