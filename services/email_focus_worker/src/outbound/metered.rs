//! The Focus service's ports, counted for the rollout's numbers: each wraps the
//! real adapter, records into [`FocusMetrics`] and changes nothing else.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use ai_usage::{
    ModelPricing, Price, UsageAmount, UsageEvent, UsageRecorder, UsageRepo as _, UsageTracking,
    normalize_model_id, outbound::PgUsageRepo,
};
use chrono::{DateTime, Utc};
use email::domain::focus::{
    FocusClassifier, FocusClassifierError, FocusInbox, FocusInboxOwner, FocusMail, FocusRecord,
    FocusStore, StaleThread, ThreadFocus,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use tokio::time::Instant;
use uuid::Uuid;

use crate::metrics::{FocusMetrics, Metric};

#[cfg(test)]
mod test;

/// Counts `metric` once when dropped, unless disarmed: a call its caller gave
/// up on (a timeout dropping it) still counts as failed.
pub struct UnlessDone<'a> {
    metrics: &'a FocusMetrics,
    metric: Option<Metric>,
}

impl<'a> UnlessDone<'a> {
    pub fn new(metrics: &'a FocusMetrics, metric: Metric) -> Self {
        Self {
            metrics,
            metric: Some(metric),
        }
    }

    /// Count `metric` instead, or nothing for `None`.
    pub fn finish(mut self, metric: Option<Metric>) {
        self.metric = metric;
    }
}

impl Drop for UnlessDone<'_> {
    fn drop(&mut self) {
        if let Some(metric) = self.metric {
            self.metrics.add(metric, 1.0);
        }
    }
}

/// Model prices from the usage journal's pricing table, read once per model:
/// a changed price is picked up when the worker restarts.
pub struct Prices {
    repo: Option<PgUsageRepo>,
    known: Mutex<HashMap<String, Option<ModelPricing>>>,
}

impl Prices {
    pub fn from_db(pool: sqlx::PgPool) -> Self {
        Self {
            repo: Some(PgUsageRepo::new(pool)),
            known: Mutex::default(),
        }
    }

    /// Prices for the models given and no others.
    #[cfg(test)]
    pub fn fixed(prices: impl IntoIterator<Item = (&'static str, ModelPricing)>) -> Self {
        Self {
            repo: None,
            known: Mutex::new(
                prices
                    .into_iter()
                    .map(|(model, pricing)| (model.to_owned(), Some(pricing)))
                    .collect(),
            ),
        }
    }

    fn known(&self, model: &str) -> Option<Option<ModelPricing>> {
        self.known
            .lock()
            .ok()
            .and_then(|known| known.get(normalize_model_id(model)).copied())
    }

    /// Read `model`'s price, once. A model with no stored price is remembered
    /// as unpriced; a failed read is tried again next time.
    pub async fn load(&self, model: &str) -> Option<ModelPricing> {
        if let Some(pricing) = self.known(model) {
            return pricing;
        }
        let model = normalize_model_id(model);
        let repo = self.repo.as_ref()?;
        match repo.get_pricing(model).await {
            Ok(pricing) => {
                if pricing.is_none() {
                    tracing::warn!(model, "no stored price; its focus cost is not counted");
                }
                if let Ok(mut known) = self.known.lock() {
                    known.insert(model.to_owned(), pricing);
                }
                pricing
            }
            Err(error) => {
                tracing::warn!(error = ?error, model, "reading a model price failed");
                None
            }
        }
    }

    /// What `amount` of `model` cost, from prices already read.
    pub fn cost(&self, model: &str, amount: UsageAmount) -> Option<f64> {
        let pricing = self.known(model).flatten()?;
        Price::compute(pricing, amount).map(|price| f64::from(price.total))
    }
}

/// Tokens as the metrics count them: input includes cached tokens.
#[expect(
    clippy::cast_precision_loss,
    reason = "token counts are far below 2^52"
)]
pub fn token_counts(amount: UsageAmount) -> Option<(f64, f64)> {
    match amount {
        UsageAmount::Tokens {
            input,
            output,
            cache_read,
            cache_write,
        } => Some(((input + cache_read + cache_write) as f64, output as f64)),
        _ => None,
    }
}

/// The classifier, with each call and its failures counted.
pub struct MeteredClassifier<C> {
    inner: C,
    metrics: FocusMetrics,
}

impl<C> MeteredClassifier<C> {
    pub fn new(inner: C, metrics: FocusMetrics) -> Self {
        Self { inner, metrics }
    }
}

impl<C: FocusClassifier> FocusClassifier for MeteredClassifier<C> {
    async fn answer(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &Value,
        questions: &[&'static str],
    ) -> Result<Vec<f32>, FocusClassifierError> {
        self.metrics.add(Metric::ClassifierCalls, 1.0);
        let outcome = UnlessDone::new(&self.metrics, Metric::ClassifierUnavailable);
        let answer = self.inner.answer(owner, thread_id, input, questions).await;
        outcome.finish(match &answer {
            Ok(_) => None,
            Err(FocusClassifierError::Unavailable) => Some(Metric::ClassifierUnavailable),
            Err(FocusClassifierError::Rejected) => Some(Metric::ClassifierRejected),
        });
        answer
    }

    fn model(&self) -> &'static str {
        self.inner.model()
    }
}

/// Jev's usage recorder, with its tokens and their cost counted too.
pub struct MeteredRecorder {
    inner: Arc<dyn UsageRecorder>,
    metrics: FocusMetrics,
    prices: Arc<Prices>,
}

impl MeteredRecorder {
    pub fn new(inner: Arc<dyn UsageRecorder>, metrics: FocusMetrics, prices: Arc<Prices>) -> Self {
        Self {
            inner,
            metrics,
            prices,
        }
    }
}

impl UsageRecorder for MeteredRecorder {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        self.inner.tracking()
    }

    fn record(&self, event: UsageEvent) {
        if let Some((input, output)) = token_counts(event.amount) {
            self.metrics.add(Metric::JevInputTokens, input);
            self.metrics.add(Metric::JevOutputTokens, output);
        }
        if let Some(cost) = self.prices.cost(&event.model, event.amount) {
            self.metrics.add(Metric::JevCostUsd, cost);
        }
        self.inner.record(event);
    }
}

/// The store, with the stale-thread read timed: the read every sweep and
/// backfill page makes, and the one a large inbox makes slow.
pub struct TimedStore<S> {
    inner: S,
    metrics: FocusMetrics,
}

impl<S> TimedStore<S> {
    pub fn new(inner: S, metrics: FocusMetrics) -> Self {
        Self { inner, metrics }
    }
}

impl<S: FocusStore> FocusStore for TimedStore<S> {
    async fn thread_inbox(&self, thread_id: Uuid) -> Result<Option<FocusInbox>, Report> {
        self.inner.thread_inbox(thread_id).await
    }

    async fn thread_mail(&self, inbox: &FocusInbox) -> Result<FocusMail, Report> {
        self.inner.thread_mail(inbox).await
    }

    async fn save(&self, record: &FocusRecord) -> Result<bool, Report> {
        self.inner.save(record).await
    }

    async fn stale_threads(
        &self,
        link_id: Uuid,
        since: DateTime<Utc>,
        after: Option<StaleThread>,
        limit: i64,
    ) -> Result<Vec<StaleThread>, Report> {
        let started = Instant::now();
        let threads = self.inner.stale_threads(link_id, since, after, limit).await;
        if threads.is_ok() {
            self.metrics
                .observe(Metric::StaleThreadsSeconds, started.elapsed().as_secs_f64());
        }
        threads
    }

    async fn inboxes_with_focus(&self) -> Result<Vec<FocusInboxOwner>, Report> {
        self.inner.inboxes_with_focus().await
    }

    async fn syncing_inboxes(&self) -> Result<Vec<FocusInboxOwner>, Report> {
        self.inner.syncing_inboxes().await
    }

    async fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Uuid>, Report> {
        self.inner
            .focus_thread_ids(owner, since, waiting_before, now, limit)
            .await
    }

    async fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        self.inner
            .focus_for_threads(owner, thread_ids, waiting_before, now)
            .await
    }
}
