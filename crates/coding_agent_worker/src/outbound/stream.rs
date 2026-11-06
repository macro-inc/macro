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
use harnesses::domain::models::{
    Harness, HarnessAgent, HarnessOwner, RUNTIME_CONNECTED_HEADER, ReportWorkspacesRequest,
    ReportedWorkspace,
};
use rootcause::prelude::ResultExt as _;
use serde::de::DeserializeOwned;
use webhook::domain::models::{WebhookFilter, WebhookScope};

use crate::config::{HarnessCredentials, MacroApi};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// Set on the presence request alone: a timeout on the client would also end the
/// long-lived event stream.
const PRESENCE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// Map the harness's ownership onto the stream query's workspace scope.
pub fn stream_scope(owner: &HarnessOwner) -> WebhookScope {
    match owner {
        HarnessOwner::User { .. } => WebhookScope::User,
        HarnessOwner::Team { .. } => WebhookScope::Team,
    }
}

/// Client for the storage service's live event stream, acting as one harness.
/// Also reads and reports the harness's own registration.
#[derive(Clone)]
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

    /// This harness's registration as the web last set it.
    pub async fn harness(&self) -> rootcause::Result<Harness> {
        self.read(
            "read this harness's settings",
            self.http.get(format!("{}/harnesses/me", self.base)),
        )
        .await
    }

    /// The workspace scope of this harness's owner, read from the server on
    /// every connect so an ownership change on the web applies without
    /// re-pairing.
    async fn scope(&self) -> rootcause::Result<WebhookScope> {
        Ok(stream_scope(&self.harness().await?.owner))
    }

    /// Tell the service which directories this harness's sessions may use,
    /// replacing its last report.
    #[tracing::instrument(
        name = "macrod.workspaces.report",
        skip_all,
        fields(workspaces = workspaces.len()),
        err
    )]
    pub async fn report_workspaces(
        &self,
        workspaces: Vec<ReportedWorkspace>,
    ) -> rootcause::Result<()> {
        let response = self
            .credentialed(
                self.http
                    .put(format!("{}/harnesses/me/workspaces", self.base))
                    .json(&ReportWorkspacesRequest { workspaces }),
            )
            .send()
            .await
            .context("could not reach the service to report this harness's workspaces")?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to the workspace report: {message}");
        }
        Ok(())
    }

    /// Whether the service reports this harness connected, telling it that this
    /// daemon holds a runtime connection so it can log any disagreement.
    pub async fn service_reports_connected(&self) -> rootcause::Result<bool> {
        let harness: Harness = self
            .read(
                "check this harness's presence",
                self.http
                    .get(format!("{}/harnesses/me", self.base))
                    .header(RUNTIME_CONNECTED_HEADER, "true")
                    .timeout(PRESENCE_CHECK_TIMEOUT),
            )
            .await?;
        Ok(harness.connected)
    }

    /// The agents currently bound to this harness.
    pub async fn bound_agents(&self) -> rootcause::Result<Vec<HarnessAgent>> {
        self.read(
            "list this harness's agents",
            self.http.get(format!("{}/harnesses/me/agents", self.base)),
        )
        .await
    }

    /// The agents currently bound to this harness, as sorted bot-id strings —
    /// the shape the stream filter carries.
    pub async fn bound_bot_ids(&self) -> rootcause::Result<Vec<String>> {
        let agents = self.bound_agents().await?;
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
        let response = self
            .credentialed(
                self.http
                    .get(format!("{}/webhook/events/stream", self.base))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .query(&[
                        ("scope", scope.to_string().as_str()),
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
