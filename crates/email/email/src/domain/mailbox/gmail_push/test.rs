use super::*;
use fixtures::*;
use models_email::gmail::inbox_sync::JwtVerificationError;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::SubscriberExt, registry::LookupSpan};

mod fixtures;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Event {
    level: String,
    fields: BTreeMap<String, String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Span {
    name: String,
    parent: Option<String>,
    fields: BTreeMap<String, String>,
}
#[derive(Default)]
struct Observations {
    events: Vec<Event>,
    spans: Vec<Span>,
}
#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Observations>>);
#[derive(Default)]
struct Fields(BTreeMap<String, String>);
impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}
impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> Layer<S> for Capture {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        self.0.lock().unwrap().events.push(Event {
            level: event.metadata().level().to_string(),
            fields: fields.0,
        });
    }
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        _: &tracing::Id,
        ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let parent = attrs
            .parent()
            .and_then(|id| ctx.span(id))
            .or_else(|| ctx.lookup_current());
        let mut fields = Fields::default();
        attrs.record(&mut fields);
        self.0.lock().unwrap().spans.push(Span {
            name: attrs.metadata().name().into(),
            parent: parent.map(|span| span.name().into()),
            fields: fields.0,
        });
    }
}

fn event(level: &str, message: &str, fields: &[(&str, &str)]) -> Event {
    let mut values = BTreeMap::from([("message".into(), message.into())]);
    values.extend(
        fields
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string())),
    );
    Event {
        level: level.into(),
        fields: values,
    }
}

async fn authenticate(
    data: Data,
    header: Option<&str>,
) -> (Result<(), PushAuthenticationError>, Vec<Call>, Capture) {
    let (service, fake) = authentication(data);
    let capture = Capture::default();
    let result = service
        .authenticate(header)
        .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
        .await;
    let calls = fake.0.lock().unwrap().calls.clone();
    (result, calls, capture)
}

#[tokio::test]
async fn cached_keys_are_used_without_fetch_and_the_lookup_span_has_no_fields() {
    let (result, calls, capture) = authenticate(Data::default(), Some("Bearer token")).await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        calls,
        [
            Call::Read,
            Call::Verify("token".into(), vec!["cached".into()])
        ]
    );
    let seen = capture.0.lock().unwrap();
    assert!(seen.events.is_empty());
    assert_eq!(
        seen.spans,
        [Span {
            name: "get_google_public_keys".into(),
            parent: None,
            fields: BTreeMap::new()
        }]
    );
}

#[tokio::test]
async fn cache_miss_and_read_error_both_fetch_but_only_the_error_warns() {
    for failed_read in [false, true] {
        let (result, calls, capture) = authenticate(
            Data {
                cached: Some(if failed_read {
                    Err(Fault::Read)
                } else {
                    Ok(None)
                }),
                ..Data::default()
            },
            Some("Bearer token"),
        )
        .await;
        assert_eq!(result, Ok(()));
        assert_eq!(
            calls,
            [
                Call::Read,
                Call::Fetch,
                Call::Write(vec!["fresh".into()], 17),
                Call::Verify("token".into(), vec!["fresh".into()])
            ]
        );
        let seen = capture.0.lock().unwrap();
        let expected = if failed_read {
            vec![event(
                "WARN",
                "Failed to get Google public keys from Redis, falling back",
                &[("error", "Read")],
            )]
        } else {
            vec![]
        };
        assert_eq!(seen.events, expected);
        assert_eq!(
            seen.spans,
            [
                Span {
                    name: "get_google_public_keys".into(),
                    parent: None,
                    fields: BTreeMap::new()
                },
                Span {
                    name: "fetch_and_cache_google_public_keys".into(),
                    parent: Some("get_google_public_keys".into()),
                    fields: BTreeMap::new()
                },
            ]
        );
    }
}

#[tokio::test]
async fn cache_write_error_does_not_prevent_verification() {
    let (result, calls, capture) = authenticate(
        Data {
            cached: Some(Ok(None)),
            fail_write: true,
            ..Data::default()
        },
        Some("Bearer token"),
    )
    .await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        calls.last(),
        Some(&Call::Verify("token".into(), vec!["fresh".into()]))
    );
    assert_eq!(
        capture.0.lock().unwrap().events,
        [event(
            "WARN",
            "Failed to cache Google public keys in Redis",
            &[("error", "Write")]
        )]
    );
}

#[tokio::test]
async fn initial_fetch_failure_precedes_a_missing_bearer_and_stops_authentication() {
    let (result, calls, capture) = authenticate(
        Data {
            cached: Some(Ok(None)),
            fetched: VecDeque::from([Err(Fault::Fetch)]),
            ..Data::default()
        },
        None,
    )
    .await;
    assert_eq!(result, Err(PushAuthenticationError::PublicKeysUnavailable));
    assert_eq!(calls, [Call::Read, Call::Fetch]);
    assert_eq!(
        capture.0.lock().unwrap().events,
        [event(
            "ERROR",
            "unable to get google public keys",
            &[("error", "Fetch")]
        )]
    );
}

#[tokio::test]
async fn missing_or_nonexact_bearer_prefix_is_refused_after_key_lookup() {
    for header in [
        None,
        Some(""),
        Some("bearer token"),
        Some("Bearer"),
        Some("Basic token"),
        Some(" Bearer token"),
    ] {
        let (result, calls, capture) = authenticate(Data::default(), header).await;
        assert_eq!(result, Err(PushAuthenticationError::MissingBearerToken));
        assert_eq!(calls, [Call::Read]);
        assert_eq!(
            capture.0.lock().unwrap().events,
            [event(
                "WARN",
                "No bearer token provided in request headers",
                &[]
            )]
        );
    }
}

#[tokio::test]
async fn the_exact_prefix_passes_even_empty_and_whitespace_tokens_to_verification() {
    for (header, token) in [
        ("Bearer ", ""),
        ("Bearer  token", " token"),
        ("Bearer token ", "token "),
    ] {
        let (result, calls, _) = authenticate(Data::default(), Some(header)).await;
        assert_eq!(result, Ok(()));
        assert_eq!(
            calls,
            [
                Call::Read,
                Call::Verify(token.into(), vec!["cached".into()])
            ]
        );
    }
}

#[tokio::test]
async fn only_key_lookup_and_signature_errors_refresh_then_retry_once() {
    for first in [
        JwtVerificationError::KeyNotFound("rotated".into()),
        JwtVerificationError::InvalidSignature,
    ] {
        let message = format!(
            "Token verification failed due to possible key rotation, refreshing keys and retrying. Error: {first:?}"
        );
        let (result, calls, capture) = authenticate(
            Data {
                verified: VecDeque::from([Err(first), Ok(())]),
                ..Data::default()
            },
            Some("Bearer token"),
        )
        .await;
        assert_eq!(result, Ok(()));
        assert_eq!(
            calls,
            [
                Call::Read,
                Call::Verify("token".into(), vec!["cached".into()]),
                Call::Fetch,
                Call::Write(vec!["fresh".into()], 17),
                Call::Verify("token".into(), vec!["fresh".into()])
            ]
        );
        let seen = capture.0.lock().unwrap();
        assert_eq!(seen.events, [event("WARN", &message, &[])]);
        assert_eq!(
            seen.spans,
            [
                Span {
                    name: "get_google_public_keys".into(),
                    parent: None,
                    fields: BTreeMap::new()
                },
                Span {
                    name: "fetch_and_cache_google_public_keys".into(),
                    parent: None,
                    fields: BTreeMap::new()
                },
            ]
        );
    }
}

#[tokio::test]
async fn refresh_failure_returns_its_distinct_refusal_without_a_second_verification() {
    let first = JwtVerificationError::InvalidSignature;
    let message = format!(
        "Token verification failed due to possible key rotation, refreshing keys and retrying. Error: {first:?}"
    );
    let (result, calls, capture) = authenticate(
        Data {
            verified: VecDeque::from([Err(first)]),
            fetched: VecDeque::from([Err(Fault::Fetch)]),
            ..Data::default()
        },
        Some("Bearer token"),
    )
    .await;
    assert_eq!(result, Err(PushAuthenticationError::RefreshFailed));
    assert_eq!(
        calls,
        [
            Call::Read,
            Call::Verify("token".into(), vec!["cached".into()]),
            Call::Fetch
        ]
    );
    assert_eq!(
        capture.0.lock().unwrap().events,
        [
            event("WARN", &message, &[]),
            event(
                "ERROR",
                "Failed to refresh Google public keys",
                &[("error", "Fetch")]
            )
        ]
    );
}

#[tokio::test]
async fn a_second_verification_failure_logs_both_errors_and_never_refreshes_again() {
    let first = JwtVerificationError::InvalidSignature;
    let message = format!(
        "Token verification failed due to possible key rotation, refreshing keys and retrying. Error: {first:?}"
    );
    let (result, calls, capture) = authenticate(
        Data {
            verified: VecDeque::from([Err(first), Err(JwtVerificationError::InvalidIssuer)]),
            ..Data::default()
        },
        Some("Bearer token"),
    )
    .await;
    assert_eq!(result, Err(PushAuthenticationError::InvalidToken));
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Fetch))
            .count(),
        1
    );
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Verify(..)))
            .count(),
        2
    );
    assert_eq!(
        capture.0.lock().unwrap().events,
        [
            event("WARN", &message, &[]),
            event(
                "ERROR",
                "Token verification failed even with refreshed keys",
                &[
                    ("first_error", "InvalidSignature"),
                    ("second_error", "InvalidIssuer")
                ]
            )
        ]
    );
}

#[tokio::test]
async fn every_other_verification_error_is_terminal_without_refresh() {
    for error in [
        JwtVerificationError::MissingKid,
        JwtVerificationError::InvalidAudience,
        JwtVerificationError::InvalidIssuer,
        JwtVerificationError::UnsupportedKeyType("EC".into()),
        JwtVerificationError::HeaderDecodeError(anyhow::anyhow!("header")),
        JwtVerificationError::DecodingKeyCreationError(anyhow::anyhow!("key")),
        JwtVerificationError::ValidationError(anyhow::anyhow!("claims")),
        JwtVerificationError::TokenExpired(chrono::DateTime::from_timestamp(0, 0).unwrap()),
    ] {
        let debug = format!("{error:?}");
        let (result, calls, capture) = authenticate(
            Data {
                verified: VecDeque::from([Err(error)]),
                ..Data::default()
            },
            Some("Bearer token"),
        )
        .await;
        assert_eq!(result, Err(PushAuthenticationError::InvalidToken));
        assert_eq!(
            calls,
            [
                Call::Read,
                Call::Verify("token".into(), vec!["cached".into()])
            ]
        );
        assert_eq!(
            capture.0.lock().unwrap().events,
            [event(
                "ERROR",
                "Token verification failed with non-key related error",
                &[("error", &debug)]
            )]
        );
    }
}

#[tokio::test]
async fn disabled_authentication_goes_directly_to_lookup_and_preserves_history() {
    let (service, fake) = intake(Data::default(), false);
    assert_eq!(
        service.receive("inbox@example.com", u64::MAX, None).await,
        Ok(())
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [
            Call::Lookup("inbox@example.com".into(), "GMAIL".into()),
            Call::Queue(LINK, u64::MAX)
        ]
    );
}

#[tokio::test]
async fn authentication_failure_prevents_lookup_and_queueing() {
    let (service, fake) = intake(
        Data {
            auth_error: Some(PushAuthenticationError::InvalidToken),
            ..Data::default()
        },
        true,
    );
    assert_eq!(
        service
            .receive("inbox@example.com", 42, Some("Bearer token"))
            .await,
        Err(GmailPushError::Authentication(
            PushAuthenticationError::InvalidToken
        ))
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        [Call::Authenticate(Some("Bearer token".into()))]
    );
}

#[tokio::test]
async fn absent_inboxes_are_successful_and_a_present_inbox_queues_once_after_authentication() {
    for link in [None, Some(LINK)] {
        let (service, fake) = intake(
            Data {
                link,
                ..Data::default()
            },
            true,
        );
        assert_eq!(
            service
                .receive("inbox@example.com", 42, Some("Bearer token"))
                .await,
            Ok(())
        );
        let mut expected = vec![
            Call::Authenticate(Some("Bearer token".into())),
            Call::Lookup("inbox@example.com".into(), "GMAIL".into()),
        ];
        if link.is_some() {
            expected.push(Call::Queue(LINK, 42));
        }
        assert_eq!(fake.0.lock().unwrap().calls, expected);
    }
}

#[tokio::test]
async fn query_and_queue_failures_keep_the_shared_error_message_and_order() {
    for lookup in [false, true] {
        let (service, fake) = intake(
            Data {
                fail_lookup: lookup,
                fail_queue: !lookup,
                ..Data::default()
            },
            false,
        );
        let capture = Capture::default();
        let result = service
            .receive("inbox@example.com", 42, None)
            .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
            .await;
        assert_eq!(
            result,
            Err(if lookup {
                GmailPushError::InboxLookupFailed
            } else {
                GmailPushError::EnqueueFailed
            })
        );
        let mut expected = vec![Call::Lookup("inbox@example.com".into(), "GMAIL".into())];
        if !lookup {
            expected.push(Call::Queue(LINK, 42));
        }
        assert_eq!(fake.0.lock().unwrap().calls, expected);
        assert_eq!(
            capture.0.lock().unwrap().events,
            [event(
                "ERROR",
                "unable to enqueue gmail notification",
                &[("error", if lookup { "Lookup" } else { "Queue" })]
            )]
        );
    }
}
