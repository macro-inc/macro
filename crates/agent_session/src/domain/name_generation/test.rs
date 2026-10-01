use super::*;
use ai_billing::{AdmissionFuture, AiAdmissionError, DenyReason};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Admission(Result<(), AiAdmissionError>);

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a macro_user_id::user_id::MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        assert_eq!(
            user,
            crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A)
                .owner_user()
                .unwrap()
        );
        assert_eq!(feature, AiFeature::ChatRename);
        Box::pin(async { self.0 })
    }
}

#[derive(Clone)]
struct Namer(Arc<AtomicUsize>);

impl AgentSessionNameGenerator for Namer {
    async fn generate_name(
        &self,
        _session: &AgentSession,
        _initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Some("Generated name".into()))
    }
}

#[tokio::test]
async fn denied_or_unavailable_naming_retains_fallback_without_provider_calls() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let calls = Arc::new(AtomicUsize::new(0));
        let generator = AdmittedAgentSessionNameGenerator::new(
            Namer(calls.clone()),
            Arc::new(Admission(Err(error))),
        );
        let session =
            crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A);
        let fallback = session.name.clone();
        let generated = generator
            .generate_name(&session, "fix login")
            .await
            .unwrap();
        assert!(generated.is_none());
        assert_eq!(generated.unwrap_or(session.name), fallback);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn non_user_owner_keeps_its_name_without_substituting_a_system_user() {
    struct NoAdmission;
    impl AiAdmissionService for NoAdmission {
        fn admit<'a>(
            &'a self,
            _: &'a macro_user_id::user_id::MacroUserIdStr<'_>,
            _: AiFeature,
        ) -> AdmissionFuture<'a> {
            panic!("a missing user must not be replaced with a billing identity");
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let generator =
        AdmittedAgentSessionNameGenerator::new(Namer(calls.clone()), Arc::new(NoAdmission));
    let mut session =
        crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A);
    session.owner_id = model_owner::Owner::Team(uuid::Uuid::from_u128(1));
    assert!(
        generator
            .generate_name(&session, "fix login")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn admitted_naming_delegates_once() {
    let calls = Arc::new(AtomicUsize::new(0));
    let generator =
        AdmittedAgentSessionNameGenerator::new(Namer(calls.clone()), Arc::new(Admission(Ok(()))));
    let session = crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A);
    assert_eq!(
        generator
            .generate_name(&session, "fix login")
            .await
            .unwrap()
            .as_deref(),
        Some("Generated name")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
