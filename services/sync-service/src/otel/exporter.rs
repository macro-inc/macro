use std::{cell::RefCell, future::Future};

use super::model::ClosedSpan;
use super::proto::export_request;

const ENDPOINT_VAR: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";
const ENVIRONMENT_VAR: &str = "ENVIRONMENT";

/// Cap on buffered spans; spans past this are dropped (protects against
/// buffers growing while no exporter is configured).
const MAX_BUFFERED_SPANS: usize = 512;

struct ExporterConfig {
    endpoint: Option<String>,
    environment: Option<String>,
}

thread_local! {
    static BUFFER: RefCell<Vec<ClosedSpan>> = const { RefCell::new(Vec::new()) };
    static CONFIG: RefCell<Option<ExporterConfig>> = const { RefCell::new(None) };
}

/// Read exporter config from worker env vars once per isolate.
pub fn configure(env: &worker::Env) {
    CONFIG.with(|c| {
        let mut c = c.borrow_mut();
        if c.is_some() {
            return;
        }
        let get = |name: &str| {
            env.var(name)
                .ok()
                .map(|v| v.to_string())
                .filter(|s| !s.is_empty())
        };
        *c = Some(ExporterConfig {
            endpoint: get(ENDPOINT_VAR),
            environment: get(ENVIRONMENT_VAR),
        });
    });
}

pub(super) fn buffer_span(span: ClosedSpan) {
    BUFFER.with(|b| {
        let mut b = b.borrow_mut();
        if b.len() < MAX_BUFFERED_SPANS {
            b.push(span);
        }
    });
}

/// Drain the span buffer and, when an exporter endpoint is configured, return
/// a future that POSTs them as OTLP/JSON. Pass the future to `wait_until`
/// (`worker::Context` or DO `State`). `None` means nothing to export (an
/// unset endpoint drops the buffered spans).
pub fn flush(env: &worker::Env) -> Option<impl Future<Output = ()> + 'static> {
    configure(env);
    let spans = BUFFER.with(|b| std::mem::take(&mut *b.borrow_mut()));
    if spans.is_empty() {
        return None;
    }
    let (endpoint, environment) = CONFIG.with(|c| {
        let c = c.borrow();
        let c = c.as_ref()?;
        Some((c.endpoint.clone()?, c.environment.clone()))
    })?;

    // Serialize synchronously; a failure here means nothing to export (None).
    let body = serde_json::to_string(&export_request(spans, environment.as_deref())).ok()?;
    Some(async move {
        _ = post_spans(&endpoint, body)
            .await
            .inspect_err(|e| tracing::debug!(error = ?e, "otel span export failed"));
    })
}

/// Flush and hand the export to a `wait_until` (worker `Context` or DO
/// `State`) — the shared tail of every traced entry point, so no handler can
/// forget it and silently drop its spans.
pub fn flush_into(
    env: &worker::Env,
    wait_until: impl FnOnce(std::pin::Pin<Box<dyn Future<Output = ()> + 'static>>),
) {
    if let Some(export) = flush(env) {
        wait_until(Box::pin(export));
    }
}

async fn post_spans(endpoint: &str, body: String) -> worker::Result<()> {
    use worker::{Fetch, Method, Request, RequestInit};
    let mut req = Request::new_with_init(
        endpoint,
        RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(body.into())),
    )?;
    req.headers_mut()?.set("Content-Type", "application/json")?;
    let resp = Fetch::Request(req).send().await?;
    if resp.status_code() >= 300 {
        return Err(worker::Error::from(format!(
            "otel exporter returned {}",
            resp.status_code()
        )));
    }
    Ok(())
}
