use std::{cell::RefCell, future::Future};

use super::WaitUntil;
use super::model::{ClosedLog, ClosedSpan};
use super::proto::{export_logs_request, export_traces_request};

const ENDPOINT_VAR: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";
const ENVIRONMENT_VAR: &str = "ENVIRONMENT";
const MAX_BUFFERED_SPANS: usize = 512;
const MAX_BUFFERED_LOGS: usize = 512;

struct ExporterConfig {
    endpoint: Option<String>,
    environment: Option<String>,
}

thread_local! {
    static SPAN_BUFFER: RefCell<Vec<ClosedSpan>> = const { RefCell::new(Vec::new()) };
    static LOG_BUFFER: RefCell<Vec<ClosedLog>> = const { RefCell::new(Vec::new()) };
    static CONFIG: RefCell<Option<ExporterConfig>> = const { RefCell::new(None) };
}

pub(super) fn configure(env: &worker::Env) {
    CONFIG.with(|config| {
        let mut config = config.borrow_mut();
        if config.is_some() {
            return;
        }
        let get = |name: &str| {
            env.var(name)
                .ok()
                .map(|value| value.to_string())
                .filter(|value| !value.is_empty())
        };
        *config = Some(ExporterConfig {
            endpoint: get(ENDPOINT_VAR),
            environment: get(ENVIRONMENT_VAR),
        });
    });
}

fn signal_endpoint(endpoint: &str, signal: &str) -> String {
    format!("{}/v1/{signal}", endpoint.trim_end_matches('/'))
}

pub(super) fn buffer_span(span: ClosedSpan) {
    SPAN_BUFFER.with(|buffer| {
        let mut buffer = buffer.borrow_mut();
        if buffer.len() < MAX_BUFFERED_SPANS {
            buffer.push(span);
        }
    });
}

pub(super) fn buffer_log(log: ClosedLog) {
    LOG_BUFFER.with(|buffer| {
        let mut buffer = buffer.borrow_mut();
        if buffer.len() < MAX_BUFFERED_LOGS {
            buffer.push(log);
        }
    });
}

fn flush() -> Option<impl Future<Output = ()> + 'static> {
    let spans = SPAN_BUFFER.with(|buffer| std::mem::take(&mut *buffer.borrow_mut()));
    let logs = LOG_BUFFER.with(|buffer| std::mem::take(&mut *buffer.borrow_mut()));
    if spans.is_empty() && logs.is_empty() {
        return None;
    }
    let (endpoint, environment) = CONFIG.with(|config| {
        let config = config.borrow();
        let config = config.as_ref()?;
        Some((config.endpoint.clone()?, config.environment.clone()))
    })?;

    let traces = if spans.is_empty() {
        None
    } else {
        Some((
            signal_endpoint(&endpoint, "traces"),
            serde_json::to_string(&export_traces_request(spans, environment.as_deref())).ok()?,
        ))
    };
    let logs = if logs.is_empty() {
        None
    } else {
        Some((
            signal_endpoint(&endpoint, "logs"),
            serde_json::to_string(&export_logs_request(logs, environment.as_deref())).ok()?,
        ))
    };

    Some(async move {
        if let Some((endpoint, body)) = traces {
            _ = post_signal(&endpoint, body)
                .await
                .inspect_err(|error| tracing::debug!(error = ?error, "otel trace export failed"));
        }
        if let Some((endpoint, body)) = logs {
            _ = post_signal(&endpoint, body)
                .await
                .inspect_err(|error| tracing::debug!(error = ?error, "otel log export failed"));
        }
    })
}

pub(super) fn flush_into(wait_until: &impl WaitUntil) {
    if let Some(export) = flush() {
        wait_until.wait_until(Box::pin(export));
    }
}

async fn post_signal(endpoint: &str, body: String) -> worker::Result<()> {
    use worker::{Fetch, Method, Request, RequestInit};

    let mut request = Request::new_with_init(
        endpoint,
        RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(body.into())),
    )?;
    request
        .headers_mut()?
        .set("Content-Type", "application/json")?;
    let response = Fetch::Request(request).send().await?;
    if response.status_code() >= 300 {
        return Err(worker::Error::from(format!(
            "otel exporter returned {}",
            response.status_code()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod test;
