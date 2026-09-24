use super::*;
use crate::domain::model::{AgentSessionId, DEFAULT_AGENT_SESSION_NAME};
use crate::testing::test_agent_session;
use ai_billing::domain::{AiAdmissionError, DenyReason};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

struct FakeAdmission {
    result: Mutex<Option<Result<(), AiAdmissionError>>>,
    calls: Mutex<Vec<(String, AiFeature)>>,
}

impl AiAdmissionService for FakeAdmission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((user.to_string(), feature));
            self.result.lock().unwrap().take().expect("admit only once")
        })
    }
}

#[derive(Clone)]
struct RecordingGenerator {
    calls: Arc<AtomicUsize>,
    fail: bool,
}

impl AgentSessionNameGenerator for RecordingGenerator {
    async fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(session.id, AgentSessionId::TEST_A);
        assert_eq!(initial_prompt, "fix the flaky tests");
        if self.fail {
            return Err(rootcause::report!("provider failed"));
        }
        Ok(Some("Fix Flaky Tests".to_owned()))
    }
}

fn fixture(
    result: Result<(), AiAdmissionError>,
    fail: bool,
) -> (
    AdmissionCheckingAgentSessionNameGenerator<RecordingGenerator>,
    Arc<FakeAdmission>,
    Arc<AtomicUsize>,
    AgentSession,
) {
    let admission = Arc::new(FakeAdmission {
        result: Mutex::new(Some(result)),
        calls: Mutex::default(),
    });
    let calls = Arc::new(AtomicUsize::new(0));
    let generator = AdmissionCheckingAgentSessionNameGenerator::new(
        RecordingGenerator {
            calls: calls.clone(),
            fail,
        },
        admission.clone(),
    );
    let mut session = test_agent_session(AgentSessionId::TEST_A);
    session.owner_id = Owner::User(MacroUserIdStr::try_from("macro|owner@example.com").unwrap());
    (generator, admission, calls, session)
}

#[tokio::test]
async fn admitted_naming_bills_owner_and_invokes_generator_once() {
    let (generator, admission, calls, session) = fixture(Ok(()), false);
    let name = generator
        .generate_name(&session, "fix the flaky tests")
        .await
        .unwrap();
    assert_eq!(name.as_deref(), Some("Fix Flaky Tests"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *admission.calls.lock().unwrap(),
        vec![("macro|owner@example.com".to_owned(), AiFeature::ChatRename)]
    );
}

#[tokio::test]
async fn denied_or_unavailable_naming_skips_without_failing_or_changing_default_name() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Denied(DenyReason::OverageLimitReached),
        AiAdmissionError::Denied(DenyReason::OveragePaymentFailed),
        AiAdmissionError::Unavailable(rootcause::report!("billing lookup failed")),
    ] {
        let (generator, admission, calls, session) = fixture(Err(error), false);
        assert_eq!(
            generator
                .generate_name(&session, "fix the flaky tests")
                .await
                .unwrap(),
            None
        );
        assert_eq!(session.name, DEFAULT_AGENT_SESSION_NAME);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(admission.calls.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn admitted_generator_errors_are_preserved() {
    let (generator, _, calls, session) = fixture(Ok(()), true);
    let error = generator
        .generate_name(&session, "fix the flaky tests")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("provider failed"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn non_user_owner_never_checks_billing_or_invokes_generator() {
    let (generator, admission, calls, mut session) = fixture(Ok(()), false);
    session.owner_id = Owner::Team(macro_uuid::Uuid::now_v7());
    assert!(
        generator
            .generate_name(&session, "fix the flaky tests")
            .await
            .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(admission.calls.lock().unwrap().is_empty());
}
