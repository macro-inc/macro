//! Postgres-backed storage adapter for AI usage and pricing.

#[cfg(test)]
mod test;

use crate::domain::{
    AiFeature, CompletionUsage, ModelPricing, Price, Result, Usage, UsageAmount, UsageApiParams,
    UsageError, UsageRepo,
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
        let (input_tokens, output_tokens, audio_seconds) = match usage.cost.amount {
            UsageAmount::Tokens { input, output } => (
                i64::try_from(input).unwrap_or(i64::MAX),
                i64::try_from(output).unwrap_or(i64::MAX),
                None,
            ),
            UsageAmount::Audio { duration } => (0, 0, Some(duration.as_secs_f64())),
        };
        let (per_in, per_out, per_audio_minute, total) = match usage.cost.price {
            Some(Price {
                pricing: ModelPricing::Tokens { input, output },
                total,
            }) => (Some(input), Some(output), None, Some(total)),
            Some(Price {
                pricing: ModelPricing::Audio { per_minute },
                total,
            }) => (Some(0.0), Some(0.0), Some(per_minute), Some(total)),
            None => (None, None, None, None),
        };

        sqlx::query!(
            r#"
            INSERT INTO ai_usage (
                id, feature, user_id, entity, model,
                input_tokens, output_tokens, audio_seconds,
                price_per_million_in, price_per_million_out, price_per_audio_minute, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            id,
            usage.feature.to_string(),
            usage.user.as_ref(),
            usage.entity,
            usage.cost.model,
            input_tokens,
            output_tokens,
            audio_seconds,
            per_in,
            per_out,
            per_audio_minute,
            total,
        )
        .execute(&self.inner)
        .await?;

        Ok(())
    }

    async fn get_pricing(&self, model: &str) -> Result<Option<ModelPricing>> {
        let row = sqlx::query!(
            r#"
            SELECT price_per_million_in, price_per_million_out, price_per_audio_minute
            FROM ai_pricing
            WHERE model = $1
            "#,
            model,
        )
        .fetch_optional(&self.inner)
        .await?;

        Ok(row.map(|r| match r.price_per_audio_minute {
            Some(per_minute) => ModelPricing::Audio { per_minute },
            None => ModelPricing::Tokens {
                input: r.price_per_million_in,
                output: r.price_per_million_out,
            },
        }))
    }

    async fn set_pricing(&self, model: &str, pricing: ModelPricing) -> Result<()> {
        let (per_in, per_out, per_audio_minute) = match pricing {
            ModelPricing::Tokens { input, output } => (input, output, None),
            ModelPricing::Audio { per_minute } => (0.0, 0.0, Some(per_minute)),
        };
        let mut tx = self.inner.begin().await?;

        sqlx::query!(
            r#"
            INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_audio_minute)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (model) DO UPDATE
            SET price_per_million_in = EXCLUDED.price_per_million_in,
                price_per_million_out = EXCLUDED.price_per_million_out,
                price_per_audio_minute = EXCLUDED.price_per_audio_minute,
                updated_at = NOW()
            "#,
            model,
            per_in,
            per_out,
            per_audio_minute,
        )
        .execute(&mut *tx)
        .await?;

        // Recompute the price of every recorded row for this model.
        sqlx::query!(
            r#"
            UPDATE ai_usage
            SET price_per_million_in = $2::real,
                price_per_million_out = $3::real,
                price_per_audio_minute = $4::real,
                total = CASE WHEN (audio_seconds IS NULL) <> ($4::real IS NULL) THEN NULL
                      ELSE (input_tokens::real / 1000000.0::real) * $2::real
                      + (output_tokens::real / 1000000.0::real) * $3::real
                      + (COALESCE(audio_seconds, 0) / 60.0 * COALESCE($4::real, 0))::real END
            WHERE model = $1
            "#,
            model,
            per_in,
            per_out,
            per_audio_minute,
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
                audio_seconds,
                price_per_million_in,
                price_per_million_out,
                price_per_audio_minute,
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
                        pricing: match r.price_per_audio_minute {
                            Some(per_minute) => ModelPricing::Audio { per_minute },
                            None => ModelPricing::Tokens {
                                input: per_in,
                                output: per_out,
                            },
                        },
                        total,
                    }),
                    _ => None,
                };

                Ok(CompletionUsage {
                    feature,
                    user,
                    entity: r.entity,
                    cost: Usage {
                        amount: match r.audio_seconds {
                            Some(seconds) => UsageAmount::Audio {
                                duration: std::time::Duration::try_from_secs_f64(seconds)
                                    .map_err(|error| UsageError::Other(error.into()))?,
                            },
                            None => UsageAmount::Tokens {
                                input: r.input_tokens.max(0) as u64,
                                output: r.output_tokens.max(0) as u64,
                            },
                        },
                        model: r.model,
                        price,
                        created_at: r.created_at,
                    },
                })
            })
            .collect()
    }
}

// The domain error stays sqlx-free; this adapter owns the mapping so `?`
// works on sqlx results throughout the crate's outbound code. The raw sqlx
// error travels inside the report.
impl From<sqlx::Error> for crate::domain::ports::UsageError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(rootcause::report!(e).into_dynamic())
    }
}
