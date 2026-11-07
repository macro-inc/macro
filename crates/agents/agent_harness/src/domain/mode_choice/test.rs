use super::*;
use ai_billing::{AdmissionFuture, DenyReason};
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use jev::domain::Probability;
use serde_json::Value;
use std::sync::Mutex;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|person@example.com".to_owned()).unwrap()
}

struct Admission(Result<(), AiAdmissionError>);

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        assert_eq!(user, &owner());
        assert_eq!(feature, AiFeature::AgentModeChoice);
        Box::pin(async { self.0 })
    }
}

/// The usage feature and input each classification was asked with.
type Asked = Arc<Mutex<Vec<(AiFeature, Value)>>>;

/// Answers with a fixed result and remembers what it was asked.
struct Classifier {
    answer: Result<f32, JevError>,
    inputs: Asked,
}

impl YesNoClassifier for Classifier {
    async fn classify(
        &self,
        usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        assert_eq!(questions.len(), 1);
        self.inputs
            .lock()
            .unwrap()
            .push((usage.feature, input.clone()));
        self.answer
            .map(|probability| vec![Probability::new(probability).unwrap()])
    }
}

/// Flags for [`owner`] with Auto mode on or off.
fn flags(enabled: bool) -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        owner(),
        Ok(FlagSnapshot::new([(
            AUTO_MODE_FLAG.into(),
            FlagValue::Boolean(enabled),
        )])),
    );
    flags
}

fn service(
    answer: Result<f32, JevError>,
    admission: Result<(), AiAdmissionError>,
) -> (ModeChoiceServiceImpl<Classifier, FakeFeatureFlags>, Asked) {
    service_with_flags(answer, admission, Some(flags(true)))
}

fn service_with_flags(
    answer: Result<f32, JevError>,
    admission: Result<(), AiAdmissionError>,
    flags: Option<FakeFeatureFlags>,
) -> (ModeChoiceServiceImpl<Classifier, FakeFeatureFlags>, Asked) {
    let inputs = Arc::new(Mutex::new(Vec::new()));
    let classifier = Classifier {
        answer,
        inputs: inputs.clone(),
    };
    (
        ModeChoiceServiceImpl::new(Some(classifier), flags, Arc::new(Admission(admission))),
        inputs,
    )
}

#[tokio::test]
async fn likely_coding_requests_go_to_code_and_the_rest_to_chat() {
    for (probability, mode) in [
        (0.91, AgentMode::Code),
        (0.5, AgentMode::Code),
        (0.49, AgentMode::Chat),
        (0.02, AgentMode::Chat),
    ] {
        let (service, _) = service(Ok(probability), Ok(()));

        let chosen = service.choose(owner(), "Fix the login bug").await;

        assert_eq!(chosen, Ok(mode), "probability {probability}");
    }
}

#[tokio::test]
async fn classifies_the_trimmed_prompt_head_as_mode_choice_usage() {
    let (service, inputs) = service(Ok(0.1), Ok(()));
    let prompt = format!("  {}  ", "a".repeat(MAX_PROMPT_CHARS + 10));

    service.choose(owner(), &prompt).await.unwrap();

    let inputs = inputs.lock().unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].0, AiFeature::AgentModeChoice);
    assert_eq!(inputs[0].1, Value::String("a".repeat(MAX_PROMPT_CHARS)));
}

#[tokio::test]
async fn blank_prompts_are_rejected_without_classifying() {
    let (service, inputs) = service(Ok(0.9), Ok(()));

    assert_eq!(
        service.choose(owner(), "  \n").await,
        Err(ModeChoiceError::EmptyPrompt)
    );
    assert!(inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn denied_admission_stops_before_classifying() {
    let denied = AiAdmissionError::Denied(DenyReason::FreeAllowanceExhausted);
    let (service, inputs) = service(Ok(0.9), Err(denied));

    assert_eq!(
        service.choose(owner(), "Fix the login bug").await,
        Err(ModeChoiceError::Admission(denied))
    );
    assert!(inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn classifier_failures_and_missing_configuration_are_errors() {
    let (service, _) = service(Err(JevError::Unavailable), Ok(()));
    assert_eq!(
        service.choose(owner(), "Fix the login bug").await,
        Err(ModeChoiceError::Classifier(JevError::Unavailable))
    );

    let unconfigured = ModeChoiceServiceImpl::<Classifier, FakeFeatureFlags>::new(
        None,
        Some(flags(true)),
        Arc::new(Admission(Ok(()))),
    );
    assert_eq!(
        unconfigured.choose(owner(), "Fix the login bug").await,
        Err(ModeChoiceError::Unavailable)
    );
}

#[tokio::test]
async fn users_without_the_flag_are_not_classified() {
    let mut unreadable = FakeFeatureFlags::default();
    unreadable.set(owner(), Err("posthog is down".to_owned()));
    for flags in [None, Some(flags(false)), Some(unreadable)] {
        let (service, inputs) = service_with_flags(Ok(0.9), Ok(()), flags);

        assert_eq!(
            service.choose(owner(), "Fix the login bug").await,
            Err(ModeChoiceError::NotEnabled)
        );
        assert!(inputs.lock().unwrap().is_empty());
    }
}
