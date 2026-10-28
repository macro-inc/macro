//! Executing a request that has already been decided.
//!
//! The dumbest adapter in the crate, deliberately. By the time a request
//! arrives here it is addressed at its upstream and stamped with the right
//! credential, so there is nothing left to decide and nothing here should look
//! like a decision.

use http_body_util::{BodyDataStream, BodyExt};
use reqwest::redirect;

use crate::domain::error::EgressError;
use crate::domain::model::{BoxError, ProxyRequest, ProxyResponse};
use crate::domain::ports::Forwarder;

/// Forwards over a shared reqwest client.
pub struct ReqwestForwarder {
    client: reqwest::Client,
}

impl ReqwestForwarder {
    /// Build the forwarder.
    ///
    /// Two settings are load-bearing:
    ///
    /// - `redirect::Policy::none()`. reqwest follows up to ten redirects by
    ///   default, which would replay a request - stamped credential and all -
    ///   at whatever host the response named. A redirect is the upstream's
    ///   answer and belongs to the caller, who can decide about it.
    /// - no timeout. `Client::timeout` bounds the *whole* request including the
    ///   response body, and both bodies here are long-lived by design: an MCP
    ///   event stream stays open for a tool call, a packfile takes as long as
    ///   the repository is big.
    pub fn new() -> Result<Self, EgressError> {
        let client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .build()
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not build the egress http client: {error}"
                ))
            })?;

        Ok(Self { client })
    }
}

impl Forwarder for ReqwestForwarder {
    #[tracing::instrument(skip_all, err, fields(
        method = %request.method(),
        host = request.uri().host(),
        status = tracing::field::Empty,
    ))]
    async fn forward(&self, request: ProxyRequest) -> Result<ProxyResponse, EgressError> {
        // Streamed both ways. `wrap_stream` rather than `Body::wrap` because
        // the latter wants a `Sync` body and a request body arriving off a
        // socket is not one; the cost is trailers, which neither MCP nor git
        // sends.
        let request = request.map(|body| reqwest::Body::wrap_stream(BodyDataStream::new(body)));
        let request = reqwest::Request::try_from(request).map_err(|error| {
            EgressError::Internal(rootcause::report!("request is not sendable: {error}"))
        })?;

        let response = self.client.execute(request).await.map_err(|error| {
            EgressError::Upstream(rootcause::report!("upstream did not answer: {error}"))
        })?;
        tracing::Span::current().record("status", response.status().as_u16());

        // Statuses pass through untouched, including failures: MCP and git both
        // use them semantically, and swallowing a 401 into an error of our own
        // is how a caller ends up with an unexplained hang.
        let response: http::Response<reqwest::Body> = response.into();

        Ok(response.map(|body| {
            body.map_err(|error| Box::new(error) as BoxError)
                .boxed_unsync()
        }))
    }
}
