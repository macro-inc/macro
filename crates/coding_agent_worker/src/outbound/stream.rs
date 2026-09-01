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

use eventsource_stream::{Event, EventStreamError, Eventsource as _};
use futures::{Stream, StreamExt as _};
use harnesses::domain::models::HarnessAgent;
use rootcause::prelude::ResultExt as _;
use serde::de::DeserializeOwned;
use webhook::domain::models::{WebhookFilter, WebhookScope};

use crate::config::MacroApi;
use crate::outbound::credentials::{HarnessCredentials, HarnessScope};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// Map the harness's ownership onto the stream query's workspace scope.
pub fn stream_scope(scope: HarnessScope) -> WebhookScope {
    match scope {
        HarnessScope::User => WebhookScope::User,
        HarnessScope::Team => WebhookScope::Team,
    }
}

/// Client for the storage service's live event stream, acting as one harness.
pub struct EventStreamClient {
    http: reqwest::Client,
    base: String,
    token: String,
    scope: WebhookScope,
}

impl EventStreamClient {
    /// Build a client from the daemon's config and paired credentials.
    pub fn new(config: &MacroApi, credentials: &HarnessCredentials) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: config.storage_url.trim_end_matches('/').to_owned(),
            token: credentials.token.clone(),
            scope: stream_scope(credentials.scope),
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
        let response = self
            .credentialed(
                self.http
                    .get(format!("{}/webhook/events/stream", self.base))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .query(&[
                        ("scope", self.scope.to_string().as_str()),
                        ("filters", filters.as_str()),
                    ]),
            )
            .send()
            .await
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
