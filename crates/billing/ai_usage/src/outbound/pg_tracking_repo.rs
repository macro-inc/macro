//! Durable observational journal, isolated from financial admission and settlement.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json};

use super::pg_financial_usage_repo::StateData;
use crate::domain::financial::*;
use crate::domain::ports::{AiFeature, FinancialFuture};
use crate::domain::tracking::{
    TrackedInvocation, UsageTracking, UsageTrackingRepo, observation_state,
};

#[cfg(test)]
mod test;

/// Postgres observation adapter. Does not write financial or analytics tables.
pub struct PgTrackingRepo {
    pool: PgPool,
}

impl PgTrackingRepo {
    /// Construct at a composition root.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UsageTrackingRepo for PgTrackingRepo {}

impl UsageTracking for PgTrackingRepo {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            let data = Json(ObservationData::from(&request));
            let inserted = sqlx::query!(
                r#"INSERT INTO ai_usage_observation (invocation_id, occurred_at, request)
                   VALUES ($1, $2, $3) ON CONFLICT (invocation_id) DO NOTHING"#,
                request.invocation_id.as_uuid(),
                request.occurred_at,
                data as _,
            )
            .execute(&self.pool)
            .await?
            .rows_affected()
                == 1;
            if inserted {
                return Ok(WriteDisposition::Inserted);
            }
            let row = sqlx::query!(
                r#"SELECT request AS "request: Json<ObservationData>"
                   FROM ai_usage_observation WHERE invocation_id = $1"#,
                request.invocation_id.as_uuid(),
            )
            .fetch_one(&self.pool)
            .await?;
            if row.request.0.decode()? != request {
                return Err(FinancialError::ReplayConflict {
                    invocation_id: request.invocation_id,
                    phase: ReplayPhase::Begin,
                });
            }
            Ok(WriteDisposition::Replayed)
        })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            let id = evidence.invocation_id;
            let state = observation_state(evidence);
            let mut tx = self.pool.begin().await?;
            let row = sqlx::query!(
                r#"SELECT finalization AS "finalization: Json<StateData>"
                   FROM ai_usage_observation WHERE invocation_id = $1 FOR UPDATE"#,
                id.as_uuid(),
            )
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(FinancialError::InvocationNotFound)?;
            let disposition = if let Some(existing) = row.finalization {
                if existing.0.decode()? != state {
                    return Err(FinancialError::ReplayConflict {
                        invocation_id: id,
                        phase: ReplayPhase::Finalize,
                    });
                }
                WriteDisposition::Replayed
            } else {
                let data = Json(StateData::from_state(&state)?);
                sqlx::query!(
                    r#"UPDATE ai_usage_observation SET finalization = $2, finalized_at = now()
                       WHERE invocation_id = $1"#,
                    id.as_uuid(),
                    data as _,
                )
                .execute(&mut *tx)
                .await?;
                WriteDisposition::Inserted
            };
            tx.commit().await?;
            Ok(disposition)
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservationData {
    run_id: Uuid,
    invocation_id: Uuid,
    user_id: String,
    feature: AiFeature,
    entity: Option<Uuid>,
    provider: String,
    model: String,
    occurred_at: DateTime<Utc>,
}

impl From<&TrackedInvocation> for ObservationData {
    fn from(value: &TrackedInvocation) -> Self {
        Self {
            run_id: value.run_id.as_uuid(),
            invocation_id: value.invocation_id.as_uuid(),
            user_id: value.user.as_ref().to_owned(),
            feature: value.feature,
            entity: value.entity,
            provider: value.model.provider().to_owned(),
            model: value.model.model().to_owned(),
            occurred_at: value.occurred_at,
        }
    }
}

impl ObservationData {
    fn decode(self) -> FinancialResult<TrackedInvocation> {
        Ok(TrackedInvocation {
            run_id: self.run_id.try_into()?,
            invocation_id: self.invocation_id.try_into()?,
            user: MacroUserIdStr::try_from(self.user_id).map_err(|error| {
                FinancialError::Infrastructure(rootcause::report!(error).into_dynamic())
            })?,
            feature: self.feature,
            entity: self.entity,
            model: ProviderModel::new(self.provider, self.model)?,
            occurred_at: self.occurred_at,
        })
    }
}
