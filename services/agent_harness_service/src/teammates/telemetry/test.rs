use opentelemetry_proto::tonic::trace::v1::{ScopeSpans, span::Event};

use super::*;

const LAPTOP: HarnessId = HarnessId::new_from_uuid(uuid::Uuid::from_u128(0x0d01));
const OURS: &str = "0193a1b2-0000-7000-8000-0000000001a1";
const THEIRS: &str = "0193a1b2-0000-7000-8000-0000000002a2";

fn int(key: &str, value: i64) -> KeyValue {
    KeyValue {
        key: key.to_owned(),
        value: Some(AnyValue {
            value: Some(any_value::Value::IntValue(value)),
        }),
    }
}

fn span(name: &str, attributes: Vec<KeyValue>) -> Span {
    Span {
        name: name.to_owned(),
        trace_id: vec![1; 16],
        span_id: vec![2; 8],
        attributes,
        ..Default::default()
    }
}

fn request(spans: Vec<Span>) -> ExportTraceServiceRequest {
    ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![
                    attribute("service.name", "anything"),
                    attribute("macro.harness_id", "someone-elses-machine"),
                    attribute("host.name", "owners-laptop"),
                ],
                dropped_attributes_count: 0,
                entity_refs: Vec::new(),
            }),
            scope_spans: vec![ScopeSpans {
                spans,
                ..Default::default()
            }],
            schema_url: String::new(),
        }],
    }
}

fn ours() -> HashSet<String> {
    HashSet::from([OURS.to_owned()])
}

fn kept_spans(sanitized: &Sanitized) -> Vec<&Span> {
    sanitized
        .request
        .resource_spans
        .iter()
        .flat_map(|resource| &resource.scope_spans)
        .flat_map(|scope| &scope.spans)
        .collect()
}

#[test]
fn the_resource_is_the_callers_machine_whatever_it_claims() {
    let sanitized = sanitize(
        request(vec![span(
            "teammate.start",
            vec![attribute("install_id", OURS)],
        )]),
        LAPTOP,
        &ours(),
    );

    let resource = sanitized.request.resource_spans[0]
        .resource
        .as_ref()
        .unwrap();
    assert_eq!(
        resource.attributes,
        vec![
            attribute("service.name", "macrod"),
            attribute("macro.harness_id", LAPTOP.to_string()),
            attribute("macro.telemetry.source", "self_hosted_macrod"),
        ]
    );
}

#[test]
fn only_allowlisted_metadata_passes() {
    let mut start = span(
        "teammate.start",
        vec![
            attribute("install_id", OURS),
            int("generation", 2),
            attribute("reason", "x".repeat(MAX_VALUE_CHARS + 50)),
            attribute("prompt", "what the agent was asked"),
            attribute("MACRO_API_KEY", "mak_secret"),
            attribute("path", "/home/someone/.config"),
        ],
    );
    start.events.push(Event {
        name: "tool output".to_owned(),
        ..Default::default()
    });

    let sanitized = sanitize(request(vec![start]), LAPTOP, &ours());

    let kept = kept_spans(&sanitized);
    assert_eq!(kept.len(), 1);
    assert_eq!(
        kept[0].attributes,
        vec![
            attribute("install_id", OURS),
            int("generation", 2),
            attribute("reason", "x".repeat(MAX_VALUE_CHARS)),
        ]
    );
    assert!(kept[0].events.is_empty());
    assert_eq!(kept[0].dropped_events_count, 1);
}

#[test]
fn another_machines_install_and_foreign_spans_are_rejected() {
    let sanitized = sanitize(
        request(vec![
            span("teammate.run", vec![attribute("install_id", OURS)]),
            span("teammate.run", vec![attribute("install_id", THEIRS)]),
            span("http.request", vec![]),
            span("macrod.enroll", vec![]),
        ]),
        LAPTOP,
        &ours(),
    );

    let names: Vec<_> = kept_spans(&sanitized)
        .iter()
        .map(|span| span.name.as_str())
        .collect();
    assert_eq!(names, vec!["teammate.run", "macrod.enroll"]);
    assert_eq!((sanitized.kept, sanitized.rejected), (2, 2));
}

#[test]
fn a_request_keeps_at_most_the_span_cap() {
    let spans = (0..MAX_SPANS + 3)
        .map(|_| span("teammate.pull", vec![]))
        .collect();

    let sanitized = sanitize(request(spans), LAPTOP, &ours());

    assert_eq!((sanitized.kept, sanitized.rejected), (MAX_SPANS, 3));
}

#[test]
fn nothing_allowed_forwards_nothing() {
    let sanitized = sanitize(request(vec![span("http.request", vec![])]), LAPTOP, &ours());

    assert!(sanitized.request.resource_spans.is_empty());
}

#[tokio::test(start_paused = true)]
async fn each_machine_gets_its_own_request_budget_per_window() {
    let limit = RateLimit::default();
    let desktop = HarnessId::new_from_uuid(uuid::Uuid::from_u128(0x0d02));
    let start = Instant::now();

    for _ in 0..MAX_REQUESTS_PER_WINDOW {
        assert!(limit.admit(LAPTOP, start).is_ok());
    }
    assert_eq!(limit.admit(LAPTOP, start), Err(RATE_WINDOW));
    assert!(limit.admit(desktop, start).is_ok());

    tokio::time::advance(RATE_WINDOW).await;
    assert!(limit.admit(LAPTOP, Instant::now()).is_ok());
}
