//! The cost service: resolves pricing, records usage, and answers queries.

use std::collections::BTreeMap;

use chrono::Utc;

use super::ports::*;

/// The cost service. Generic over the storage [`UsageRepo`].
///
/// Implements:
/// - [`UsageRecorder`] for the agent crate (fire-and-forget recording), and
/// - [`UsageService`] for the inbound admin API (querying and re-pricing).
#[derive(Clone)]
pub struct UsageServiceImpl<Repo> {
    repo: Repo,
}

impl<Repo> UsageServiceImpl<Repo> {
    /// Construct the service over a storage repository.
    pub fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

impl<Repo> UsageServiceImpl<Repo>
where
    Repo: UsageRepo + Clone,
{
    /// Resolve pricing and persist a single event. Separated out so [`record`]
    /// can run it on a background task.
    ///
    /// [`record`]: UsageRecorder::record
    async fn record_event(repo: &Repo, event: UsageEvent) -> Result<()> {
        let mut cost = Usage {
            input_tokens: event.input_tokens.min(u32::MAX as u64) as u32,
            output_tokens: event.output_tokens.min(u32::MAX as u64) as u32,
            model: event.model.clone(),
            price: None,
            created_at: Utc::now(),
        };

        if let Some((per_in, per_out)) = repo.get_pricing(&event.model).await? {
            cost.price = Some(Price::compute(per_in, per_out, &cost));
        }

        let row = CompletionUsage {
            feature: event.feature,
            user: event.user,
            entity: event.entity,
            cost,
        };

        repo.insert_usage(&row).await
    }
}

impl<Repo> UsageRecorder for UsageServiceImpl<Repo>
where
    Repo: UsageRepo + Clone + 'static,
{
    fn record(&self, event: UsageEvent) {
        let repo = self.repo.clone();
        // Recording must never fail or delay the originating call.
        tokio::spawn(async move {
            if let Err(e) = Self::record_event(&repo, event).await {
                tracing::error!(error = ?e, "failed to record ai usage");
            }
        });
    }
}

impl<Repo> UsageService for UsageServiceImpl<Repo>
where
    Repo: UsageRepo + Clone + 'static,
{
    #[tracing::instrument(skip(self), err)]
    async fn get_usage(&self, params: UsageApiParams) -> Result<UsageSummary> {
        let rows = self.repo.query_usage(&params).await?;
        Ok(summarize(rows))
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_pricing(
        &self,
        model: String,
        price_per_million_in: f32,
        price_per_million_out: f32,
    ) -> Result<()> {
        self.repo
            .set_pricing(&model, price_per_million_in, price_per_million_out)
            .await
    }
}

/// Group recorded completions by feature and roll up dollar totals.
fn summarize(rows: Vec<CompletionUsage>) -> UsageSummary {
    let mut by_feature: BTreeMap<AiFeature, Vec<CompletionUsage>> = BTreeMap::new();
    for row in rows {
        by_feature.entry(row.feature).or_default().push(row);
    }

    let mut entries = Vec::with_capacity(by_feature.len());
    let mut grand_total = 0.0_f32;
    for (feature, completions) in by_feature {
        let total: f32 = completions
            .iter()
            .filter_map(|c| c.cost.price.as_ref().map(|p| p.total))
            .sum();
        grand_total += total;
        entries.push(FeatureUsage {
            feature,
            entries: completions,
            total,
        });
    }

    UsageSummary {
        entries,
        total: grand_total,
    }
}

#[cfg(test)]
mod test;
