//! The cost service: resolves pricing, records usage, and answers queries.

use std::collections::BTreeMap;

use chrono::Utc;

use super::ports::*;

/// The existing Macro-admin policy for usage reporting and price changes.
fn require_admin(actor: &macro_user_id::user_id::MacroUserIdStr<'_>) -> Result<()> {
    if actor.email_str().ends_with("@macro.com") {
        Ok(())
    } else {
        Err(UsageError::Forbidden)
    }
}

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
    #[tracing::instrument(name = "ai_usage.record", skip_all, err, fields(
        feature = %event.feature,
        model = %event.model,
        user_id = %event.user,
        usage = ?event.amount,
        usage.cost_usd = tracing::field::Empty,
        usage.priced = tracing::field::Empty,
    ))]
    async fn record_event(repo: &Repo, event: UsageEvent) -> Result<()> {
        let mut cost = Usage {
            amount: event.amount,
            model: event.model.clone(),
            price: None,
            created_at: Utc::now(),
        };

        if let Some(pricing) = repo.get_pricing(&event.model).await? {
            cost.price = Price::compute(pricing, cost.amount);
        }
        let span = tracing::Span::current();
        span.record("usage.priced", cost.price.is_some());
        if let Some(price) = cost.price {
            span.record("usage.cost_usd", price.total);
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
        tokio::spawn(tracing::Instrument::in_current_span(async move {
            if let Err(e) = Self::record_event(&repo, event).await {
                tracing::error!(error = ?e, "failed to record ai usage");
            }
        }));
    }
}

impl<Repo> UsageService for UsageServiceImpl<Repo>
where
    Repo: UsageRepo + Clone + 'static,
{
    #[tracing::instrument(skip(self), err)]
    async fn get_usage(
        &self,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        params: UsageApiParams,
    ) -> Result<UsageSummary> {
        require_admin(&actor)?;
        let rows = self.repo.query_usage(&params).await?;
        Ok(summarize(rows))
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_pricing(
        &self,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        model: String,
        pricing: ModelPricing,
    ) -> Result<()> {
        require_admin(&actor)?;
        let pricing = pricing.validate()?;
        self.repo.set_pricing(&model, pricing).await
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
