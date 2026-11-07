//! Reads prospectively counted AI usage from `ai_usage` at provider cost.

#[cfg(test)]
mod test;

use crate::domain::plan_change::{
    PlanChange, PlanUsageSegment, RecordedPlanChange, meter_plan_usage,
};
use crate::domain::{BillingError, BillingPeriod, PlanTier, Result, SeatUsage, UsageReader};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::HashMap;

/// Counted rows recorded before a model had pricing carry a NULL total. Price
/// them at the Opus 5 rate rather than for free; `set_pricing` backfills them later.
///
/// These mirror the `claude-opus-5` row seeded into `ai_pricing` by
/// `20260724182218_seed_claude_opus_5_pricing.sql` ($5 in / $25 out per
/// million tokens) and its cache rates from
/// `20261005221204_ai_prompt_cache_pricing.sql` ($0.50 read / $6.25 write),
/// the dearest model the picker offered when the fallback was chosen. Keep
/// them in step with those seeds.
const FALLBACK_PRICE_PER_MILLION_IN: f64 = 5.0;
const FALLBACK_PRICE_PER_MILLION_OUT: f64 = 25.0;
const FALLBACK_PRICE_PER_MILLION_CACHE_READ: f64 = 0.5;
const FALLBACK_PRICE_PER_MILLION_CACHE_WRITE: f64 = 6.25;

/// Postgres-backed [`UsageReader`] over the `ai_usage` table.
#[derive(Clone)]
pub struct PgUsageReader {
    pool: PgPool,
}

impl PgUsageReader {
    /// Create a reader over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UsageReader for PgUsageReader {
    async fn usage_cost_cents_by_user(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> Result<Vec<SeatUsage>> {
        if users.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = users.iter().map(|u| u.as_ref().to_string()).collect();
        // One statement gives history and usage the same database snapshot,
        // even when a webhook records another transition during this read.
        let rows = sqlx::query_file!(
            "src/outbound/pg_usage_reader/usage.sql",
            &ids,
            period.start,
            period.end,
            FALLBACK_PRICE_PER_MILLION_IN,
            FALLBACK_PRICE_PER_MILLION_OUT,
            FALLBACK_PRICE_PER_MILLION_CACHE_READ,
            FALLBACK_PRICE_PER_MILLION_CACHE_WRITE,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Storage(e.into()))?;
        let mut changes: HashMap<String, Vec<RecordedPlanChange>> = HashMap::new();
        let mut segments: HashMap<String, (bool, Vec<PlanUsageSegment>)> = HashMap::new();
        for row in rows {
            match (
                row.is_plan_change,
                row.previous_plan,
                row.new_plan,
                row.usd,
                row.public_funding,
            ) {
                (true, Some(from), Some(to), None, None) => {
                    changes
                        .entry(row.user_id)
                        .or_default()
                        .push(RecordedPlanChange {
                            change: PlanChange {
                                from: parse_plan(&from)?,
                                to: parse_plan(&to)?,
                                at: row.start,
                                period,
                            },
                            previous_included_cents: row.previous_included_cost_cents,
                            new_included_cents: row.new_included_cost_cents,
                        });
                }
                (false, None, None, Some(usd), Some(public)) => {
                    segments
                        .entry(row.user_id)
                        .or_insert_with(|| (public, Vec::new()))
                        .1
                        .push(PlanUsageSegment {
                            start: row.start,
                            usd,
                        });
                }
                _ => {
                    return Err(BillingError::Storage(anyhow::anyhow!(
                        "invalid plan usage row"
                    )));
                }
            }
        }
        let mut result = Vec::new();
        for (id, (public, segments)) in segments {
            let history = changes.get(&id).map(Vec::as_slice).unwrap_or_default();
            let usage = meter_plan_usage(history, &segments, public);
            if usage.used_cents == 0 && usage.chargeable_cents == 0 {
                continue;
            }
            result.push(SeatUsage {
                user: MacroUserIdStr::try_from(id).map_err(|e| BillingError::Storage(e.into()))?,
                used_cents: usage.used_cents,
                chargeable_cost_cents: (!history.is_empty()).then_some(usage.chargeable_cents),
            });
        }
        Ok(result)
    }
}

fn parse_plan(plan: &str) -> Result<PlanTier> {
    match plan {
        "free" => Ok(PlanTier::Free),
        "premium" => Ok(PlanTier::Premium),
        "max" => Ok(PlanTier::Max),
        _ => Err(BillingError::Storage(anyhow::anyhow!(
            "invalid recorded plan"
        ))),
    }
}
