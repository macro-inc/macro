//! Live trigger stream: hold `GET /webhook/events/stream` open as this
//! harness, covering every agent currently bound to it.
//!
//! The body is Server-Sent Events, decoded by `eventsource-stream`. Each
//! event's `data` is the same broker envelope persisted webhooks deliver,
//! decoded straight into the caller's envelope type, and its `id` is the
//! cursor: opening with the last id seen (`Last-Event-ID`) first replays the
//! events the service still retains after it, so a reconnect loses nothing
//! published in between.

use std::collections::BTreeSet;
use std::marker::PhantomData;
use std::pin::Pin;
use std::time::{Duration, SystemTime};

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

/// The service refused this harness's credentials: unlike a failed request,
/// retrying does not help, and nothing may keep reading as this harness.
#[derive(Debug, thiserror::Error)]
#[error(
    "the service refused this harness's credentials ({status}) while trying to {what}; the \
     harness was likely removed - press p to pair again"
)]
pub struct CredentialsRefused {
    status: reqwest::StatusCode,
    what: &'static str,
}

/// Map the harness's current team grants onto its webhook workspace scope.
pub fn stream_scope(harness: &Harness) -> WebhookScope {
    if harness.shared_team_ids.is_empty() {
        WebhookScope::User
    } else {
        WebhookScope::Team
    }
}

/// The agents bound to a harness, as one read found them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundAgents {
    /// Sorted, unique bot ids, the shape the stream filter carries.
    pub bot_ids: Vec<String>,
    /// A time on the service's clock no later than the read: comparable with
    /// the event ids it mints, whatever this machine's clock says. `None`
    /// when the service sent no `Date`.
    pub read_by: Option<SystemTime>,
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
        Ok(self.read_dated(what, request).await?.0)
    }

    /// [`Self::read`], with the service's clock when it answered (its
    /// `Date` header), when it sent one.
    async fn read_dated<T: DeserializeOwned>(
        &self,
        what: &'static str,
        request: reqwest::RequestBuilder,
    ) -> rootcause::Result<(T, Option<SystemTime>)> {
        let response = self
            .credentialed(request)
            .timeout(ANSWER_TIMEOUT)
            .send()
            .await
            .context(format!("could not reach the service to {what}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(rootcause::report!(CredentialsRefused { status, what }).into_dynamic());
        }
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to {what}: {message}");
        }
        let answered_at = response
            .headers()
            .get(reqwest::header::DATE)
            .and_then(|date| date.to_str().ok())
            .and_then(|date| chrono::DateTime::parse_from_rfc2822(date).ok())
            .map(SystemTime::from);
        let body = response
            .json()
            .await
            .context(format!("could not read the service's answer to {what}"))?;
        Ok((body, answered_at))
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

    /// The agents currently bound to this harness, and when, on the
    /// service's clock, the answer was true.
    pub async fn bound_agents(&self) -> rootcause::Result<BoundAgents> {
        let (agents, answered_at): (Vec<HarnessAgent>, _) = self
            .read_dated(
                "list this harness's agents",
                self.http.get(format!("{}/harnesses/me/agents", self.base)),
            )
            .await?;
        let ids: BTreeSet<String> = agents
            .into_iter()
            .map(|agent| agent.bot_id.to_string())
            .collect();
        Ok(BoundAgents {
            bot_ids: ids.into_iter().collect(),
            // `Date` has whole seconds, and the agents were read just before
            // it was stamped: a second earlier is safely before that read.
            read_by: answered_at.map(|at| at - Duration::from_secs(1)),
        })
    }

    /// Open `GET /webhook/events/stream` and start reading envelopes of
    /// type `E`, resuming after the event id `after` when there is one.
    #[tracing::instrument(skip(self, filters), err)]
    pub async fn connect<E: DeserializeOwned>(
        &self,
        filters: &[WebhookFilter],
        after: Option<&str>,
    ) -> rootcause::Result<EventStream<E>> {
        let filters =
            serde_json::to_string(filters).context("could not encode the stream filters")?;
        let scope = self.scope().await?;
        let mut request = self
            .http
            .get(format!("{}/webhook/events/stream", self.base))
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .query(&[
                ("scope", scope.to_string().as_str()),
                ("filters", filters.as_str()),
            ]);
        if let Some(after) = after {
            // Replay is opt-in on the service, so only this client resumes.
            request = request
                .header(LAST_EVENT_ID_HEADER, after)
                .query(&[("resume", "true")]);
        }
        // Bounds the wait for the response head only; the body streams on.
        let response = tokio::time::timeout(ANSWER_TIMEOUT, self.credentialed(request).send())
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
            last_event_id: None,
            _envelope: PhantomData,
        })
    }
}

/// The SSE header a stream resumes after.
const LAST_EVENT_ID_HEADER: &str = "Last-Event-ID";

/// A cursor at `time`: the first UUIDv7 of that millisecond, so a stream
/// resumed with it replays every retained event from then on.
pub fn cursor_at(time: std::time::SystemTime) -> String {
    let millis = time
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        });
    uuid::Builder::from_unix_timestamp_millis(millis, &[0; 10])
        .into_uuid()
        .to_string()
}

type SseEvents =
    Pin<Box<dyn Stream<Item = Result<Event, EventStreamError<reqwest::Error>>> + Send>>;

/// An open SSE response, yielding one decoded envelope at a time.
pub struct EventStream<E> {
    events: SseEvents,
    last_event_id: Option<String>,
    _envelope: PhantomData<E>,
}

impl<E: DeserializeOwned> EventStream<E> {
    /// The id of the last event this stream delivered or skipped: where the
    /// next stream resumes.
    pub fn last_event_id(&self) -> Option<&str> {
        self.last_event_id.as_deref()
    }

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
            if !event.id.is_empty() {
                self.last_event_id = Some(event.id.clone());
            }
            match serde_json::from_str(&event.data) {
                Ok(value) => return Ok(Some(value)),
                Err(error) => {
                    tracing::debug!(error = ?error, id = %event.id, "undecodable SSE data; skipped");
                }
            }
        }
    }
}
