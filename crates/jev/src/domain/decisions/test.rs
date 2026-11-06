use super::*;
use crate::domain::{Evaluation, JevClassifier, JevProvider, Probability, YesNoQuestion};
use ai_billing::{DenyReason, domain::admission::AdmissionFuture};
use ai_usage::{UsageAmount, UsageEvent, UsageRecorder};
use serde_json::{Value, json};
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|decisions@example.com".to_owned()).unwrap()
}

fn request() -> DecisionRequest {
    serde_json::from_value(json!({
        "input": {"subject": "Invoice"},
        "questions": {"urgent": "Is this urgent?", "billing": "Is this about billing?"}
    }))
    .unwrap()
}

struct Admission {
    result: Result<(), AiAdmissionError>,
    calls: AtomicUsize,
}

impl Admission {
    fn new(result: Result<(), AiAdmissionError>) -> Arc<Self> {
        Arc::new(Self {
            result,
            calls: AtomicUsize::new(0),
        })
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(user, &owner());
            assert_eq!(feature, AiFeature::DynamicCompletionsApi);
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result
        })
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[derive(Default)]
struct State {
    calls: AtomicUsize,
    started: tokio::sync::Notify,
    finish: tokio::sync::Notify,
}

struct Provider {
    state: Arc<State>,
    wait: bool,
    invalid: bool,
}

impl JevProvider for Provider {
    fn model_id(&self) -> &'static str {
        "jev-test"
    }

    async fn evaluate(
        &self,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Evaluation, JevError> {
        assert_eq!(input["subject"], "Invoice");
        assert_eq!(questions[0].as_str(), "Is this about billing?");
        self.state.calls.fetch_add(1, Ordering::SeqCst);
        self.state.started.notify_one();
        if self.wait {
            self.state.finish.notified().await;
        }
        Ok(Evaluation {
            probabilities: if self.invalid {
                vec![]
            } else {
                vec![
                    Probability::new(0.9).unwrap(),
                    Probability::new(0.1).unwrap(),
                ]
            },
            input_tokens: 10,
            output_tokens: 2,
        })
    }
}

fn service(
    state: Arc<State>,
    recorder: Arc<Recorder>,
    admission: Arc<Admission>,
    wait: bool,
    invalid: bool,
) -> DecisionServiceImpl<JevClassifier<Provider>> {
    DecisionServiceImpl::new(
        Some(JevClassifier::new(
            Provider {
                state,
                wait,
                invalid,
            },
            recorder,
        )),
        admission,
    )
}

#[tokio::test]
async fn named_results_preserve_keys_and_meter_the_exact_owner_and_feature() {
    for invalid in [false, true] {
        let recorder = Arc::new(Recorder::default());
        let admission = Admission::new(Ok(()));
        let service = service(
            Arc::default(),
            recorder.clone(),
            admission.clone(),
            false,
            invalid,
        );
        let result = service.decide(owner(), request()).await;
        if invalid {
            assert!(matches!(
                result,
                Err(DecisionError::Provider(JevError::InvalidResponse))
            ));
        } else {
            assert_eq!(
                result.unwrap().probabilities,
                [("billing".into(), 0.9), ("urgent".into(), 0.1)].into()
            );
        }
        assert_eq!(admission.calls.load(Ordering::SeqCst), 1);
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].user, owner());
        assert_eq!(events[0].feature, AiFeature::DynamicCompletionsApi);
        assert_eq!(
            events[0].amount,
            UsageAmount::Tokens {
                input: 10,
                output: 2,
                cache_read: 0,
                cache_write: 0
            }
        );
    }
}

#[tokio::test]
async fn admission_failures_never_start_provider_work() {
    let state = Arc::new(State::default());
    let recorder = Arc::new(Recorder::default());
    for error in [
        AiAdmissionError::Unavailable,
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Denied(DenyReason::OverageLimitReached),
        AiAdmissionError::Denied(DenyReason::OveragePaymentFailed),
    ] {
        let admission = Admission::new(Err(error));
        let service = service(
            state.clone(),
            recorder.clone(),
            admission.clone(),
            false,
            false,
        );
        assert!(
            matches!(service.decide(owner(), request()).await, Err(DecisionError::Admission(found)) if found == error)
        );
        assert_eq!(admission.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            service.completions.available_permits(),
            MAX_CONCURRENT_DECISIONS
        );
    }
    assert_eq!(state.calls.load(Ordering::SeqCst), 0);
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_requests_are_rejected_before_admission() {
    let admission = Admission::new(Ok(()));
    let state = Arc::new(State::default());
    let service = service(
        state.clone(),
        Arc::default(),
        admission.clone(),
        false,
        false,
    );
    for invalid in [
        json!({"input": null, "questions": {}}),
        json!({"input": null, "questions": {"a": " "}}),
        json!({"input": null, "questions": {" ": "Valid?"}}),
        json!({"input": "x".repeat(65536), "questions": {"a": "Valid?"}}),
    ] {
        assert!(matches!(
            service
                .decide(owner(), serde_json::from_value(invalid).unwrap())
                .await,
            Err(DecisionError::InvalidRequest(_))
        ));
    }
    assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
    assert_eq!(state.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unconfigured_service_does_not_start_admission_or_provider_work() {
    let admission = Admission::new(Ok(()));
    let service = DecisionServiceImpl::<JevClassifier<Provider>>::new(None, admission.clone());
    assert!(matches!(
        service.decide(owner(), request()).await,
        Err(DecisionError::Unavailable)
    ));
    assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn canceling_the_caller_keeps_admitted_work_metered_and_capacity_reserved() {
    let state = Arc::new(State::default());
    let recorder = Arc::new(Recorder::default());
    let admission = Admission::new(Ok(()));
    let service = Arc::new(service(
        state.clone(),
        recorder.clone(),
        admission.clone(),
        true,
        false,
    ));
    let caller = tokio::spawn({
        let service = service.clone();
        async move { service.decide(owner(), request()).await }
    });
    state.started.notified().await;
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_DECISIONS - 1
    );

    let other_permits = service
        .completions
        .clone()
        .try_acquire_many_owned(15)
        .unwrap();
    assert!(matches!(
        service.decide(owner(), request()).await,
        Err(DecisionError::Busy)
    ));
    assert_eq!(admission.calls.load(Ordering::SeqCst), 1);
    state.finish.notify_one();
    let last_permit = service.completions.acquire().await.unwrap();
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
    assert_eq!(recorder.0.lock().unwrap()[0].user, owner());
    drop(last_permit);
    drop(other_permits);
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_DECISIONS
    );
}

#[tokio::test(start_paused = true)]
async fn a_stalled_provider_releases_capacity_at_the_deadline() {
    let state = Arc::new(State::default());
    let recorder = Arc::new(Recorder::default());
    let service = service(
        state.clone(),
        recorder.clone(),
        Admission::new(Ok(())),
        true,
        false,
    );
    let started = Instant::now();
    assert!(matches!(
        service.decide(owner(), request()).await,
        Err(DecisionError::Timeout)
    ));
    assert_eq!(Instant::now() - started, DECISION_TIMEOUT);
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_DECISIONS
    );
    assert_eq!(state.calls.load(Ordering::SeqCst), 1);
    assert!(recorder.0.lock().unwrap().is_empty());
}

struct StalledAdmission;

impl AiAdmissionService for StalledAdmission {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, _: AiFeature) -> AdmissionFuture<'a> {
        Box::pin(std::future::pending())
    }
}

#[tokio::test(start_paused = true)]
async fn the_deadline_also_bounds_admission() {
    let state = Arc::new(State::default());
    let classifier = JevClassifier::new(
        Provider {
            state: state.clone(),
            wait: false,
            invalid: false,
        },
        Arc::new(Recorder::default()),
    );
    let service = DecisionServiceImpl::new(Some(classifier), Arc::new(StalledAdmission));
    assert!(matches!(
        service.decide(owner(), request()).await,
        Err(DecisionError::Timeout)
    ));
    assert_eq!(state.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_DECISIONS
    );
}
