use std::{future::pending, time::Duration};

use ai_usage::{AiFeature, UsageContext};

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
    let metrics = FocusMetrics::default();
    let classifier = MeteredClassifier::new(Answering(answer), metrics.clone());
    let owner = owner();
    let call = classifier.answer(&owner, Uuid::nil(), &Value::Null, &[]);
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
    assert_eq!(answered.sums.len(), 1);

    let down = ask(Some(Err(FocusClassifierError::Unavailable))).await;
    assert_eq!(down.sums[&Metric::ClassifierUnavailable], 1.0);
    let refused = ask(Some(Err(FocusClassifierError::Rejected))).await;
    assert_eq!(refused.sums[&Metric::ClassifierRejected], 1.0);
    assert!(!refused.sums.contains_key(&Metric::ClassifierUnavailable));

    let abandoned = ask(None).await;
    assert_eq!(abandoned.sums[&Metric::ClassifierCalls], 1.0);
    assert_eq!(abandoned.sums[&Metric::ClassifierUnavailable], 1.0);
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
