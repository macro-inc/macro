use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use ai_billing::domain::{AiAdmissionError, DenyReason, UnconfiguredAiAdmissionService};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::*;
use crate::testing::{HangingEngine, ScriptedEngine, TEST_MODELS};

#[derive(Default)]
pub(crate) struct Admission {
    pub(crate) exhausted: AtomicBool,
    pub(crate) calls: Mutex<Vec<(String, AiFeature)>>,
    pub(crate) denial: Option<DenyReason>,
    pub(crate) pending: bool,
    pub(crate) started: Notify,
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((user.to_string(), feature));
            self.started.notify_one();
            if self.pending {
                std::future::pending::<()>().await;
            }
            if let Some(reason) = self.denial {
                return Err(AiAdmissionError::Denied(reason));
            }
            if self.exhausted.load(Ordering::SeqCst) {
                return Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted));
            }
            Ok(())
        })
    }
}

fn request() -> TurnRequest {
    TurnRequest {
        owner: Owner::User(MacroUserIdStr::try_from_email("owner@macro.com").unwrap()),
        model: "test-model".into(),
        identity: None,
        instructions: Some("session instructions".into()),
        messages: Vec::new(),
        mcp_tools: None,
        cancel: CancellationToken::new(),
        user_input: None,
        reviewer: None,
    }
}

#[tokio::test]
async fn direct_denied_turns_return_only_a_typed_terminal_error() {
    for reason in [
        DenyReason::AllowanceExhausted,
        DenyReason::OverageLimitReached,
        DenyReason::OveragePaymentFailed,
    ] {
        let inner = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
            "forbidden".into(),
        )]));
        let admission = Arc::new(Admission {
            denial: Some(reason),
            ..Default::default()
        });
        let engine = AdmissionCheckingTurnEngine::new(inner.clone(), admission.clone());
        let mut parts = engine.run_turn(request());
        let AgentError::Other(error) = parts.recv().await.unwrap().unwrap_err() else {
            panic!("expected typed admission error");
        };
        assert!(
            matches!(error.downcast_ref::<AiAdmissionError>(), Some(AiAdmissionError::Denied(actual)) if *actual == reason)
        );
        assert!(parts.recv().await.is_none());
        assert!(inner.requests().is_empty());
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![("macro|owner@macro.com".into(), AiFeature::AgentSession)]
        );
    }
}

#[tokio::test]
async fn direct_unavailable_turn_never_invokes_the_engine() {
    let inner = Arc::new(ScriptedEngine::new(vec![]));
    let engine =
        AdmissionCheckingTurnEngine::new(inner.clone(), Arc::new(UnconfiguredAiAdmissionService));
    let mut parts = engine.run_turn(request());
    let AgentError::Other(error) = parts.recv().await.unwrap().unwrap_err() else {
        panic!("expected typed admission error");
    };
    assert!(matches!(
        error.downcast_ref::<AiAdmissionError>(),
        Some(AiAdmissionError::Unavailable(_))
    ));
    assert!(parts.recv().await.is_none());
    assert!(inner.requests().is_empty());
}

#[tokio::test]
async fn direct_allowed_turn_preserves_the_request_and_stream() {
    let inner = Arc::new(ScriptedEngine::new(vec![StreamPart::Content(
        "answer".into(),
    )]));
    let admission = Arc::new(Admission::default());
    let engine = AdmissionCheckingTurnEngine::new(inner.clone(), admission.clone());
    assert_eq!(engine.supported_models(), TEST_MODELS);
    assert!(
        admission.calls.lock().unwrap().is_empty(),
        "model discovery is not billed"
    );
    let mut parts = engine.run_turn(request());
    assert!(matches!(parts.recv().await, Some(Ok(StreamPart::Content(text))) if text == "answer"));
    assert!(parts.recv().await.is_none());
    assert_eq!(inner.requests().len(), 1);
    assert_eq!(
        inner.requests()[0].instructions.as_deref(),
        Some("session instructions")
    );
    assert_eq!(inner.requests()[0].model, "test-model");
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cancellation_during_admission_does_not_start_the_engine() {
    let inner = Arc::new(ScriptedEngine::new(vec![]));
    let admission = Arc::new(Admission {
        pending: true,
        ..Default::default()
    });
    let engine = AdmissionCheckingTurnEngine::new(inner.clone(), admission.clone());
    let request = request();
    let cancel = request.cancel.clone();
    let mut parts = engine.run_turn(request);
    admission.started.notified().await;
    assert!(
        inner.requests().is_empty(),
        "must await admission before calling the engine"
    );
    cancel.cancel();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(1), parts.recv())
            .await
            .unwrap()
            .is_none()
    );
    assert!(inner.requests().is_empty());
}

#[tokio::test]
async fn an_admitted_turn_can_be_cancelled_after_allowance_is_exhausted() {
    let admission = Arc::new(Admission::default());
    let engine = AdmissionCheckingTurnEngine::new(Arc::new(HangingEngine), admission.clone());
    let request = request();
    let cancel = request.cancel.clone();
    let mut parts = engine.run_turn(request);
    admission.started.notified().await;
    admission.exhausted.store(true, Ordering::SeqCst);
    cancel.cancel();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(1), parts.recv())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn non_user_owners_never_run_or_substitute_a_system_identity() {
    let inner = Arc::new(ScriptedEngine::new(vec![]));
    let admission = Arc::new(Admission::default());
    let engine = AdmissionCheckingTurnEngine::new(inner.clone(), admission.clone());
    let mut request = request();
    request.owner = Owner::Team(macro_uuid::generate_uuid_v7());
    let mut parts = engine.run_turn(request);
    assert!(parts.recv().await.unwrap().is_err());
    assert!(parts.recv().await.is_none());
    assert!(inner.requests().is_empty());
    assert!(admission.calls.lock().unwrap().is_empty());
}
