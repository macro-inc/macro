//! What a request's span and failure log say, and that neither carries a
//! Notion id, URL or Notion's own words.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use http::StatusCode;
use serde_json::json;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

use super::super::{NOTION_REQUEST_INTERVAL, NotionRestClient, RequestPacer, TransportResponse};
use super::{ScriptedTransport, Step, ok};
use crate::domain::model::NotionId;
use crate::domain::ports::{NotionApi, NotionError, TransportClass};

const PAGE: &str = "598337872cf94fdf8782e53db20768a5";
const PAGE_DASHED: &str = "59833787-2cf9-4fdf-8782-e53db20768a5";
/// Words only Notion's error body contains.
const NOTION_WORDS: &str = "Quarterly secrets page";

type Fields = HashMap<&'static str, String>;

#[derive(Default)]
struct Visitor(Fields);

impl Visit for Visitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name(), format!("{value:?}"));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name(), value.to_owned());
    }
}

/// Every closed span's fields, by name, and every event's fields.
#[derive(Clone, Default)]
struct Captured {
    spans: Arc<Mutex<Vec<(&'static str, Fields)>>>,
    events: Arc<Mutex<Vec<Fields>>>,
}

impl Captured {
    fn requests(&self) -> Vec<Fields> {
        let spans = self.spans.lock().unwrap();
        spans
            .iter()
            .filter(|(name, _)| *name == "notion.request")
            .map(|(_, fields)| fields.clone())
            .collect()
    }

    fn failures(&self) -> Vec<Fields> {
        let events = self.events.lock().unwrap();
        events
            .iter()
            .filter(|fields| {
                fields.get("message").map(String::as_str) == Some("Notion request failed")
            })
            .cloned()
            .collect()
    }

    fn every_value(&self) -> Vec<String> {
        let spans = self.spans.lock().unwrap();
        let events = self.events.lock().unwrap();
        spans
            .iter()
            .flat_map(|(_, fields)| fields.values().cloned())
            .chain(events.iter().flat_map(|fields| fields.values().cloned()))
            .collect()
    }
}

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Captured {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut fields = Visitor::default();
        attrs.record(&mut fields);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(fields);
        }
    }
    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id)
            && let Some(fields) = span.extensions_mut().get_mut::<Visitor>()
        {
            values.record(fields);
        }
    }
    fn on_event(&self, event: &tracing::Event<'_>, _: Context<'_, S>) {
        let mut fields = Visitor::default();
        event.record(&mut fields);
        self.events.lock().unwrap().push(fields.0);
    }
    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(&id) {
            let fields = span
                .extensions_mut()
                .remove::<Visitor>()
                .unwrap_or_default();
            self.spans.lock().unwrap().push((span.name(), fields.0));
        }
    }
}

fn capture() -> (Captured, tracing::subscriber::DefaultGuard) {
    let captured = Captured::default();
    let guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(captured.clone()));
    // A callsite another test thread registered first can keep a cached
    // "never" interest; recompute it for this subscriber.
    tracing::callsite::rebuild_interest_cache();
    (captured, guard)
}

fn client(steps: Vec<Step>) -> NotionRestClient<Arc<ScriptedTransport>> {
    NotionRestClient::new(
        ScriptedTransport::steps(steps),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    )
}

fn page() -> NotionId {
    NotionId::parse(PAGE).unwrap()
}

fn answer(status: StatusCode, body: &str) -> Step {
    Step::Answer(TransportResponse {
        status,
        retry_after: None,
        body: body.to_owned(),
    })
}

fn fields(pairs: &[(&'static str, &str)]) -> Fields {
    pairs
        .iter()
        .map(|(name, value)| (*name, (*value).to_owned()))
        .collect()
}

#[tokio::test(start_paused = true)]
async fn a_bad_gateway_then_success_records_the_endpoint_attempts_and_final_status() {
    let (captured, _guard) = capture();
    let client = client(vec![
        answer(StatusCode::BAD_GATEWAY, "<html>bad gateway</html>"),
        Step::Answer(ok(
            json!({"object": "page_markdown", "markdown": "done", "unknown_block_ids": []}),
        )),
    ]);

    client.page_markdown(&page()).await.unwrap();

    assert_eq!(
        captured.requests(),
        vec![fields(&[
            ("endpoint", "page_markdown"),
            ("method", "GET"),
            ("attempts", "2"),
            ("status", "200"),
            ("outcome", "succeeded"),
        ])]
    );
    assert_eq!(captured.failures(), Vec::<Fields>::new());
}

#[tokio::test(start_paused = true)]
async fn a_request_that_times_out_every_attempt_records_the_transport_class() {
    let (captured, _guard) = capture();
    let client = client(
        (0..5)
            .map(|_| Step::Fail(TransportClass::Timeout))
            .collect(),
    );

    let error = client.page(&page()).await.unwrap_err();

    assert_eq!(error.transport_class(), Some(TransportClass::Timeout));
    let failed = fields(&[
        ("endpoint", "page"),
        ("method", "GET"),
        ("attempts", "5"),
        ("outcome", "exhausted"),
        ("error_class", "transport"),
        ("transport_class", "timeout"),
    ]);
    assert_eq!(captured.requests(), vec![failed]);
    assert_eq!(
        captured.failures(),
        vec![fields(&[
            ("message", "Notion request failed"),
            ("endpoint", "page"),
            ("attempts", "5"),
            ("outcome", "exhausted"),
            ("error_class", "transport"),
            ("transport_class", "timeout"),
        ])]
    );
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_that_never_lifts_records_status_429_and_exhausted() {
    let (captured, _guard) = capture();
    let limited = r#"{"object":"error","status":429,"code":"rate_limited","message":"slow down"}"#;
    let client = client(
        (0..5)
            .map(|_| answer(StatusCode::TOO_MANY_REQUESTS, limited))
            .collect(),
    );

    client
        .search(crate::domain::model::SearchObject::Page, None)
        .await
        .unwrap_err();

    assert_eq!(
        captured.requests(),
        vec![fields(&[
            ("endpoint", "search"),
            ("method", "POST"),
            ("attempts", "5"),
            ("status", "429"),
            ("outcome", "exhausted"),
            ("error_class", "rate_limited"),
        ])]
    );
    assert_eq!(captured.failures().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn an_unauthorized_answer_is_final_after_one_attempt() {
    let (captured, _guard) = capture();
    let client = client(vec![answer(
        StatusCode::UNAUTHORIZED,
        r#"{"object":"error","status":401,"code":"unauthorized","message":"API token is invalid."}"#,
    )]);

    client.page(&page()).await.unwrap_err();

    assert_eq!(
        captured.requests(),
        vec![fields(&[
            ("endpoint", "page"),
            ("method", "GET"),
            ("attempts", "1"),
            ("status", "401"),
            ("outcome", "not_retryable"),
            ("error_class", "upstream"),
        ])]
    );
    assert_eq!(
        captured.failures(),
        vec![fields(&[
            ("message", "Notion request failed"),
            ("endpoint", "page"),
            ("attempts", "1"),
            ("status", "401"),
            ("outcome", "not_retryable"),
            ("error_class", "upstream"),
        ])]
    );
}

#[tokio::test(start_paused = true)]
async fn no_span_or_log_carries_a_notion_id_url_or_notions_words() {
    let (captured, _guard) = capture();
    let words = format!(
        r#"{{"object":"error","status":400,"code":"validation_error","message":"{NOTION_WORDS} https://www.notion.so/{PAGE} {PAGE_DASHED}"}}"#
    );
    let client = client(vec![
        answer(StatusCode::BAD_REQUEST, &words),
        Step::Fail(TransportClass::Connect),
        Step::Fail(TransportClass::Connect),
        Step::Fail(TransportClass::Connect),
        Step::Fail(TransportClass::Connect),
        Step::Fail(TransportClass::Connect),
        Step::Answer(ok(
            json!({"object": "page", "id": PAGE_DASHED, "not a page": true}),
        )),
    ]);

    let rejected = client.page_markdown(&page()).await.unwrap_err();
    let unreachable = client.page(&page()).await.unwrap_err();
    let unreadable = client.data_source(&page()).await.unwrap_err();
    // Errors are logged with `?error` and `%error` elsewhere.
    tracing::warn!(error = ?rejected, shown = %rejected, "logged by a caller");
    tracing::warn!(error = ?unreachable, shown = %unreachable, "logged by a caller");
    tracing::warn!(error = ?unreadable, shown = %unreadable, "logged by a caller");

    assert!(matches!(
        rejected,
        NotionError::Upstream { status: 400, .. }
    ));
    assert!(matches!(unreadable, NotionError::Decode(_)));
    let values = captured.every_value();
    assert!(values.len() > 20, "{values:?}");
    for value in values {
        for leak in [
            PAGE,
            PAGE_DASHED,
            NOTION_WORDS,
            "notion.so",
            "notion.com",
            "/v1/",
            "https://",
        ] {
            assert!(!value.contains(leak), "{leak:?} leaked in {value:?}");
        }
    }
}

#[test]
fn an_error_shows_only_its_class_status_and_transport_class() {
    let upstream = NotionError::Upstream {
        status: 502,
        body: NOTION_WORDS.to_owned(),
    };
    let transport = NotionError::Transport {
        class: TransportClass::Timeout,
        report: rootcause::report!("https://api.notion.com/v1/pages/{PAGE}").into_dynamic(),
    };

    assert_eq!(
        upstream.to_string(),
        "Notion could not complete the request (HTTP 502)"
    );
    assert_eq!(
        format!("{upstream:?}"),
        r#"NotionError { class: Upstream, status: 502 }"#
    );
    assert_eq!(
        transport.to_string(),
        "Notion request did not complete (timeout)"
    );
    assert_eq!(
        format!("{transport:?}"),
        "NotionError { class: Transport, transport_class: Timeout }"
    );
}
