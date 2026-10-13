use super::*;

use std::io;
use std::sync::{Arc, Mutex};

use async_graphql::{
    EmptyMutation, EmptySubscription, ErrorExtensionValues, ErrorExtensions as _, Object, Schema,
    Variables,
};
use opentelemetry::trace::{Status, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use tracing_subscriber::{Registry, fmt::MakeWriter, layer::SubscriberExt as _};

struct Query;

#[Object]
impl Query {
    async fn ok(&self) -> i32 {
        1
    }

    async fn broken(&self) -> async_graphql::Result<i32> {
        Err(async_graphql::Error::new(
            "upstream rejected jane@example.com",
        ))
    }

    async fn store(&self, value: String) -> async_graphql::Result<String> {
        Err(async_graphql::Error::new(format!(
            "could not store {value}"
        )))
    }

    async fn missing(&self, value: String) -> async_graphql::Result<i32> {
        Err(
            async_graphql::Error::new(format!("no thread named {value}"))
                .extend_with(|_, extensions| extensions.set("code", "NOT_FOUND")),
        )
    }

    async fn rejected(&self, value: String) -> async_graphql::Result<i32> {
        Err(async_graphql::Error::new("rejected")
            .extend_with(|_, extensions| extensions.set("code", format!("BAD {value}"))))
    }

    async fn unavailable(&self) -> async_graphql::Result<i32> {
        Err(async_graphql::Error::new("service unavailable")
            .extend_with(|_, extensions| extensions.set("code", "INTERNAL_SERVER_ERROR")))
    }
}

#[derive(Clone, Default)]
struct SharedWriter(Arc<Mutex<Vec<u8>>>);

impl SharedWriter {
    fn lines(&self) -> Vec<serde_json::Value> {
        String::from_utf8(self.0.lock().unwrap().clone())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

impl io::Write for SharedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for SharedWriter {
    type Writer = SharedWriter;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

struct Observed {
    span: SpanData,
    logs: Vec<serde_json::Value>,
    raw_logs: String,
}

impl Observed {
    fn attribute(&self, key: &str) -> Option<String> {
        self.attribute_value(key).map(ToString::to_string)
    }

    fn attribute_value(&self, key: &str) -> Option<&opentelemetry::Value> {
        self.span
            .attributes
            .iter()
            .find(|attribute| attribute.key.as_str() == key)
            .map(|attribute| &attribute.value)
    }
}

async fn observe_request(request: Request, authenticated: bool) -> Observed {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let logs = SharedWriter::default();
    let subscriber = Registry::default()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")))
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .flatten_event(true)
                .with_ansi(false)
                .with_writer(logs.clone()),
        );
    let guard = tracing::subscriber::set_default(subscriber);
    let schema = Schema::new(Query, EmptyMutation, EmptySubscription);
    observe(request, authenticated, |request| async move {
        schema.execute(request).await
    })
    .await;
    drop(guard);

    let mut spans = exporter.get_finished_spans().unwrap();
    assert_eq!(spans.len(), 1);
    let raw_logs = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    Observed {
        span: spans.remove(0),
        logs: logs.lines(),
        raw_logs,
    }
}

fn operation(query: &str, operation_name: Option<&str>, authenticated: bool) -> GraphqlOperation {
    let mut request = Request::new(query);
    if let Some(name) = operation_name {
        request = request.operation_name(name);
    }
    GraphqlOperation::from_request(&mut request, authenticated)
}

fn resolver_error(code: Option<&str>) -> ServerError {
    let mut error = ServerError::new("failed", None);
    error.path = vec![
        PathSegment::Field("user".to_owned()),
        PathSegment::Field("soup".to_owned()),
    ];
    if let Some(code) = code {
        let mut extensions = ErrorExtensionValues::default();
        extensions.set("code", code);
        error.extensions = Some(extensions);
    }
    error
}

#[test]
fn resource_name_follows_the_executed_operation() {
    let cases = [
        ("query Soup { ok }", None, "graphql.query.Soup"),
        ("{ ok }", None, "graphql.query.anonymous"),
        ("mutation Save { ok }", None, "graphql.mutation.Save"),
        (
            "subscription Updates { ok }",
            None,
            "graphql.subscription.Updates",
        ),
        (
            "mutation Save { ok } query Soup { ok }",
            Some("Soup"),
            "graphql.query.Soup",
        ),
        (
            "mutation Save { ok } query Soup { ok }",
            None,
            "graphql.unknown",
        ),
        ("query Soup { ok }", Some("Other"), "graphql.unknown"),
        ("{ ok }", Some("Soup"), "graphql.unknown"),
        ("query Soup {", None, "graphql.unknown"),
    ];
    for (query, operation_name, expected) in cases {
        assert_eq!(
            operation(query, operation_name, true).resource_name(),
            expected,
            "{query} / {operation_name:?}"
        );
    }
}

#[test]
fn unauthenticated_operations_share_one_resource() {
    let operation = operation("query AttackerChosenName { ok }", None, false);
    assert_eq!(operation.resource_name(), "graphql.query.unauthenticated");
    assert_eq!(operation.name.as_deref(), Some("AttackerChosenName"));
}

#[test]
fn operation_names_are_bounded() {
    let name = "A".repeat(500);
    let operation = operation(&format!("query {name} {{ ok }}"), None, true);
    assert_eq!(
        operation.name.map(|name| name.len()),
        Some(MAX_OPERATION_NAME_CHARS)
    );
}

#[test]
fn only_uncoded_or_internal_resolver_errors_are_server_errors() {
    let authenticated = operation("query Soup { ok }", None, true);
    let anonymous = operation("query Soup { ok }", None, false);

    assert_eq!(
        authenticated.error_severity(&resolver_error(None)),
        ErrorSeverity::Server
    );
    assert_eq!(
        authenticated.error_severity(&resolver_error(Some("INTERNAL"))),
        ErrorSeverity::Server
    );
    assert_eq!(
        authenticated.error_severity(&resolver_error(Some("INTERNAL_SERVER_ERROR"))),
        ErrorSeverity::Server
    );
    for code in ["NOT_FOUND", "BAD_USER_INPUT", "FORBIDDEN", "invalid_input"] {
        assert_eq!(
            authenticated.error_severity(&resolver_error(Some(code))),
            ErrorSeverity::Client,
            "{code}"
        );
    }
    assert_eq!(
        authenticated.error_severity(&ServerError::new("Unknown field \"nope\"", None)),
        ErrorSeverity::Client
    );
    assert_eq!(
        anonymous.error_severity(&resolver_error(None)),
        ErrorSeverity::Client
    );
}

#[test]
fn error_paths_join_fields_and_indexes() {
    let path = [
        PathSegment::Field("user".to_owned()),
        PathSegment::Field("items".to_owned()),
        PathSegment::Index(3),
        PathSegment::Field("name".to_owned()),
    ];
    assert_eq!(error_path(&path).as_deref(), Some("user.items.3.name"));
    assert_eq!(error_path(&[]), None);
}

#[test]
fn error_paths_are_bounded() {
    let path = vec![PathSegment::Field("a".repeat(500))];
    assert_eq!(
        error_path(&path).map(|path| path.len()),
        Some(MAX_ERROR_PATH_CHARS)
    );
}

#[test]
fn only_identifier_error_codes_are_logged() {
    for code in ["NOT_FOUND", "INTERNAL_SERVER_ERROR", "invalid_input"] {
        assert_eq!(loggable_error_code(&resolver_error(Some(code))), Some(code));
    }
    for code in [
        "",
        "BAD jane@example.com",
        "invalid-input",
        &"A".repeat(MAX_ERROR_CODE_CHARS + 1),
    ] {
        assert_eq!(
            loggable_error_code(&resolver_error(Some(code))),
            Some(UNRECOGNIZED_ERROR_CODE),
            "{code}"
        );
    }
    assert_eq!(loggable_error_code(&resolver_error(None)), None);
}

#[test]
fn status_description_never_contains_the_message() {
    let mut error = resolver_error(None);
    error.message = "could not store Q3 board notes".to_owned();
    assert_eq!(status_description(&error), "graphql resolver error");

    let mut error = resolver_error(Some("INTERNAL"));
    error.message = "could not store Q3 board notes".to_owned();
    assert_eq!(
        status_description(&error),
        "graphql resolver error: INTERNAL"
    );
}

#[tokio::test]
async fn successful_request_records_operation_without_logging() {
    let observed = observe_request(Request::new("query Soup { ok }"), true).await;

    assert_eq!(observed.span.name, "graphql.execute");
    assert_eq!(
        observed.attribute("resource.name").as_deref(),
        Some("graphql.query.Soup")
    );
    assert_eq!(
        observed.attribute("graphql.operation.type").as_deref(),
        Some("query")
    );
    assert_eq!(
        observed.attribute("graphql.operation.name").as_deref(),
        Some("Soup")
    );
    assert_eq!(
        observed.attribute("graphql.error_count").as_deref(),
        Some("0")
    );
    assert_eq!(observed.span.status, Status::Unset);
    assert!(observed.logs.is_empty(), "{}", observed.raw_logs);
}

#[tokio::test]
async fn every_execute_span_is_measured_as_an_integer() {
    let requests = [
        (Request::new("query Soup { ok }"), true),
        (Request::new("query Broken { broken }"), true),
        (Request::new("mutation Anything { ok }"), false),
        (Request::new("query {"), true),
    ];
    for (request, authenticated) in requests {
        let observed = observe_request(request, authenticated).await;
        assert_eq!(
            observed.attribute_value("_dd.measured"),
            Some(&opentelemetry::Value::I64(1)),
            "{:?}",
            observed.attribute("resource.name")
        );
    }
}

#[tokio::test]
async fn resolver_errors_mark_span_and_log_without_messages() {
    let request = Request::new(
        "query Broken($value: String!) { ok broken store(value: $value) missing(value: $value) rejected(value: $value) }",
    )
    .variables(Variables::from_json(
        serde_json::json!({ "value": "Q3 board notes jane@example.com" }),
    ));
    let observed = observe_request(request, true).await;

    assert_eq!(
        observed.attribute("resource.name").as_deref(),
        Some("graphql.query.Broken")
    );
    assert_eq!(
        observed.attribute("graphql.error_count").as_deref(),
        Some("4")
    );
    assert_eq!(
        observed.span.status,
        Status::error("graphql resolver error")
    );

    assert_eq!(observed.logs.len(), 4, "{}", observed.raw_logs);
    let by_path = |path: &str| {
        observed
            .logs
            .iter()
            .find(|log| log["graphql.error.path"] == path)
            .unwrap_or_else(|| panic!("no log for {path}: {}", observed.raw_logs))
    };
    let broken = by_path("broken");
    assert_eq!(broken["level"], "ERROR");
    assert_eq!(broken["message"], "graphql resolver error");
    assert_eq!(broken["graphql.resource"], "graphql.query.Broken");
    assert_eq!(broken["graphql.operation.type"], "query");
    assert_eq!(broken["graphql.operation.name"], "Broken");
    assert_eq!(broken["graphql.error_count"], 4);

    let store = by_path("store");
    assert_eq!(store["level"], "ERROR");
    assert_eq!(store["message"], "graphql resolver error");

    let missing = by_path("missing");
    assert_eq!(missing["level"], "WARN");
    assert_eq!(missing["message"], "graphql client error");
    assert_eq!(missing["graphql.error.code"], "NOT_FOUND");

    let rejected = by_path("rejected");
    assert_eq!(rejected["level"], "WARN");
    assert_eq!(rejected["graphql.error.code"], UNRECOGNIZED_ERROR_CODE);

    let span = format!("{:?}", observed.span);
    for leaked in [
        "Q3 board notes",
        "jane@example.com",
        "upstream rejected",
        "could not store",
        "no thread named",
    ] {
        assert!(
            !observed.raw_logs.contains(leaked),
            "{leaked}: {}",
            observed.raw_logs
        );
        assert!(!span.contains(leaked), "{leaked}: {span}");
    }
}

#[tokio::test]
async fn internal_error_code_marks_span() {
    let observed = observe_request(Request::new("query Down { unavailable }"), true).await;

    assert_eq!(
        observed.span.status,
        Status::error("graphql resolver error: INTERNAL_SERVER_ERROR")
    );
    assert!(!observed.raw_logs.contains("service unavailable"));
    assert_eq!(observed.logs.len(), 1, "{}", observed.raw_logs);
    assert_eq!(observed.logs[0]["level"], "ERROR");
    assert_eq!(
        observed.logs[0]["graphql.error.code"],
        "INTERNAL_SERVER_ERROR"
    );
}

#[tokio::test]
async fn client_errors_log_warnings_without_marking_span() {
    let invalid = observe_request(Request::new("query Typo { nope }"), true).await;
    assert_eq!(invalid.span.status, Status::Unset);
    assert_eq!(
        invalid.attribute("graphql.error_count").as_deref(),
        Some("1")
    );
    assert_eq!(invalid.logs.len(), 1, "{}", invalid.raw_logs);
    assert_eq!(invalid.logs[0]["level"], "WARN");
    assert!(invalid.logs[0].get("graphql.error.path").is_none());
    assert!(!invalid.raw_logs.contains("nope"), "{}", invalid.raw_logs);

    let unparsable = observe_request(Request::new("query {"), true).await;
    assert_eq!(
        unparsable.attribute("resource.name").as_deref(),
        Some("graphql.unknown")
    );
    assert_eq!(unparsable.span.status, Status::Unset);
    assert_eq!(unparsable.logs[0]["level"], "WARN");

    let anonymous = observe_request(Request::new("query Broken { broken }"), false).await;
    assert_eq!(
        anonymous.attribute("resource.name").as_deref(),
        Some("graphql.query.unauthenticated")
    );
    assert_eq!(anonymous.span.status, Status::Unset);
    assert_eq!(anonymous.logs[0]["level"], "WARN");
}

#[tokio::test]
async fn logged_errors_are_capped_per_response() {
    let fields: Vec<String> = (0..25).map(|index| format!("e{index}: broken")).collect();
    let query = format!("query Many {{ {} }}", fields.join(" "));
    let observed = observe_request(Request::new(query), true).await;

    assert_eq!(
        observed.attribute("graphql.error_count").as_deref(),
        Some("25")
    );
    assert_eq!(observed.logs.len(), MAX_LOGGED_ERRORS);
    assert!(matches!(observed.span.status, Status::Error { .. }));
}
