use std::{future::pending, time::Duration};

use ai_usage::{AiFeature, UsageContext};
use tokio_util::sync::CancellationToken;

use super::*;
use crate::metrics::Batch;

/// Answers with what it is given, or never.
struct Answering(Option<Result<Vec<f32>, FocusClassifierError>>);

impl FocusClassifier for Answering {
    async fn answer(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &Value,
        _: &[&'static str],
        _: ClassifierLane,
    ) -> Result<Vec<f32>, FocusClassifierError> {
        match &self.0 {
            Some(answer) => answer.clone(),
            None => pending().await,
        }
    }

    fn model(&self) -> &'static str {
        "jev-latest"
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.example").unwrap()
}

async fn ask(answer: Option<Result<Vec<f32>, FocusClassifierError>>) -> Batch {
    ask_while(answer, FocusMetrics::default()).await
}

async fn ask_while(
    answer: Option<Result<Vec<f32>, FocusClassifierError>>,
    metrics: FocusMetrics,
) -> Batch {
    let classifier = MeteredClassifier::new(Answering(answer), metrics.clone());
    let owner = owner();
    let call = classifier.answer(&owner, Uuid::nil(), &Value::Null, &[], ClassifierLane::Live);
    // A caller giving up drops the call.
    tokio::time::timeout(Duration::from_secs(1), call)
        .await
        .ok();
    metrics.take()
}

#[tokio::test(start_paused = true)]
async fn every_call_counts_and_each_failure_by_its_kind() {
    let answered = ask(Some(Ok(vec![0.5]))).await;
    assert_eq!(answered.sums[&Metric::ClassifierCalls], 1.0);
    assert_eq!(answered.sums[&Metric::ClassifierUnavailable], 0.0);
    assert_eq!(answered.sums[&Metric::ClassifierRejected], 0.0);

    let down = ask(Some(Err(FocusClassifierError::Unavailable))).await;
    assert_eq!(down.sums[&Metric::ClassifierUnavailable], 1.0);
    let refused = ask(Some(Err(FocusClassifierError::Rejected))).await;
    assert_eq!(refused.sums[&Metric::ClassifierRejected], 1.0);
    assert_eq!(refused.sums[&Metric::ClassifierUnavailable], 0.0);

    let abandoned = ask(None).await;
    assert_eq!(abandoned.sums[&Metric::ClassifierCalls], 1.0);
    assert_eq!(abandoned.sums[&Metric::ClassifierUnavailable], 1.0);
}

#[tokio::test(start_paused = true)]
async fn a_call_dropped_because_the_worker_stops_is_no_failure() {
    let stopping = CancellationToken::new();
    stopping.cancel();
    let dropped = ask_while(None, FocusMetrics::new(stopping)).await;
    assert_eq!(dropped.sums[&Metric::ClassifierCalls], 1.0);
    assert_eq!(dropped.sums[&Metric::ClassifierUnavailable], 0.0);
}

#[derive(Default)]
struct Journal(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Journal {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[test]
fn jev_usage_counts_its_tokens_and_cost_and_is_still_recorded() {
    let journal = Arc::new(Journal::default());
    let metrics = FocusMetrics::default();
    let prices = Prices::fixed([(
        "jev-latest",
        ModelPricing::Tokens {
            input: 0.042,
            output: 0.0,
            cache_read: None,
            cache_write: None,
        },
    )]);
    let recorder = MeteredRecorder::new(journal.clone(), metrics.clone(), Arc::new(prices));
    let usage = UsageContext::new(AiFeature::EmailFocus, owner());
    for model in ["jev-latest", "unpriced"] {
        recorder.record(usage.clone().into_event(
            model.to_owned(),
            UsageAmount::Tokens {
                input: 1_000_000,
                output: 4,
                cache_read: 0,
                cache_write: 0,
            },
        ));
    }

    assert_eq!(journal.0.lock().unwrap().len(), 2);
    let batch = metrics.take();
    assert_eq!(batch.sums[&Metric::JevInputTokens], 2_000_000.0);
    assert_eq!(batch.sums[&Metric::JevOutputTokens], 8.0);
    let cost = batch.sums[&Metric::JevCostUsd];
    assert!(
        (cost - 0.042).abs() < 1e-6,
        "only the priced model costs: {cost}"
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_price_read_from_the_pricing_table_prices_later_costs(pool: sqlx::PgPool) {
    let prices = Arc::new(Prices::from_db(pool));
    let amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 0,
        cache_read: 0,
        cache_write: 0,
    };

    prices.load(crate::outbound::jev_classifier::MODEL).await;
    let cost = prices.cost(crate::outbound::jev_classifier::MODEL, amount);
    assert!(cost.is_some_and(|cost| cost > 0.0), "{cost:?}");

    // Read and found unpriced: remembered, so asking again reads nothing.
    prices.load("no-such-model").await;
    assert_eq!(prices.cost("no-such-model", amount), None);
}
