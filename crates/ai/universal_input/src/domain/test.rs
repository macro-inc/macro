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

#[test]
fn intent_prompts_stay_within_the_classifiers_question_contract() {
    for (intent, prompt) in INTENT_QUESTIONS {
        assert!(
            YesNoQuestion::try_from(prompt).is_ok(),
            "{intent:?} prompt exceeds the classifier contract"
        );
    }
}

#[test]
fn every_intent_response_field_has_an_extraction_or_domain_owner() {
    use std::collections::BTreeSet;
    for (intent, response, domain_fields) in [
        (
            InputIntent::Ai,
            serde_json::json!(AiSuggestions::default()),
            &[][..],
        ),
        (
            InputIntent::Email,
            serde_json::json!(EmailSuggestions::default()),
            &[][..],
        ),
        (
            InputIntent::Note,
            serde_json::json!(NoteSuggestions::default()),
            &["body"][..],
        ),
        (
            InputIntent::Task,
            serde_json::json!(TaskSuggestions::default()),
            &["due_date"][..],
        ),
        (
            InputIntent::Calendar,
            serde_json::json!(CalendarSuggestions::default()),
            &["start", "end", "start_assumption", "recurrence"][..],
        ),
        (
            InputIntent::Message,
            serde_json::json!(MessageSuggestions::default()),
            &[][..],
        ),
    ] {
        let fields: BTreeSet<_> = response
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        let owned: BTreeSet<_> = intent
            .extraction_fields()
            .iter()
            .chain(domain_fields)
            .copied()
            .collect();
        assert_eq!(
            fields, owned,
            "{intent:?} has a field without an extraction owner"
        );
    }
}

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
        search_type: None,
        property_definitions: vec![],
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
async fn preserves_valid_extracted_times_instead_of_reparsing_the_draft() {
    for (text, start, end) in [
        ("Call at 7 a.m.", "2026-10-24T07:00", "2026-10-24T08:00"),
        (
            "Call at 9 for .5 hours",
            "2026-10-24T09:00",
            "2026-10-24T09:30",
        ),
        (
            "Call at 9 for 1/2 hour",
            "2026-10-24T09:00",
            "2026-10-24T09:30",
        ),
        (
            "Call at 9 for 120 seconds",
            "2026-10-24T09:00",
            "2026-10-24T09:02",
        ),
        (
            "Call at 9 for 2 hours including 30 minutes of questions",
            "2026-10-24T09:00",
            "2026-10-24T11:00",
        ),
        (
            "Call tomorrow at 9 to plan next week Monday's launch",
            "2026-10-24T09:00",
            "2026-10-24T10:00",
        ),
        (
            "Retreat at 9 until tomorrow morning",
            "2026-10-24T09:00",
            "2026-10-25T09:00",
        ),
        (
            "Block time over the next week",
            "2026-10-26T09:00",
            "2026-11-02T09:00",
        ),
    ] {
        let mut input = request();
        input.text = text.into();
        let response = service(InputSuggestions::Calendar(CalendarSuggestions {
            start: Some(start.into()),
            end: Some(end.into()),
            ..Default::default()
        }))
        .extract(user(), input)
        .await
        .unwrap();
        let InputSuggestions::Calendar(fields) = response.suggestion else {
            panic!("wrong suggestion variant");
        };
        assert_eq!(fields.start.as_deref(), Some(start), "{text}");
        assert_eq!(fields.end.as_deref(), Some(end), "{text}");
    }
}

#[tokio::test]
async fn defaults_missing_or_zero_length_ends_but_rejects_invalid_or_reversed_ends() {
    for (end, expected) in [
        (None, Some("2026-10-10T20:00")),
        (Some("2026-10-10T19:00"), Some("2026-10-10T20:00")),
        (Some("2026-10-10T21:00"), Some("2026-10-10T21:00")),
        (Some("2026-10-10T18:00"), None),
        (Some("not a date"), None),
    ] {
        let response = service(InputSuggestions::Calendar(CalendarSuggestions {
            start: Some("2026-10-10T19:00".into()),
            end: end.map(str::to_owned),
            ..Default::default()
        }))
        .extract(user(), request())
        .await
        .unwrap();
        let InputSuggestions::Calendar(fields) = response.suggestion else {
            panic!("wrong suggestion variant");
        };
        assert_eq!(fields.end.as_deref(), expected);
    }
}

#[tokio::test]
async fn does_not_truncate_extracted_bodies_or_reinterpret_guest_negation() {
    let mut input = request();
    input.intent = InputIntent::Email;
    input.text = "email Julia about the report that failed".into();
    let body = "Can we discuss the report that failed?";
    let response = service(InputSuggestions::Email(EmailSuggestions {
        body: Some(body.into()),
        ..Default::default()
    }))
    .extract(user(), input)
    .await
    .unwrap();
    let InputSuggestions::Email(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert_eq!(fields.body.as_deref(), Some(body));
    assert_eq!(fields.subject.as_deref(), Some(body));

    let mut input = request();
    input.text = "Invite Julia but don't invite Alex".into();
    let response = service(InputSuggestions::Calendar(CalendarSuggestions {
        guests: vec!["Julia".into()],
        ..Default::default()
    }))
    .extract(user(), input)
    .await
    .unwrap();
    let InputSuggestions::Calendar(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert_eq!(fields.guests, ["Julia"]);
}

#[tokio::test]
async fn notes_preserve_the_entire_source_without_requesting_a_body_from_the_model() {
    let mut input = request();
    input.intent = InputIntent::Note;
    input.text = "# Research\n\n- First finding\n- Second finding".into();
    let text = input.text.clone();
    let response = service(InputSuggestions::Note(NoteSuggestions {
        title: Some("Research".into()),
        ..Default::default()
    }))
    .extract(user(), input)
    .await
    .unwrap();
    let InputSuggestions::Note(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert_eq!(fields.body.as_deref(), Some(text.as_str()));
}

#[test]
fn every_model_field_has_typed_guidance() {
    for intent in [
        InputIntent::Email,
        InputIntent::Message,
        InputIntent::Note,
        InputIntent::Task,
        InputIntent::Calendar,
        InputIntent::Search,
    ] {
        for field in intent.extraction_fields() {
            assert!(
                intent.typed_field_guidance(field).is_some(),
                "{intent:?}.{field}"
            );
        }
    }
}

#[tokio::test]
async fn validates_field_catalog_bounds_before_inference_and_preserves_property_suggestions() {
    let mut input = request();
    input.property_definitions = (0..65)
        .map(|_| InputPropertyDefinition {
            name: "Priority".into(),
            options: vec![],
        })
        .collect();
    assert!(matches!(
        service(InputSuggestions::Calendar(CalendarSuggestions::default()))
            .extract(user(), input)
            .await,
        Err(InputError::InvalidProperties)
    ));
    let mut input = request();
    input.intent = InputIntent::Task;
    input.text = "notification click not going to target\npriority urgent".into();
    input.property_definitions = vec![InputPropertyDefinition {
        name: "Priority".into(),
        options: vec!["Urgent".into()],
    }];
    let response = service(InputSuggestions::Task(TaskSuggestions {
        properties: vec![InputPropertySuggestion {
            name: "Priority".into(),
            values: vec!["Urgent".into()],
        }],
        ..Default::default()
    }))
    .extract(user(), input)
    .await
    .unwrap();
    let InputSuggestions::Task(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert_eq!(fields.properties[0].name, "Priority");
    assert_eq!(fields.properties[0].values, ["Urgent"]);
}

#[tokio::test]
async fn returns_seven_independent_scores_and_the_draft_revision() {
    let response = service(InputSuggestions::Calendar(CalendarSuggestions::default()))
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
        Extractor(InputSuggestions::Calendar(CalendarSuggestions::default())),
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
    let service = service(InputSuggestions::Calendar(CalendarSuggestions::default()));
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
        Extractor(InputSuggestions::Calendar(CalendarSuggestions::default())),
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
    let response = service(InputSuggestions::Calendar(CalendarSuggestions {
        title: Some("Call John".into()),
        start: Some("2026-10-10T15:00".into()),
        end: Some("2026-10-10T16:00".into()),
        ..Default::default()
    }))
    .extract(user(), request())
    .await
    .unwrap();
    let InputSuggestions::Calendar(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert_eq!(fields.start.as_deref(), Some("2026-10-10T15:00"));
    assert!(fields.guests.is_empty());
    assert_eq!(response.revision, 7);
}

#[tokio::test]
async fn rejects_invalid_timezones_and_ambiguous_or_nonexistent_wall_times() {
    let mut input = request();
    input.time_zone = "Not/AZone".into();
    assert!(matches!(
        service(InputSuggestions::Calendar(CalendarSuggestions::default()))
            .extract(user(), input)
            .await,
        Err(InputError::InvalidTimeZone)
    ));
    for start in ["2026-03-08T02:30", "2026-11-01T01:30", "not a date"] {
        let response = service(InputSuggestions::Calendar(CalendarSuggestions {
            start: Some(start.into()),
            ..Default::default()
        }))
        .extract(user(), request())
        .await
        .unwrap();
        let InputSuggestions::Calendar(fields) = response.suggestion else {
            panic!("wrong suggestion variant");
        };
        assert!(fields.start.is_none());
    }
}

#[tokio::test]
async fn normalizes_seconds_and_offsets_to_the_users_local_event_time() {
    for start in [
        "2026-10-10T19:00:00",
        "2026-10-10T19:00:00.000",
        "2026-10-10T19:00:00-04:00",
        "2026-10-10T23:00:00Z",
        " 2026-10-10T19:00 ",
    ] {
        let response = service(InputSuggestions::Calendar(CalendarSuggestions {
            start: Some(start.into()),
            end: Some("2026-10-11T00:00:00Z".into()),
            ..Default::default()
        }))
        .extract(user(), request())
        .await
        .unwrap();
        let InputSuggestions::Calendar(fields) = response.suggestion else {
            panic!("wrong suggestion variant");
        };
        assert_eq!(fields.start.as_deref(), Some("2026-10-10T19:00"));
        assert_eq!(fields.end.as_deref(), Some("2026-10-10T20:00"));
    }
}

#[tokio::test]
async fn revalidates_end_times_computed_across_daylight_saving_transitions() {
    for (start, expected_end) in [
        ("2026-11-01T00:30", None),
        ("2026-03-08T01:30", Some("2026-03-08T03:30")),
    ] {
        let mut input = request();
        input.text = "Call Julia".into();
        let response = service(InputSuggestions::Calendar(CalendarSuggestions {
            start: Some(start.into()),
            ..Default::default()
        }))
        .extract(user(), input)
        .await
        .unwrap();
        let InputSuggestions::Calendar(fields) = response.suggestion else {
            panic!("wrong suggestion variant");
        };

        assert_eq!(fields.start.as_deref(), Some(start));
        // The fall-back result is 01:30 EST. Returning it without its offset
        // would let the browser select 01:30 EDT and shorten the event by an hour.
        assert_eq!(fields.end.as_deref(), expected_end);
    }
}

#[tokio::test]
async fn rejects_an_extracted_ambiguous_end_without_replacing_it_with_a_default() {
    let response = service(InputSuggestions::Calendar(CalendarSuggestions {
        start: Some("2026-11-01T00:00".into()),
        end: Some("2026-11-01T01:30".into()),
        ..Default::default()
    }))
    .extract(user(), request())
    .await
    .unwrap();
    let InputSuggestions::Calendar(fields) = response.suggestion else {
        panic!("wrong suggestion variant");
    };
    assert!(fields.end.is_none());
}

#[tokio::test]
async fn mismatched_provider_variants_are_rejected() {
    let response = service(InputSuggestions::Email(EmailSuggestions::default()))
        .extract(user(), request())
        .await;
    assert!(matches!(response, Err(InputError::Extraction)));
}

#[test]
fn tagged_suggestions_reject_fields_from_other_destinations() {
    assert!(
        serde_json::from_value::<InputSuggestions>(serde_json::json!({
            "intent":"email", "suggestions":{"subject":"Hello", "start":"2026-10-26T18:00"}
        }))
        .is_err()
    );
}
