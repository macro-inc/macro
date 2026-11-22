//! Shared pacing and retry transport for fixed provider reads through a
//! user's connected app.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use connectors::domain::models::{ApiHandle, ApiRequest, ConnectorId, ConnectorsError};
use connectors::domain::service::ApiConnectionsService;
use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::Instant;

use crate::domain::model::TrackerError;

/// One account's request budget, retained across clients and retry delays.
#[derive(Debug)]
pub struct RequestPacer {
    next: tokio::sync::Mutex<Instant>,
    interval: Duration,
}

impl RequestPacer {
    /// Space requests by `interval`.
    pub fn new(interval: Duration) -> Self {
        Self {
            next: tokio::sync::Mutex::new(Instant::now()),
            interval,
        }
    }

    /// Wait while holding the scheduling lock so a rate-limit hold affects
    /// requests already queued, too.
    pub async fn wait(&self) {
        let mut next = self.next.lock().await;
        tokio::time::sleep_until(*next).await;
        *next = Instant::now() + self.interval;
    }

    /// Delay every request on this account.
    pub async fn hold(&self, delay: Duration) {
        let mut next = self.next.lock().await;
        *next = (*next).max(Instant::now() + delay);
    }
}

/// Opens a user's API access to one app and shares one request budget per
/// user and app across every client.
pub struct Connections<S> {
    service: Arc<S>,
    pacers: Mutex<HashMap<MacroUserIdStr<'static>, Arc<RequestPacer>>>,
    app: &'static str,
    interval: Duration,
}

impl<S: ApiConnectionsService> Connections<S> {
    /// Configure one app's connection lookup and request budget. `app` is
    /// the app's catalog slug, e.g. `linear`.
    pub fn new(service: Arc<S>, app: &'static str, interval: Duration) -> Self {
        Self {
            service,
            pacers: Mutex::new(HashMap::new()),
            app,
            interval,
        }
    }

    /// Open the user's API access to the app. A user whose connection gives
    /// no API access (or who has none) is not connected.
    pub async fn open(&self, user: &MacroUserIdStr<'static>) -> Result<Session<S>, TrackerError> {
        let app = ConnectorId::parse(self.app).map_err(|error| {
            TrackerError::Transport(rootcause::Report::new(error).into_dynamic())
        })?;
        let handle = self
            .service
            .connection(user, &app)
            .await
            .map_err(|error| TrackerError::Transport(rootcause::Report::new(error).into_dynamic()))?
            .ok_or(TrackerError::NotConnected)?;
        let pacer = self
            .pacers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(user.clone())
            .or_insert_with(|| Arc::new(RequestPacer::new(self.interval)))
            .clone();
        Ok(Session {
            service: self.service.clone(),
            handle,
            pacer,
        })
    }
}

/// A provider request through one user's connection. Provider clients keep
/// this private and expose only a closed enum of read requests.
pub struct Session<S> {
    service: Arc<S>,
    handle: ApiHandle,
    /// Shared account budget, including GraphQL complexity exhaustion.
    pub pacer: Arc<RequestPacer>,
}

impl<S: ApiConnectionsService> Session<S> {
    /// Send a fixed provider read, retrying transient and rate-limit failures.
    #[tracing::instrument(skip_all, fields(attempts, status), err)]
    pub async fn read(
        &self,
        method: Method,
        url: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, TrackerError> {
        for attempt in 0..5_u32 {
            self.pacer.wait().await;
            let response = self
                .service
                .call(
                    &self.handle,
                    ApiRequest {
                        method: method.clone(),
                        url: url.to_owned(),
                        headers: HeaderMap::from_iter([
                            (
                                http::header::CONTENT_TYPE,
                                http::HeaderValue::from_static("application/json"),
                            ),
                            (
                                http::header::ACCEPT,
                                http::HeaderValue::from_static("application/json"),
                            ),
                        ]),
                        body: body.cloned(),
                    },
                )
                .await;
            tracing::Span::current().record("attempts", attempt + 1);
            let response = match response {
                Ok(response) => response,
                // A grant that stopped working is not retried: the user must
                // connect again.
                Err(ConnectorsError::NeedsReauth(_)) => return Err(TrackerError::NotConnected),
                Err(error) if attempt == 4 => {
                    return Err(TrackerError::Transport(
                        rootcause::Report::new(error).into_dynamic(),
                    ));
                }
                Err(_) => {
                    self.pacer.hold(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
            };
            tracing::Span::current().record("status", response.status.as_u16());
            let value: serde_json::Value = serde_json::from_str(&response.body).unwrap_or_default();
            let graphql_limited = value
                .get("errors")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|errors| {
                    errors.iter().any(|error| {
                        error
                            .pointer("/extensions/code")
                            .and_then(serde_json::Value::as_str)
                            == Some("RATELIMITED")
                    })
                });
            if response.status == StatusCode::TOO_MANY_REQUESTS
                || response.status.is_server_error()
                || graphql_limited
            {
                if attempt < 4 {
                    // Linear returns millisecond epoch resets for both request
                    // and complexity budgets; never immediately retry a 200 rate error.
                    let reset = ["x-ratelimit-requests-reset", "x-ratelimit-complexity-reset"]
                        .iter()
                        .filter_map(|header| {
                            response
                                .headers
                                .get(*header)?
                                .to_str()
                                .ok()?
                                .parse::<u64>()
                                .ok()
                        })
                        .filter_map(|millis| {
                            std::time::UNIX_EPOCH
                                .checked_add(Duration::from_millis(millis))?
                                .duration_since(std::time::SystemTime::now())
                                .ok()
                        })
                        .max();
                    self.pacer
                        .hold(
                            response
                                .retry_after()
                                .or(reset)
                                .unwrap_or(Duration::from_secs(1 << attempt)),
                        )
                        .await;
                    continue;
                }
            } else if response.status.is_success() {
                return serde_json::from_str(&response.body)
                    .map_err(|error| TrackerError::Decode(error.to_string()));
            }
            if matches!(
                response.status,
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
            ) {
                return Err(TrackerError::Forbidden(response.status.as_u16()));
            }
            return Err(TrackerError::Upstream {
                status: response.status.as_u16(),
                message: response.body.chars().take(500).collect(),
            });
        }
        Err(TrackerError::Decode(
            "request retry budget exhausted".into(),
        ))
    }
}

#[cfg(test)]
mod test;
