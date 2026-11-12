//! Live trigger stream: hold `GET /webhook/events/stream` open as this
//! harness, covering every agent currently bound to it.
//!
//! The body is Server-Sent Events, decoded by `eventsource-stream`. Each
//! event's `data` is the same broker envelope persisted webhooks deliver,
//! decoded straight into the caller's envelope type. Delivery is
//! best-effort: a dropped connection misses events published while it was
//! down.

use std::collections::BTreeSet;
use std::marker::PhantomData;
use std::pin::Pin;
use std::time::Duration;

use eventsource_stream::{Event, EventStreamError, Eventsource as _};
use futures::{Stream, StreamExt as _};
use harnesses::domain::models::{Harness, HarnessAgent, RUNTIME_CONNECTED_HEADER};
use rootcause::prelude::ResultExt as _;
use serde::de::DeserializeOwned;
use webhook::domain::models::{WebhookFilter, WebhookScope};

use crate::config::{HarnessCredentials, MacroApi};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// How long the service has to answer a lookup (owner, bound agents, presence)
/// or to start answering the event stream, so a stalled request fails and is
/// retried instead of holding up trigger processing. Set per request: a timeout
/// on the client would also end the long-lived event stream.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);

/// Map the harness's current team grants onto its webhook workspace scope.
pub fn stream_scope(harness: &Harness) -> WebhookScope {
    if harness.shared_team_ids.is_empty() {
        WebhookScope::User
    } else {
        WebhookScope::Team
    }
}

/// Client for the storage service's live event stream, acting as one harness.
pub struct EventStreamClient {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl EventStreamClient {
    /// Build a client from the daemon's config and paired credentials.
    pub fn new(config: &MacroApi, credentials: &HarnessCredentials) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: config.storage_url.trim_end_matches('/').to_owned(),
            token: credentials.token.clone(),
        }
    }

    fn credentialed(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.header(HARNESS_TOKEN_HEADER, &self.token)
    }

    async fn read<T: DeserializeOwned>(
        &self,
        what: &'static str,
        request: reqwest::RequestBuilder,
    ) -> rootcause::Result<T> {
        let response = self
            .credentialed(request)
            .timeout(ANSWER_TIMEOUT)
            .send()
            .await
            .context(format!("could not reach the service to {what}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            rootcause::bail!(
                "the service refused this harness's credentials ({status}) while trying to \
                 {what}; the harness was likely removed - press p to pair again"
            );
        }
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to {what}: {message}");
        }
        Ok(response
            .json()
            .await
            .context(format!("could not read the service's answer to {what}"))?)
    }

    /// The workspace scope of this harness's current team grants, read from the server on
    /// every connect so sharing changes on the web apply without
    /// re-pairing.
    async fn scope(&self) -> rootcause::Result<WebhookScope> {
        let harness: Harness = self
            .read(
                "read this harness's owner",
                self.http.get(format!("{}/harnesses/me", self.base)),
            )
            .await?;
        Ok(stream_scope(&harness))
    }

    /// Whether the service reports this harness connected, telling it that this
    /// daemon holds a runtime connection so it can log any disagreement.
    pub async fn service_reports_connected(&self) -> rootcause::Result<bool> {
        let harness: Harness = self
            .read(
                "check this harness's presence",
                self.http
                    .get(format!("{}/harnesses/me", self.base))
                    .header(RUNTIME_CONNECTED_HEADER, "true"),
            )
            .await?;
        Ok(harness.connected)
    }

    /// The agents currently bound to this harness, as sorted bot-id strings —
    /// the shape the stream filter carries.
    pub async fn bound_bot_ids(&self) -> rootcause::Result<Vec<String>> {
        let agents: Vec<HarnessAgent> = self
            .read(
                "list this harness's agents",
                self.http.get(format!("{}/harnesses/me/agents", self.base)),
            )
            .await?;
        let ids: BTreeSet<String> = agents
            .into_iter()
            .map(|agent| agent.bot_id.to_string())
            .collect();
        Ok(ids.into_iter().collect())
    }

    /// Open `GET /webhook/events/stream` and start reading envelopes of
    /// type `E`.
    #[tracing::instrument(skip(self, filters), err)]
    pub async fn connect<E: DeserializeOwned>(
        &self,
        filters: &[WebhookFilter],
    ) -> rootcause::Result<EventStream<E>> {
        let filters =
            serde_json::to_string(filters).context("could not encode the stream filters")?;
        let scope = self.scope().await?;
        let request = self.credentialed(
            self.http
                .get(format!("{}/webhook/events/stream", self.base))
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .query(&[
                    ("scope", scope.to_string().as_str()),
                    ("filters", filters.as_str()),
                ]),
        );
        // Bounds the wait for the response head only; the body streams on.
        let response = tokio::time::timeout(ANSWER_TIMEOUT, request.send())
            .await
            .context("the service did not start answering the event stream in time")?
            .context("could not reach the service to open the event stream")?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to open the event stream: {message}");
        }
        Ok(EventStream {
            events: Box::pin(response.bytes_stream().eventsource()),
            _envelope: PhantomData,
        })
    }
}

type SseEvents =
    Pin<Box<dyn Stream<Item = Result<Event, EventStreamError<reqwest::Error>>> + Send>>;

/// An open SSE response, yielding one decoded envelope at a time.
pub struct EventStream<E> {
    events: SseEvents,
    _envelope: PhantomData<E>,
}

impl<E: DeserializeOwned> EventStream<E> {
    /// The next envelope, or `None` when the server closes.
    ///
    /// Keep-alive comments never surface as events; a `data` payload that
    /// does not decode as `E` is skipped rather than ending the stream.
    pub async fn next_event(&mut self) -> rootcause::Result<Option<E>> {
        loop {
            let Some(event) = self.events.next().await else {
                return Ok(None);
            };
            let event = event.context("could not read the event stream")?;
            match serde_json::from_str(&event.data) {
                Ok(value) => return Ok(Some(value)),
                Err(error) => {
                    tracing::debug!(error = ?error, id = %event.id, "undecodable SSE data; skipped");
                }
            }
        }
    }
}
