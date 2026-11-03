use super::*;
use crate::domain::models::{GateLimit, MailboxAccess};
use crate::domain::ports::{MailboxRequestGate, ScopedMailboxRepository};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

#[derive(Default)]
struct Fields(HashMap<&'static str, String>);

impl Visit for Fields {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name(), format!("{value:?}"));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name(), value.to_owned());
    }
}

/// Every closed span's name and the last value recorded for each field.
#[derive(Clone, Default)]
struct Spans(Arc<Mutex<Vec<(&'static str, HashMap<&'static str, String>)>>>);

impl Spans {
    fn named(&self, name: &str) -> Vec<HashMap<&'static str, String>> {
        let spans = self.0.lock().unwrap();
        spans
            .iter()
            .filter(|(span, _)| *span == name)
            .map(|(_, fields)| fields.clone())
            .collect()
    }
}

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Spans {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut fields = Fields::default();
        attrs.record(&mut fields);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(fields);
        }
    }
    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id)
            && let Some(fields) = span.extensions_mut().get_mut::<Fields>()
        {
            values.record(fields);
        }
    }
    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(&id) {
            let fields = span.extensions_mut().remove::<Fields>().unwrap_or_default();
            self.0.lock().unwrap().push((span.name(), fields.0));
        }
    }
}

struct RefusingGate;

impl MailboxRequestGate for RefusingGate {
    fn acquire(
        &self,
        _: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
        Box::pin(async {
            Err(EmailApiError::RateLimited {
                retry_after: Some(Duration::from_millis(2_500)),
                origin: RateLimitOrigin::Gate(GateLimit::Window),
            })
        })
    }
    fn finish(
        &self,
        _: MailboxAccess,
        _: Uuid,
        _: Option<Duration>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
    fn admitted(&self, _: MailboxAccess) -> Pin<Box<dyn Future<Output = Option<u64>> + Send + '_>> {
        Box::pin(async { None })
    }
}

const MAILBOX: MailboxAccess = MailboxAccess {
    link_id: Uuid::from_u128(0x0a),
    sync_generation: 3,
    grant_generation: 1,
};

#[tokio::test]
async fn graph_throttling_is_recorded_with_its_retry_after_and_request_id() {
    let spans = Spans::default();
    let _subscriber =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(spans.clone()));
    let (server, api, token) = super::super::test::setup().await;
    let api = api.for_mailbox(MAILBOX);
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages/AAMkAGI2TG93AAA="))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("Retry-After", "7")
                .insert_header("request-id", "graph-request-1"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages/AAMkOK"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("request-id", "graph-request-2")
                .set_body_json(serde_json::json!({})),
        )
        .mount(&server)
        .await;

    let throttled = api
        .get::<Value>(
            &token,
            api.endpoint(&["me", "messages", "AAMkAGI2TG93AAA="])
                .unwrap(),
        )
        .await;
    let succeeded = api
        .get::<Value>(&token, api.endpoint(&["me", "messages", "AAMkOK"]).unwrap())
        .await;

    assert!(matches!(throttled, Err(EmailApiError::RateLimited { .. })));
    assert!(succeeded.is_ok());
    let requests = spans.named("outlook.graph_request");
    let [throttled, succeeded] = requests.as_slice() else {
        panic!("expected two Graph request spans, got {requests:?}");
    };
    assert_eq!(throttled["operation.name"], "outlook.graph_request");
    assert_eq!(throttled["url.template"], "/me/messages/{id}");
    assert_eq!(throttled["mailbox.link_id"], MAILBOX.link_id.to_string());
    assert_eq!(throttled["http.response.status_code"], "429");
    assert_eq!(throttled["outlook.throttle_origin"], "graph");
    assert_eq!(throttled["outlook.retry_after_seconds"], "7");
    assert_eq!(throttled["graph.request_id"], "graph-request-1");
    assert!(throttled.contains_key("otel.status_description"));

    assert_eq!(succeeded["http.response.status_code"], "200");
    assert_eq!(succeeded["outlook.throttle_origin"], "none");
    assert_eq!(succeeded["graph.request_id"], "graph-request-2");
    assert!(!succeeded.contains_key("otel.status_description"));
}

#[tokio::test]
async fn a_gate_refusal_is_a_deferral_not_a_failed_request() {
    let spans = Spans::default();
    let _subscriber =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(spans.clone()));
    let (_server, mut api, token) = super::super::test::setup().await;
    api.gate = Some(Arc::new(RefusingGate));
    let api = api.for_mailbox(MAILBOX);

    let refused = api
        .get::<Value>(
            &token,
            api.endpoint(&["me", "mailFolders", "inbox"]).unwrap(),
        )
        .await;

    assert!(matches!(
        refused,
        Err(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Gate(GateLimit::Window),
            ..
        })
    ));
    let requests = spans.named("outlook.graph_request");
    let [refused] = requests.as_slice() else {
        panic!("expected one Graph request span, got {requests:?}");
    };
    assert_eq!(refused["outlook.throttle_origin"], "gate");
    assert_eq!(refused["outlook.retry_after_seconds"], "3");
    assert!(refused.contains_key("outlook.gate_wait_ms"));
    assert!(!refused.contains_key("http.response.status_code"));
    assert!(!refused.contains_key("otel.status_description"));
}
