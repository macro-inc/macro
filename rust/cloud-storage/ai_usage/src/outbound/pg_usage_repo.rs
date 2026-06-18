//! Postgres-backed storage adapter for AI usage and pricing.

#[cfg(test)]
mod test;

use crate::domain::{
    AiFeature, CompletionUsage, Price, Result, Usage, UsageApiParams, UsageError, UsageRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Postgres-backed [`UsageRepo`].
#[derive(Clone)]
pub struct PgUsageRepo {
    inner: PgPool,
}

impl PgUsageRepo {
    /// Create a repo over a connection pool.
    pub fn new(inner: PgPool) -> Self {
        PgUsageRepo { inner }
    }
}

impl UsageRepo for PgUsageRepo {
    async fn insert_usage(&self, usage: &CompletionUsage) -> Result<()> {
        let id = macro_uuid::generate_uuid_v7();
        let (per_in, per_out, total) = match &usage.cost.price {
            Some(p) => (
                Some(p.price_per_million_in),
                Some(p.price_per_million_out),
                Some(p.total),
            ),
            None => (None, None, None),
        };

        sqlx::query!(
            r#"
            INSERT INTO ai_usage (
                id, feature, user_id, entity, model,
                input_tokens, output_tokens,
                price_per_million_in, price_per_million_out, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
            id,
            usage.feature.to_string(),
            usage.user.as_ref(),
            usage.entity,
            usage.cost.model,
            i64::from(usage.cost.input_tokens),
            i64::from(usage.cost.output_tokens),
            per_in,
            per_out,
            total,
        )
        .execute(&self.inner)
        .await?;

        Ok(())
    }

    async fn get_pricing(&self, model: &str) -> Result<Option<(f32, f32)>> {
        let row = sqlx::query!(
            r#"
            SELECT price_per_million_in, price_per_million_out
            FROM ai_pricing
            WHERE model = $1
            "#,
            model,
        )
        .fetch_optional(&self.inner)
        .await?;

        Ok(row.map(|r| (r.price_per_million_in, r.price_per_million_out)))
    }

    async fn set_pricing(
        &self,
        model: &str,
        price_per_million_in: f32,
        price_per_million_out: f32,
    ) -> Result<()> {
        let mut tx = self.inner.begin().await?;

        sqlx::query!(
            r#"
            INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out)
            VALUES ($1, $2, $3)
            ON CONFLICT (model) DO UPDATE
            SET price_per_million_in = EXCLUDED.price_per_million_in,
                price_per_million_out = EXCLUDED.price_per_million_out,
                updated_at = NOW()
            "#,
            model,
            price_per_million_in,
            price_per_million_out,
        )
        .execute(&mut *tx)
        .await?;

        // Recompute the price of every recorded row for this model.
        sqlx::query!(
            r#"
            UPDATE ai_usage
            SET price_per_million_in = $2::real,
                price_per_million_out = $3::real,
                total = (input_tokens::real / 1000000.0::real) * $2::real
                      + (output_tokens::real / 1000000.0::real) * $3::real
            WHERE model = $1
            "#,
            model,
            price_per_million_in,
            price_per_million_out,
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn query_usage(&self, params: &UsageApiParams) -> Result<Vec<CompletionUsage>> {
        let users: Vec<String> = params
            .include_users
            .iter()
            .map(|u| u.as_ref().to_string())
            .collect();
        let features: Vec<String> = params.features.iter().map(|f| f.to_string()).collect();

        let rows = sqlx::query!(
            r#"
            SELECT
                feature,
                user_id,
                entity,
                model,
                input_tokens,
                output_tokens,
                price_per_million_in,
                price_per_million_out,
                total,
                created_at
            FROM ai_usage
            WHERE ($1::timestamptz IS NULL OR created_at >= $1)
              AND ($2::timestamptz IS NULL OR created_at < $2)
              AND (cardinality($3::text[]) = 0 OR user_id = ANY($3))
              AND (cardinality($4::text[]) = 0 OR feature = ANY($4))
            ORDER BY created_at DESC
            "#,
            params.from,
            params.until,
            &users,
            &features,
        )
        .fetch_all(&self.inner)
        .await?;

        rows.into_iter()
            .map(|r| {
                let feature: AiFeature = r
                    .feature
                    .parse()
                    .map_err(|e| UsageError::Other(anyhow::anyhow!("invalid feature: {e}")))?;
                let user = MacroUserIdStr::try_from(r.user_id)
                    .map_err(|e| UsageError::Other(anyhow::anyhow!("invalid user id: {e}")))?;

                let price = match (r.price_per_million_in, r.price_per_million_out, r.total) {
                    (Some(per_in), Some(per_out), Some(total)) => Some(Price {
                        price_per_million_in: per_in,
                        price_per_million_out: per_out,
                        total,
                    }),
                    _ => None,
                };

                Ok(CompletionUsage {
                    feature,
                    user,
                    entity: r.entity,
                    cost: Usage {
                        input_tokens: r.input_tokens.clamp(0, i64::from(u32::MAX)) as u32,
                        output_tokens: r.output_tokens.clamp(0, i64::from(u32::MAX)) as u32,
                        model: r.model,
                        price,
                        created_at: r.created_at,
                    },
                })
            })
            .collect()
    }
}
