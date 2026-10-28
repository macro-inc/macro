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

    async fn retitle(
        &self,
        _session: &AgentSession,
        _current: &str,
        _conversation: &ConversationDigest,
    ) -> Result<Option<String>, rootcause::Report> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Some("Retitled name".into()))
    }
}

/// Answers every question with one probability, counting the calls.
struct Classifier {
    probability: f32,
    calls: Arc<AtomicUsize>,
}

impl YesNoClassifier for Classifier {
    async fn classify(
        &self,
        usage: UsageContext,
        input: &serde_json::Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<jev::domain::Probability>, JevError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(usage.feature, AiFeature::ChatRename);
        assert_eq!(input["current_title"], "Investigate Issue");
        assert_eq!(questions.len(), 1);
        Ok(vec![
            jev::domain::Probability::new(self.probability).expect("a valid probability"),
        ])
    }
}

fn conversation() -> ConversationDigest {
    ConversationDigest {
        messages: vec![
            crate::domain::retitle::DigestMessage {
                role: crate::domain::retitle::DigestRole::User,
                text: "investigate issue".into(),
            },
            crate::domain::retitle::DigestMessage {
                role: crate::domain::retitle::DigestRole::Agent,
                text: "The OAuth callback drops its trailing slash.".into(),
            },
        ],
    }
}

async fn retitle_with(probability: Option<f32>) -> (Option<String>, usize, usize) {
    let named = Arc::new(AtomicUsize::new(0));
    let classified = Arc::new(AtomicUsize::new(0));
    let generator = ClassifiedRetitle::new(
        Namer(named.clone()),
        probability.map(|probability| Classifier {
            probability,
            calls: classified.clone(),
        }),
    );
    let session = crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A);
    let name = generator
        .retitle(&session, "Investigate Issue", &conversation())
        .await
        .unwrap();
    (
        name,
        classified.load(Ordering::SeqCst),
        named.load(Ordering::SeqCst),
    )
}

#[tokio::test]
async fn retitles_only_when_the_classifier_is_confident_the_name_no_longer_fits() {
    assert_eq!(
        retitle_with(Some(0.95)).await,
        (Some("Retitled name".into()), 1, 1)
    );
    assert_eq!(retitle_with(Some(0.79)).await, (None, 1, 0));
}

#[tokio::test]
async fn without_a_classifier_every_name_is_kept() {
    assert_eq!(retitle_with(None).await, (None, 0, 0));
}

#[tokio::test]
async fn denied_retitling_skips_both_models() {
    let named = Arc::new(AtomicUsize::new(0));
    let classified = Arc::new(AtomicUsize::new(0));
    let generator = AdmittedAgentSessionNameGenerator::new(
        ClassifiedRetitle::new(
            Namer(named.clone()),
            Some(Classifier {
                probability: 1.0,
                calls: classified.clone(),
            }),
        ),
        Arc::new(Admission(Err(AiAdmissionError::Denied(
            DenyReason::AllowanceExhausted,
        )))),
    );
    let session = crate::testing::test_agent_session(super::super::model::AgentSessionId::TEST_A);
    assert!(
        generator
            .retitle(&session, "Investigate Issue", &conversation())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(classified.load(Ordering::SeqCst), 0);
    assert_eq!(named.load(Ordering::SeqCst), 0);
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
