#[cfg(test)]
mod test;

use async_graphql::{
    PathSegment, Request, Response, ServerError, Value,
    parser::types::{DocumentOperations, OperationType},
};
use tracing::{Instrument as _, Level, Span};

/// Resource for requests whose operation cannot be resolved (parse errors,
/// unknown operation names). Keeps attacker-supplied text out of the resource.
const UNKNOWN_RESOURCE: &str = "graphql.unknown";
const ANONYMOUS_OPERATION: &str = "anonymous";
/// Unauthenticated callers choose their own operation names. Grouping them
/// bounds the resource cardinality that Datadog turns into metric tags.
const UNAUTHENTICATED_OPERATION: &str = "unauthenticated";
const MAX_OPERATION_NAME_CHARS: usize = 100;
/// A response can carry one error per aliased field; cap the log lines per request.
const MAX_LOGGED_ERRORS: usize = 10;
/// Paths are field names, client-chosen aliases, and list indexes.
const MAX_ERROR_PATH_CHARS: usize = 200;
const MAX_ERROR_CODE_CHARS: usize = 64;
/// Logged in place of an `extensions.code` that is not a plain identifier.
const UNRECOGNIZED_ERROR_CODE: &str = "UNRECOGNIZED";
const SERVER_ERROR_CODE_PREFIX: &str = "INTERNAL";
const SERVER_ERROR_TEXT: &str = "graphql resolver error";
const CLIENT_ERROR_TEXT: &str = "graphql client error";
const DATADOG_MEASURED: i64 = 1;

/// Runs `execute` inside a `graphql.execute` span that records the selected
/// operation and logs the response's errors.
pub(super) async fn observe<Fut>(
    mut request: Request,
    authenticated: bool,
    execute: impl FnOnce(Request) -> Fut,
) -> Response
where
    Fut: Future<Output = Response>,
{
    let span = execute_span();
    let operation = GraphqlOperation::from_request(&mut request, authenticated);
    operation.record(&span);
    let response = execute(request).instrument(span.clone()).await;
    operation.record_response(&span, &response);
    response
}

fn execute_span() -> Span {
    tracing::info_span!(
        "graphql.execute",
        // The Datadog Agent computes `trace.Internal.*` stats for an internal
        // child span only when this attribute is the OTLP integer 1; a bool or
        // string is ignored.
        "_dd.measured" = DATADOG_MEASURED,
        "resource.name" = tracing::field::Empty,
        "graphql.operation.type" = tracing::field::Empty,
        "graphql.operation.name" = tracing::field::Empty,
        "graphql.error_count" = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    )
}

/// The operation a GraphQL HTTP request selects, recorded on `graphql.execute`.
#[derive(Debug)]
struct GraphqlOperation {
    kind: Option<OperationType>,
    name: Option<String>,
    authenticated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ErrorSeverity {
    /// The caller sent something the server rejected; logged at warn.
    Client,
    /// A resolver failed for an authenticated caller; logged at error and marks the span.
    Server,
}

impl GraphqlOperation {
    /// Parses the request document so its operation can be recorded before
    /// execution. The parsed document stays on the request and
    /// `Schema::execute` reuses it, so valid documents are parsed once.
    fn from_request(request: &mut Request, authenticated: bool) -> Self {
        let requested_name = request.operation_name.clone();
        let selected = request.parsed_query().ok().and_then(|document| {
            select_operation(&document.operations, requested_name.as_deref())
                .map(|(name, kind)| (name.map(truncate_operation_name), kind))
        });
        let (name, kind) = match selected {
            Some((name, kind)) => (name, Some(kind)),
            None => (None, None),
        };
        Self {
            kind,
            name,
            authenticated,
        }
    }

    /// The Datadog resource name, `graphql.<type>.<operationName>`. Datadog
    /// derives `trace.Internal.{hits,errors,duration}` per resource from it.
    fn resource_name(&self) -> String {
        let Some(kind) = self.kind else {
            return UNKNOWN_RESOURCE.to_owned();
        };
        let name = match (&self.name, self.authenticated) {
            (_, false) => UNAUTHENTICATED_OPERATION,
            (Some(name), true) => name.as_str(),
            (None, true) => ANONYMOUS_OPERATION,
        };
        format!("graphql.{kind}.{name}")
    }

    fn record(&self, span: &Span) {
        span.record("resource.name", self.resource_name());
        if let Some(kind) = self.kind {
            span.record("graphql.operation.type", tracing::field::display(kind));
        }
        if let Some(name) = &self.name {
            span.record("graphql.operation.name", name.as_str());
        }
    }

    /// Records the error count on `span`, logs each error with its path and
    /// code, and marks `span` errored when a resolver failed.
    ///
    /// Error messages are never recorded: resolvers and async-graphql build
    /// them from request input (variable values, arguments, upstream error
    /// text), so no redaction of free text is reliable.
    fn record_response(&self, span: &Span, response: &Response) {
        span.record("graphql.error_count", response.errors.len());

        for error in response.errors.iter().take(MAX_LOGGED_ERRORS) {
            self.log_error(span, error, response.errors.len());
        }

        if let Some(error) = response
            .errors
            .iter()
            .find(|error| self.error_severity(error) == ErrorSeverity::Server)
        {
            span.record("otel.status_code", "ERROR");
            span.record("otel.status_description", status_description(error));
        }
    }

    fn error_severity(&self, error: &ServerError) -> ErrorSeverity {
        if !self.authenticated || error.path.is_empty() {
            return ErrorSeverity::Client;
        }
        match error_code(error) {
            Some(code)
                if !code
                    .to_ascii_uppercase()
                    .starts_with(SERVER_ERROR_CODE_PREFIX) =>
            {
                ErrorSeverity::Client
            }
            _ => ErrorSeverity::Server,
        }
    }

    fn log_error(&self, span: &Span, error: &ServerError, error_count: usize) {
        let resource = self.resource_name();
        let path = error_path(&error.path);
        let code = loggable_error_code(error);
        macro_rules! log_graphql_error {
            ($level:expr, $text:expr) => {
                tracing::event!(
                    parent: span,
                    $level,
                    "graphql.resource" = resource.as_str(),
                    "graphql.operation.type" = self.kind.map(tracing::field::display),
                    "graphql.operation.name" = self.name.as_deref(),
                    "graphql.error.path" = path.as_deref(),
                    "graphql.error.code" = code,
                    "graphql.error_count" = error_count,
                    "{}",
                    $text
                )
            };
        }
        match self.error_severity(error) {
            ErrorSeverity::Server => log_graphql_error!(Level::ERROR, SERVER_ERROR_TEXT),
            ErrorSeverity::Client => log_graphql_error!(Level::WARN, CLIENT_ERROR_TEXT),
        }
    }
}

/// Mirrors async-graphql's operation selection in `Schema::execute`.
fn select_operation<'a>(
    operations: &'a DocumentOperations,
    requested_name: Option<&'a str>,
) -> Option<(Option<&'a str>, OperationType)> {
    match (operations, requested_name) {
        (DocumentOperations::Single(operation), None) => Some((None, operation.node.ty)),
        (DocumentOperations::Single(_), Some(_)) => None,
        (DocumentOperations::Multiple(operations), Some(name)) => operations
            .get(name)
            .map(|operation| (Some(name), operation.node.ty)),
        (DocumentOperations::Multiple(operations), None) if operations.len() == 1 => operations
            .iter()
            .next()
            .map(|(name, operation)| (Some(name.as_str()), operation.node.ty)),
        (DocumentOperations::Multiple(_), None) => None,
    }
}

fn truncate_operation_name(name: &str) -> String {
    name.chars().take(MAX_OPERATION_NAME_CHARS).collect()
}

fn error_code(error: &ServerError) -> Option<&str> {
    match error.extensions.as_ref()?.get("code")? {
        Value::String(code) => Some(code.as_str()),
        Value::Enum(code) => Some(code.as_str()),
        _ => None,
    }
}

/// Codes are server-chosen identifiers such as `NOT_FOUND`. Anything else is
/// replaced so a code built from input cannot carry it into telemetry.
fn loggable_error_code(error: &ServerError) -> Option<&str> {
    error_code(error).map(|code| {
        let is_identifier = !code.is_empty()
            && code.len() <= MAX_ERROR_CODE_CHARS
            && code
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        if is_identifier {
            code
        } else {
            UNRECOGNIZED_ERROR_CODE
        }
    })
}

/// Fixed text plus the error code, never the error message.
fn status_description(error: &ServerError) -> String {
    match loggable_error_code(error) {
        Some(code) => format!("{SERVER_ERROR_TEXT}: {code}"),
        None => SERVER_ERROR_TEXT.to_owned(),
    }
}

/// `user.soup.items.3.name`; `None` for request-level errors. GraphQL names
/// are limited to `[_A-Za-z][_0-9A-Za-z]*`, so segments cannot carry free text.
fn error_path(path: &[PathSegment]) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let segments: Vec<String> = path
        .iter()
        .map(|segment| match segment {
            PathSegment::Field(field) => field.clone(),
            PathSegment::Index(index) => index.to_string(),
        })
        .collect();
    Some(
        segments
            .join(".")
            .chars()
            .take(MAX_ERROR_PATH_CHARS)
            .collect(),
    )
}
