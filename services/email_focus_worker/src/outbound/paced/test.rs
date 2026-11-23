use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use ai_usage::{AiFeature, UsageAmount, UsageContext};
use tokio::time::Instant;

use super::*;
use crate::outbound::token_budget::{COOL_DOWN, Rates, TOKENS_PER_SECOND};

/// Answers with what it is given, after billing `tokens` to `recorder` when
/// it answers.
struct Answering {
    answer: Result<Vec<f32>, FocusClassifierError>,
    recorder: Arc<SpendingRecorder>,
    tokens: u64,
    lanes: Mutex<Vec<ClassifierLane>>,
}

impl FocusClassifier for Answering {
    async fn answer(
        &self,
        owner: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &Value,
        _: &[&'static str],
        lane: ClassifierLane,
    ) -> Result<Vec<f32>, FocusClassifierError> {
        self.lanes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(lane);
        if self.answer.is_ok() {
            self.recorder.record(
                UsageContext::new(AiFeature::EmailFocus, owner.clone()).into_event(
                    "jev-latest".to_owned(),
                    UsageAmount::Tokens {
                        input: self.tokens,
                        output: 0,
                        cache_read: 0,
                        cache_write: 0,
                    },
                ),
            );
        }
        self.answer.clone()
    }

    fn model(&self) -> &'static str {
        "jev-latest"
    }
}

/// Records nothing.
struct Nowhere;

impl UsageRecorder for Nowhere {
    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        None
    }

    fn record(&self, _: UsageEvent) {}
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.example").unwrap()
}

struct Paced {
    classifier: PacedClassifier<Answering>,
    budget: Arc<TokenBudget>,
    metrics: FocusMetrics,
}

fn paced(answer: Result<Vec<f32>, FocusClassifierError>, tokens: u64) -> Paced {
    let budget = Arc::new(TokenBudget::new(Rates::default()));
    let metrics = FocusMetrics::default();
    let recorder = Arc::new(SpendingRecorder::new(
        Arc::new(Nowhere),
        Arc::clone(&budget),
    ));
    Paced {
        classifier: PacedClassifier::new(
            Answering {
                answer,
                recorder,
                tokens,
                lanes: Mutex::default(),
            },
            Arc::clone(&budget),
            metrics.clone(),
        ),
        budget,
        metrics,
    }
}

impl Paced {
    async fn ask(&self, lane: ClassifierLane) -> Result<Vec<f32>, FocusClassifierError> {
        self.classifier
            .answer(&owner(), Uuid::nil(), &Value::Null, &[], lane)
            .await
    }
}

#[tokio::test(start_paused = true)]
async fn background_calls_keep_to_the_budget_and_live_calls_go_at_once() {
    let paced = paced(Ok(vec![0.5]), 20_000);
    let started = Instant::now();
    // Live mail takes three seconds' worth of the budget without waiting.
    for _ in 0..9 {
        paced.ask(ClassifierLane::Live).await.unwrap();
    }
    assert_eq!(started.elapsed(), Duration::ZERO);
    // A backfill call then waits until that is paid back.
    paced.ask(ClassifierLane::Background).await.unwrap();
    let waited = started.elapsed();
    assert!(waited >= Duration::from_secs(2), "waited only {waited:?}");
    // The inner classifier still learns the lane each call came in on.
    let lanes = paced.classifier.inner.lanes.lock().unwrap().clone();
    assert_eq!(lanes.last(), Some(&ClassifierLane::Background));
    assert_eq!(lanes.first(), Some(&ClassifierLane::Live));
    let batch = paced.metrics.take();
    let waits = &batch.samples[&Metric::ClassifierBudgetWaitSeconds];
    assert_eq!(waits.len(), 1, "only background calls wait");
    assert!(waits[0] >= 2.0);
}

#[tokio::test(start_paused = true)]
async fn ten_minutes_of_backfill_bill_no_more_than_the_budget() {
    let paced = Arc::new(paced(Ok(vec![0.5]), 8_500));
    let calls = Arc::new(Mutex::new(0_u32));
    let started = Instant::now();
    let deadline = started + Duration::from_secs(600);
    let mut tasks = tokio::task::JoinSet::new();
    // As many calls at once as a backfill makes.
    for _ in 0..16 {
        let paced = Arc::clone(&paced);
        let calls = Arc::clone(&calls);
        tasks.spawn(async move {
            while Instant::now() < deadline {
                paced.ask(ClassifierLane::Background).await.unwrap();
                tokio::time::sleep(Duration::from_millis(400)).await;
                *calls.lock().unwrap() += 1;
            }
        });
    }
    tasks.join_all().await;
    let billed = f64::from(*calls.lock().unwrap()) * 8_500.0;
    // Half a second's worth on hand at the start, then the rate, for as long as
    // the calls went on: those that waited past the ten minutes too.
    let allowed = TOKENS_PER_SECOND * (started.elapsed().as_secs_f64() + 0.5);
    assert!(billed <= allowed, "billed {billed} of {allowed}");
    assert!(
        billed >= allowed * 0.95,
        "billed only {billed} of {allowed}"
    );
}

#[tokio::test(start_paused = true)]
async fn typesafe_pushing_back_slows_every_call_down_once() {
    let paced = paced(Err(FocusClassifierError::Unavailable), 0);
    // A backfill's calls all hit the same rate limit.
    for _ in 0..4 {
        let answer = paced.ask(ClassifierLane::Background).await;
        assert_eq!(answer, Err(FocusClassifierError::Unavailable));
    }
    assert_eq!(paced.budget.rate(), TOKENS_PER_SECOND / 2.0);
    let batch = paced.metrics.take();
    assert_eq!(batch.sums[&Metric::ClassifierSlowDowns], 1.0);

    // A live call pushed back after the cool-down slows it again.
    tokio::time::advance(COOL_DOWN).await;
    let answer = paced.ask(ClassifierLane::Live).await;
    assert_eq!(answer, Err(FocusClassifierError::Unavailable));
    assert_eq!(paced.budget.rate(), 18_000.0);
}

#[tokio::test(start_paused = true)]
async fn refused_and_pushed_back_calls_still_count_as_requests() {
    let refused = paced(Err(FocusClassifierError::Rejected), 0);
    let started = Instant::now();
    // 48 refusals a second empty the budget: 1,250 tokens a request.
    for _ in 0..48 {
        refused.ask(ClassifierLane::Live).await.ok();
    }
    refused.ask(ClassifierLane::Background).await.ok();
    assert!(
        started.elapsed() >= Duration::from_millis(100),
        "a backfill call went through with the requests already spent"
    );
}

#[tokio::test(start_paused = true)]
async fn a_pushed_back_backfill_call_keeps_its_share() {
    let paced = paced(Err(FocusClassifierError::Unavailable), 0);
    paced.ask(ClassifierLane::Background).await.ok();
    // The next backfill call waits for the first call's estimate to refill
    // at the halved rate rather than taking it back at once.
    let started = Instant::now();
    paced.ask(ClassifierLane::Background).await.ok();
    assert!(
        started.elapsed() >= Duration::from_millis(600),
        "the next call waited only {:?}",
        started.elapsed()
    );
}
