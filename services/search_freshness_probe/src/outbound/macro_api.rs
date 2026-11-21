//! Macro's public API through the gateway, authenticated as the probe user
//! with a user API key, the way an SDK client reaches it.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::{Method, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use tracing::field::Empty;

#[cfg(test)]
mod test;

/// The header a user API key travels in (crates/macro_auth `credential.rs`).
const API_KEY_HEADER: &str = "x-macro-user-api-key";
/// Longest one request may take, so a hung call fails its round instead of
/// stalling the type's probe.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Why a call to the API failed.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// The request did not complete: connect, TLS or timeout.
    #[error("{route} could not be reached")]
    Unreachable {
        /// The route, with its path parameters as placeholders.
        route: &'static str,
        /// The transport error.
        #[source]
        source: reqwest::Error,
    },
    /// The API answered with a status the call does not expect.
    #[error("{route} answered {status}")]
    Status {
        /// The route, with its path parameters as placeholders.
        route: &'static str,
        /// The status it answered.
        status: StatusCode,
    },
    /// The answer's body was not what the route returns.
    #[error("{route} answered a body that did not decode")]
    Undecodable {
        /// The route, with its path parameters as placeholders.
        route: &'static str,
        /// The decoding error.
        #[source]
        source: reqwest::Error,
    },
}

/// The probe's key could not go in a header.
#[derive(Debug, thiserror::Error)]
#[error("the probe user's API key is not a valid header value")]
pub struct InvalidApiKey;

/// A call to make: its method, route and path.
pub struct Call {
    method: Method,
    route: &'static str,
    path: String,
}

impl Call {
    /// A call to `path`, recorded on its span as `route`.
    pub fn new(method: Method, route: &'static str, path: String) -> Self {
        Self {
            method,
            route,
            path,
        }
    }
}

/// The API as the probe user.
#[derive(Clone)]
pub struct MacroApi {
    http: reqwest::Client,
    gateway: String,
}

impl MacroApi {
    /// A client of the gateway at `gateway` that sends `api_key` on every
    /// request.
    pub fn new(gateway: &str, api_key: &str) -> Result<Self, InvalidApiKey> {
        let mut key = HeaderValue::from_str(api_key).map_err(|_| InvalidApiKey)?;
        key.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(API_KEY_HEADER, key);
        // No redirects: reqwest strips only Authorization and Cookie when it
        // follows one to another host, so the key would go along.
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| InvalidApiKey)?;
        Ok(Self {
            http,
            gateway: gateway.trim_end_matches('/').to_owned(),
        })
    }

    /// Sends `call` with `body` and decodes its answer.
    pub async fn json<B: Serialize, R: DeserializeOwned>(
        &self,
        call: Call,
        body: Option<&B>,
    ) -> Result<R, ApiError> {
        let route = call.route;
        let response = self.send(call, body, &[]).await?;
        response
            .json()
            .await
            .map_err(|source| ApiError::Undecodable { route, source })
    }

    /// Sends `call` with `body`, expecting an answer with no body the probe
    /// reads. A status in `also_done` counts as done too: a delete that
    /// finds nothing left to delete has done its work.
    pub async fn send_done<B: Serialize>(
        &self,
        call: Call,
        body: Option<&B>,
        also_done: &[StatusCode],
    ) -> Result<(), ApiError> {
        self.send(call, body, also_done).await.map(|_| ())
    }

    #[tracing::instrument(
        name = "search.freshness_probe.request",
        err,
        skip_all,
        fields(
            otel.kind = "client",
            http.request.method = %call.method,
            http.route = call.route,
            http.response.status_code = Empty,
            otel.status_code = Empty,
        )
    )]
    async fn send<B: Serialize>(
        &self,
        call: Call,
        body: Option<&B>,
        also_done: &[StatusCode],
    ) -> Result<reqwest::Response, ApiError> {
        let span = tracing::Span::current();
        let Call {
            method,
            route,
            path,
        } = call;

        let mut headers = HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.gateway))
            .headers(headers);
        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request.send().await.map_err(|source| {
            span.record("otel.status_code", "ERROR");
            ApiError::Unreachable { route, source }
        })?;
        let status = response.status();
        span.record("http.response.status_code", status.as_u16());
        if status.is_success() || also_done.contains(&status) {
            return Ok(response);
        }
        span.record("otel.status_code", "ERROR");
        Err(ApiError::Status { route, status })
    }
}

/// No request body.
pub const NO_BODY: Option<&()> = None;
