use super::*;
use ai_billing::{DenyReason, DisabledAiAdmissionService};
use jev::domain::{JevError, Probability};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Classifier(Arc<AtomicUsize>);
impl YesNoClassifier for Classifier {
    async fn classify(
        &self,
        _: UsageContext,
        input: &serde_json::Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        assert!(input["draft"].is_string());
        assert_eq!(questions.len(), 7);
        Ok((0..7)
            .map(|i| Probability::new(if i == 5 { 0.98 } else { 0.02 }).unwrap())
            .collect())
    }
}
struct Extractor(InputSuggestions);
impl FieldExtractor for Extractor {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        Ok(self.0.clone())
    }
}
struct Denied;
impl AiAdmissionService for Denied {
    fn admit<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
        _: AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        Box::pin(async { Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)) })
    }
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|universal-input@example.com".to_owned()).unwrap()
}
fn request() -> ExtractInputRequest {
    ExtractInputRequest {
        text: "Call John at 3pm tomorrow".into(),
        intent: InputIntent::Calendar,
        revision: 7,
        reference_time: "2026-10-09T18:00:00Z".parse().unwrap(),
        time_zone: "America/New_York".into(),
    }
}
fn service(fields: InputSuggestions) -> UniversalInputService<Classifier, Extractor> {
    UniversalInputService::new(
        Some(Classifier(Arc::new(AtomicUsize::new(0)))),
        Extractor(fields),
        Arc::new(DisabledAiAdmissionService),
    )
}

#[tokio::test]
async fn returns_seven_independent_scores_and_the_draft_revision() {
    let response = service(InputSuggestions::default())
        .classify(
            user(),
            ClassifyInputRequest {
                text: request().text,
                revision: 13,
            },
        )
        .await
        .unwrap();
    assert_eq!(response.revision, 13);
    assert_eq!(response.scores.len(), 7);
    assert_eq!(response.scores[5].intent, InputIntent::Calendar);
    assert_eq!(response.scores[5].score, 0.98);
}

#[tokio::test]
async fn admission_prevents_provider_calls() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = UniversalInputService::new(
        Some(Classifier(calls.clone())),
        Extractor(InputSuggestions::default()),
        Arc::new(Denied),
    );
    assert!(matches!(
        service
            .classify(
                user(),
                ClassifyInputRequest {
                    text: "hello".into(),
                    revision: 0
                }
            )
            .await,
        Err(InputError::Admission(_))
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        service.extract(user(), request()).await,
        Err(InputError::Admission(_))
    ));
}

#[tokio::test]
async fn rejects_empty_and_oversized_drafts_before_inference() {
    let service = service(InputSuggestions::default());
    for text in [" ".into(), "a".repeat(16_001)] {
        assert!(matches!(
            service
                .classify(user(), ClassifyInputRequest { text, revision: 0 })
                .await,
            Err(InputError::InvalidText)
        ));
    }
}

#[tokio::test]
async fn extraction_is_available_without_jev_configuration() {
    let service = UniversalInputService::<Classifier, _>::new(
        None,
        Extractor(InputSuggestions::default()),
        Arc::new(DisabledAiAdmissionService),
    );
    assert!(matches!(
        service
            .classify(
                user(),
                ClassifyInputRequest {
                    text: "hello".into(),
                    revision: 0
                }
            )
            .await,
        Err(InputError::Unavailable)
    ));
    assert!(service.extract(user(), request()).await.is_ok());
}

#[tokio::test]
async fn keeps_valid_local_event_times_and_never_adds_attendees() {
    let response = service(InputSuggestions {
        title: Some("Call John".into()),
        start: Some("2026-10-10T15:00".into()),
        end: Some("2026-10-10T16:00".into()),
        ..Default::default()
    })
    .extract(user(), request())
    .await
    .unwrap();
    assert_eq!(
        response.suggestions.start.as_deref(),
        Some("2026-10-10T15:00")
    );
    assert!(response.suggestions.guests.is_empty());
    assert_eq!(response.revision, 7);
}

#[tokio::test]
async fn rejects_invalid_timezones_and_ambiguous_or_nonexistent_wall_times() {
    let mut input = request();
    input.time_zone = "Not/AZone".into();
    assert!(matches!(
        service(InputSuggestions::default())
            .extract(user(), input)
            .await,
        Err(InputError::InvalidTimeZone)
    ));
    for start in ["2026-03-08T02:30", "2026-11-01T01:30", "not a date"] {
        let response = service(InputSuggestions {
            start: Some(start.into()),
            ..Default::default()
        })
        .extract(user(), request())
        .await
        .unwrap();
        assert!(response.suggestions.start.is_none());
    }
}
