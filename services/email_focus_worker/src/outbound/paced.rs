//! The classifier and Jev's usage recorder, paced by the worker's
//! [`TokenBudget`]: what TypeSafe bills is taken out of it, backfills and
//! sweeps wait on it, and TypeSafe pushing back slows it down.

use std::sync::Arc;

use ai_usage::{UsageEvent, UsageRecorder, UsageTracking};
use email::domain::focus::{ClassifierLane, FocusClassifier, FocusClassifierError};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use tracing::{Instrument as _, field::Empty};
use uuid::Uuid;

use crate::{
    metrics::{FocusMetrics, Metric},
    outbound::{metered::token_counts, token_budget::TokenBudget},
};

#[cfg(test)]
mod test;

/// Requests behind a call TypeSafe pushed back on: Jev tries each call three
/// times before it gives up.
const ATTEMPTS_WHEN_UNAVAILABLE: u8 = 3;

/// The classifier, with background calls waiting on the budget and every
/// failed call taken out of it.
pub struct PacedClassifier<C> {
    inner: C,
    budget: Arc<TokenBudget>,
    metrics: FocusMetrics,
}

impl<C> PacedClassifier<C> {
    pub fn new(inner: C, budget: Arc<TokenBudget>, metrics: FocusMetrics) -> Self {
        Self {
            inner,
            budget,
            metrics,
        }
    }
}

impl<C: FocusClassifier> FocusClassifier for PacedClassifier<C> {
    async fn answer(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        input: &Value,
        questions: &[&'static str],
        lane: ClassifierLane,
    ) -> Result<Vec<f32>, FocusClassifierError> {
        let reservation = match lane {
            ClassifierLane::Live => None,
            ClassifierLane::Background => {
                let span = tracing::info_span!(
                    "email_focus.classifier_budget",
                    waited_ms = Empty,
                    tokens_per_second = Empty,
                );
                let (reservation, waited) = self.budget.reserve().instrument(span.clone()).await;
                span.record("waited_ms", waited.as_millis());
                span.record("tokens_per_second", self.budget.rate());
                self.metrics
                    .observe(Metric::ClassifierBudgetWaitSeconds, waited.as_secs_f64());
                Some(reservation)
            }
        };
        let answer = self
            .inner
            .answer(owner, thread_id, input, questions, lane)
            .await;
        match &answer {
            // Spent through the recorder, at what TypeSafe billed.
            Ok(_) => {}
            Err(FocusClassifierError::Unavailable) => {
                self.budget.spend_requests(ATTEMPTS_WHEN_UNAVAILABLE);
                if self.budget.slow_down() {
                    self.metrics.add(Metric::ClassifierSlowDowns, 1.0);
                    tracing::warn!(
                        tokens_per_second = self.budget.rate(),
                        "TypeSafe pushed back; focus classification slowed down"
                    );
                }
            }
            // A refusal reports no usage, but TypeSafe still counted it.
            Err(FocusClassifierError::Rejected) => self.budget.spend_requests(1),
        }
        drop(reservation);
        answer
    }

    fn model(&self) -> &'static str {
        self.inner.model()
    }
}

/// Jev's usage recorder, taking what each call cost out of the budget.
pub struct SpendingRecorder {
    inner: Arc<dyn UsageRecorder>,
    budget: Arc<TokenBudget>,
}

impl SpendingRecorder {
    pub fn new(inner: Arc<dyn UsageRecorder>, budget: Arc<TokenBudget>) -> Self {
        Self { inner, budget }
    }
}

impl UsageRecorder for SpendingRecorder {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        self.inner.tracking()
    }

    fn record(&self, event: UsageEvent) {
        match token_counts(event.amount) {
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "token counts are whole and far below 2^52"
            )]
            Some((input, output)) => self.budget.spend((input + output) as u64),
            None => self.budget.spend_requests(1),
        }
        self.inner.record(event);
    }
}
