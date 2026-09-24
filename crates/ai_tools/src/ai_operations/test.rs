use super::*;
use ai_billing::domain::{AiAdmissionError, DenyReason};
use ai_usage::AiFeature;
use std::sync::Mutex;

struct Admission {
    result: Mutex<Option<Result<(), AiAdmissionError>>>,
    calls: Mutex<Vec<(MacroUserIdStr<'static>, AiFeature)>>,
}

impl Admission {
    fn new(result: Result<(), AiAdmissionError>) -> Self {
        Self {
            result: Mutex::new(Some(result)),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        use macro_user_id::cowlike::CowLike;
        self.calls
            .lock()
            .unwrap()
            .push((user.clone().into_owned(), feature));
        Box::pin(async { self.result.lock().unwrap().take().unwrap() })
    }
}

#[tokio::test]
async fn blocked_operations_never_start_completion_or_record_usage() {
    for failure in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable(rootcause::report!("private database failure")),
    ] {
        let admission = Admission::new(Err(failure));
        let error = run_subagent_with(
            &admission,
            MacroUserIdStr::try_from_email("user@macro.com").unwrap(),
            &UsageContext::system(AiFeature::Chat),
            &CancellationToken::new(),
            |_| async { panic!("completion and its recorder must not run") },
        )
        .await
        .unwrap_err();
        assert!(error.downcast_ref::<AiAdmissionError>().is_some());
        assert_eq!(admission.calls.lock().unwrap().len(), 1);
        assert_eq!(
            admission.calls.lock().unwrap()[0].0,
            MacroUserIdStr::try_from_email("user@macro.com").unwrap()
        );
    }
}

#[tokio::test]
async fn production_completion_fails_closed_without_recording() {
    let recorder = Recorder::default();
    let error = complete_subagent(
        &ai_billing::domain::UnconfiguredAiAdmissionService,
        &recorder,
        &UsageContext::system(AiFeature::Chat),
        MacroUserIdStr::try_from_email("user@macro.com").unwrap(),
        "must not reach the model",
        &CancellationToken::new(),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<AiAdmissionError>(),
        Some(AiAdmissionError::Unavailable(_))
    ));
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[derive(Default)]
struct Recorder(Mutex<Vec<ai_usage::UsageEvent>>);

impl UsageRecorder for Recorder {
    fn record(&self, event: ai_usage::UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn admission_and_usage_use_authenticated_user_not_parent_system_identity() {
    let admission = Admission::new(Ok(()));
    let recorder = Recorder::default();
    let user = MacroUserIdStr::try_from_email("authenticated@macro.com").unwrap();
    let parent = UsageContext::system(AiFeature::Chat).with_entity(Some(uuid::Uuid::now_v7()));
    let result = run_subagent_with(
        &admission,
        user.clone(),
        &parent,
        &CancellationToken::new(),
        |usage| {
            assert_eq!(usage.user, user);
            assert_ne!(usage.user, parent.user);
            assert_eq!(usage.feature, parent.feature);
            assert_eq!(usage.entity, parent.entity);
            recorder.record(usage.into_event("test-model".to_owned(), 10, 5));
            async { Ok("completed".to_owned()) }
        },
    )
    .await
    .unwrap();
    assert_eq!(result, "completed");
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user, user);
    assert_eq!(events[0].feature, parent.feature);
    assert_eq!(events[0].entity, parent.entity);
    assert_eq!(
        *admission.calls.lock().unwrap(),
        vec![(user, parent.feature)]
    );
}

#[tokio::test]
async fn already_cancelled_operations_do_not_admit_or_complete() {
    let admission = Admission::new(Ok(()));
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = run_subagent_with(
        &admission,
        MacroUserIdStr::try_from_email("user@macro.com").unwrap(),
        &UsageContext::system(AiFeature::Chat),
        &cancel,
        |_| async { panic!("cancelled completion must not start") },
    )
    .await
    .unwrap();
    assert_eq!(result, "cancelled");
    assert!(admission.calls.lock().unwrap().is_empty());
}

struct PendingAdmission(CancellationToken);

impl AiAdmissionService for PendingAdmission {
    fn admit<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'_>,
        _feature: AiFeature,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async {
            self.0.cancel();
            std::future::pending().await
        })
    }
}

#[tokio::test]
async fn cancellation_interrupts_pending_billing_without_starting_completion() {
    let cancel = CancellationToken::new();
    let result = run_subagent_with(
        &PendingAdmission(cancel.clone()),
        MacroUserIdStr::try_from_email("user@macro.com").unwrap(),
        &UsageContext::system(AiFeature::Chat),
        &cancel,
        |_| async { panic!("completion must wait for admission") },
    )
    .await
    .unwrap();
    assert_eq!(result, "cancelled");
}

#[tokio::test]
async fn cancellation_still_interrupts_admitted_completion() {
    let admission = Admission::new(Ok(()));
    let cancel = CancellationToken::new();
    let result = run_subagent_with(
        &admission,
        MacroUserIdStr::try_from_email("user@macro.com").unwrap(),
        &UsageContext::system(AiFeature::Chat),
        &cancel,
        |_| async {
            cancel.cancel();
            std::future::pending().await
        },
    )
    .await
    .unwrap();
    assert_eq!(result, "cancelled");
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
}
