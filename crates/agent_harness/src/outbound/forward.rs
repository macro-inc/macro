//! HTTP implementation of [`CommandForwarder`]: one authenticated POST to the
//! managing replica's internal forward route, awaited for its result.
//!
//! Direct replica-to-replica, not through the load balancer: the target
//! address is the peer's own private URL as published with its heartbeat, so
//! the command lands on exactly the process holding the session's actor.

use agent_session::domain::model::{AgentSessionId, ReplicaAddress};
use reqwest::StatusCode;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CommandOutcome, HarnessCommand};
use crate::domain::ports::CommandForwarder;

/// Header carrying the deployment's shared internal key, as
/// `macro_authorization`'s internal extractor reads it.
const INTERNAL_API_KEY_HEADER: &str = macro_authorization::INTERNAL_API_KEY_HEADER;

/// Forwards commands to peer replicas over their internal HTTP surface.
#[derive(Clone)]
pub struct HttpCommandForwarder {
    client: reqwest::Client,
    internal_api_key: String,
}

impl HttpCommandForwarder {
    /// A forwarder authenticating with the deployment's internal key.
    ///
    /// The timeout bounds the whole forwarded execution, not just the dial:
    /// the peer replies only once the command ran, and a Deliver can sit
    /// behind a sandbox resume, so this is generous rather than snappy.
    pub fn new(internal_api_key: String) -> Result<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(2))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| HarnessError::Forward(rootcause::report!(error).into_dynamic()))?;
        Ok(Self {
            client,
            internal_api_key,
        })
    }
}

impl CommandForwarder for HttpCommandForwarder {
    #[tracing::instrument(
        err,
        skip(self, command),
        fields(
            %target,
            %session,
            http.response.status_code = tracing::field::Empty,
        )
    )]
    async fn forward(
        &self,
        target: &ReplicaAddress,
        session: AgentSessionId,
        command: HarnessCommand,
    ) -> Result<CommandOutcome> {
        let url = format!(
            "{}/internal/agent-sessions/{}/command",
            target.as_str().trim_end_matches('/'),
            session
        );
        // The peer's inbound layer already extracts `traceparent` and parents
        // its request span to the remote span (see `macro_tower_layers`), so
        // injecting here is what makes a forwarded command one trace spanning
        // both replicas. Without it the hop is two unrelated traces.
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(url)
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .headers(headers)
            .json(&command)
            .send()
            .await
            .map_err(|error| HarnessError::Forward(rootcause::report!(error).into_dynamic()))?;
        let status = response.status();
        tracing::Span::current().record("http.response.status_code", status.as_u16());
        if status.is_success() {
            // A body-less success (an older peer's 204, mid-deploy) reads as
            // completed: that was the only outcome such a peer could produce.
            return Ok(response
                .json::<CommandOutcome>()
                .await
                .unwrap_or(CommandOutcome::Completed));
        }
        let body = response.text().await.unwrap_or_default();
        // 409 is the peer saying "not attached here after all" - the caller's
        // stale-view fallback keys off any error, but keep the distinction
        // visible in the report for whoever reads the logs.
        let refused = if status == StatusCode::CONFLICT {
            "the peer refused the session"
        } else {
            "the peer failed the command"
        };
        Err(HarnessError::Forward(rootcause::report!(
            "{refused}: {status}: {body}"
        )))
    }
}
