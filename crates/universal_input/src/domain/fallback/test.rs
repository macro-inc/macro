use super::*;
use ai_usage::AiFeature;
use std::sync::{Arc, Mutex};

struct Extractor {
    calls: Arc<Mutex<Vec<UsageContext>>>,
    result: fn() -> Result<InputSuggestions, InputError>,
}
impl FieldExtractor for Extractor {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        usage: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        self.calls.lock().unwrap().push(usage);
        (self.result)()
    }
}

fn request() -> ExtractInputRequest {
    ExtractInputRequest {
        text: "email Julia\nAre you free?".into(),
        intent: super::super::InputIntent::Email,
        revision: 1,
        reference_time: "2026-10-23T18:00:00Z".parse().unwrap(),
        time_zone: "America/New_York".into(),
        search_type: None,
        property_definitions: vec![],
    }
}

#[tokio::test]
async fn successful_primary_never_calls_fallback_including_valid_empty_answers() {
    let primary_calls = Arc::new(Mutex::new(vec![]));
    let fallback_calls = Arc::new(Mutex::new(vec![]));
    let extractor = FallbackFieldExtractor::new(
        Some(Extractor {
            calls: primary_calls.clone(),
            result: || {
                Ok(InputSuggestions::Email(
                    super::super::EmailSuggestions::default(),
                ))
            },
        }),
        Extractor {
            calls: fallback_calls.clone(),
            result: || panic!("fallback must not run"),
        },
    );
    extractor
        .extract(
            &request(),
            UsageContext::system(AiFeature::DynamicCompletionsApi),
        )
        .await
        .unwrap();
    assert_eq!(primary_calls.lock().unwrap().len(), 1);
    assert!(fallback_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_primary_calls_fallback_once_with_the_same_attribution() {
    let primary_calls = Arc::new(Mutex::new(vec![]));
    let fallback_calls = Arc::new(Mutex::new(vec![]));
    let extractor = FallbackFieldExtractor::new(
        Some(Extractor {
            calls: primary_calls.clone(),
            result: || Err(InputError::Extraction),
        }),
        Extractor {
            calls: fallback_calls.clone(),
            result: || {
                Ok(InputSuggestions::Email(super::super::EmailSuggestions {
                    body: Some("Are you free?".into()),
                    ..Default::default()
                }))
            },
        },
    );
    let usage = UsageContext::system(AiFeature::DynamicCompletionsApi);
    let result = extractor.extract(&request(), usage.clone()).await.unwrap();
    let InputSuggestions::Email(fields) = result else {
        panic!("wrong intent");
    };
    assert_eq!(fields.body.as_deref(), Some("Are you free?"));
    for calls in [&primary_calls, &fallback_calls] {
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].user, usage.user);
        assert_eq!(calls[0].feature, usage.feature);
        assert_eq!(calls[0].entity, usage.entity);
    }
}

#[tokio::test]
async fn absent_primary_uses_existing_extractor() {
    let calls = Arc::new(Mutex::new(vec![]));
    let extractor = FallbackFieldExtractor::<Extractor, _>::new(
        None,
        Extractor {
            calls: calls.clone(),
            result: || {
                Ok(InputSuggestions::Email(
                    super::super::EmailSuggestions::default(),
                ))
            },
        },
    );
    extractor
        .extract(
            &request(),
            UsageContext::system(AiFeature::DynamicCompletionsApi),
        )
        .await
        .unwrap();
    assert_eq!(calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn does_not_bypass_validation_errors_with_a_fallback() {
    let calls = Arc::new(Mutex::new(vec![]));
    let extractor = FallbackFieldExtractor::new(
        Some(Extractor {
            calls: calls.clone(),
            result: || Err(InputError::InvalidTimeZone),
        }),
        Extractor {
            calls: calls.clone(),
            result: || panic!("fallback must not run"),
        },
    );
    assert!(matches!(
        extractor
            .extract(
                &request(),
                UsageContext::system(AiFeature::DynamicCompletionsApi)
            )
            .await,
        Err(InputError::InvalidTimeZone)
    ));
    assert_eq!(calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn does_not_bypass_admission_denial_with_a_fallback() {
    let calls = Arc::new(Mutex::new(vec![]));
    let extractor = FallbackFieldExtractor::new(
        Some(Extractor {
            calls: calls.clone(),
            result: || {
                Err(InputError::Admission(ai_billing::AiAdmissionError::Denied(
                    ai_billing::DenyReason::AllowanceExhausted,
                )))
            },
        }),
        Extractor {
            calls: calls.clone(),
            result: || panic!("fallback must not bypass admission"),
        },
    );
    assert!(matches!(
        extractor
            .extract(
                &request(),
                UsageContext::system(AiFeature::DynamicCompletionsApi)
            )
            .await,
        Err(InputError::Admission(_))
    ));
    assert_eq!(calls.lock().unwrap().len(), 1);
}
