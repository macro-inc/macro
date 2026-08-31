//! The Cursor cloud API client.
//!
//! A plain reqwest wrapper over `api.cursor.com`'s Cloud Agents API — create
//! an agent, follow up with runs, cancel, and stream a run's SSE events. It
//! knows nothing about ACP; it implements the domain's
//! [`CursorAgents`]/[`RunStream`] ports and speaks the domain's
//! [`CursorEvent`] vocabulary at its boundary.
//!
//! Authentication is HTTP Basic with the API key as username and an empty
//! password, per Cursor's docs. The key is validated for shape at
//! construction so a placeholder pasted into a config fails at startup with
//! a message, not at first prompt with a bare 401.

#[cfg(test)]
mod test;

/// Capturing raw SSE bytes as fixtures.
pub mod record;

/// Request/response DTOs for the endpoints this crate uses.
pub mod wire;

use crate::api::record::SseRecording;
use crate::api::wire::{
    AgentSummary, ArchiveAgentResponse, CreateAgentRequest, CreateAgentResponse, CreateRunRequest,
    CreateRunResponse, ListAgentsResponse, ListModelsResponse, ListRunsResponse,
    McpServerSelection, MeResponse, ModelSelection, PromptBody, RepoSelection, RunDetail,
};
use crate::domain::event::CursorEvent;
use crate::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, ModelParam, ModelVariant,
    RepoUrl, RunListing, RunOutcome,
};
use crate::domain::ports::{CursorAgents, RunStream};
use futures::{Stream, StreamExt as _};
use sse_core::SseEvent;
use std::collections::VecDeque;
use std::num::NonZeroUsize;

/// The largest single SSE record payload this agent will buffer, 16 MiB.
///
/// A bound is required rather than optional: without one, a stream that never
/// sends a blank line grows a buffer until the process dies, which the
/// hand-rolled decoder this replaced was quietly vulnerable to.
///
/// 16 MiB rather than `sse_core`'s 512 KiB default because Cursor's tool
/// results embed whole file contents — a `read_file` on a large source file is
/// ordinary traffic, not an attack, and a run should not fail for it. The
/// largest payload in the recorded corpus is 7.7 KB, so this is far past any
/// legitimate one while still bounded. Shared with [`crate::replay`] so a
/// fixture decodes exactly as the wire does; a second limit somewhere else
/// would mean the corpus no longer tests what production runs.
///
/// Typed `NonZeroUsize` so the zero case is a compile error rather than a
/// runtime unwrap.
pub(crate) const MAX_SSE_PAYLOAD: NonZeroUsize = match NonZeroUsize::new(16 * 1024 * 1024) {
    Some(limit) => limit,
    None => panic!("the payload limit is a non-zero literal"),
};

/// The one real base url. A [`CursorConfig`] still names its own, because a
/// test points at a stand-in server, but there is nothing for a deployment to
/// choose between.
pub const CURSOR_API_BASE_URL: &str = "https://api.cursor.com";

/// A Cursor API key that never prints itself and does not outlive its client.
///
/// The key used to be a bare `String` in a `Debug`-deriving config, so a
/// single `tracing::debug!(?config)` — or any `{:?}` on the client — wrote a
/// live credential into the user's log file. A newtype whose `Debug` redacts
/// makes that unrepresentable; the plaintext leaves only through
/// [`ApiKey::expose`], which is the Basic-auth header and nothing else.
///
/// `Zeroizing` because server-side these are *users'* keys, decrypted per
/// session and held for as long as the session's client lives. That is a copy
/// per concurrent session in a long-lived process, so the least it can do is
/// not linger in freed memory once the session ends.
#[derive(Clone)]
pub struct ApiKey(zeroize::Zeroizing<String>);

impl ApiKey {
    /// Wrap a key.
    ///
    /// Keys routinely arrive from JSON `env` blocks with surrounding quotes
    /// or a trailing newline, which the API rejects as an *invalid* key rather
    /// than a malformed header — so the key is trimmed and unquoted here,
    /// before anything validates or sends it.
    #[must_use]
    pub fn new(key: impl AsRef<str>) -> Self {
        Self(zeroize::Zeroizing::new(
            key.as_ref()
                .trim()
                .trim_matches(|character| character == '"' || character == '\'')
                .to_owned(),
        ))
    }

    /// The plaintext key. Only for handing to the transport that authenticates
    /// with it — never for logging.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ApiKey(redacted)")
    }
}

/// Static configuration for a [`CursorClient`].
#[derive(Debug, Clone)]
pub struct CursorConfig {
    /// The API key (`crsr_…`).
    pub api_key: ApiKey,
    /// Base url, `https://api.cursor.com` outside tests.
    pub base_url: String,
    /// Model id to request, or the server default when `None`.
    pub model: Option<String>,
    /// Starting ref for new agents' repos.
    pub starting_ref: String,
    /// Where to record each run's raw SSE bytes, for turning real traffic
    /// into fixtures. `None` records nothing, which is the default.
    pub record_dir: Option<std::path::PathBuf>,
}

/// Why a [`CursorClient`] could not be constructed.
#[derive(Debug, thiserror::Error)]
pub enum CursorClientError {
    /// The key does not look like a Cursor key. Caught here so a placeholder
    /// (`"..."`) fails when the client is built, with a message, instead of at
    /// the first prompt with a bare 401. The length and prefix are the only
    /// diagnostics that are safe to print: enough to recognize a placeholder
    /// or a stray quote, never enough to reconstruct a real key.
    #[error(
        "not a Cursor API key (got {length} chars starting {prefix:?}, expected a \"crsr_\" prefix)"
    )]
    MalformedKey {
        /// Length of the offending key.
        length: usize,
        /// Its first few characters, for recognizing a placeholder.
        prefix: String,
    },
    /// The underlying HTTP client could not be built.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

/// The Cursor cloud API client.
#[derive(Debug, Clone)]
pub struct CursorClient {
    http: reqwest::Client,
    config: CursorConfig,
}

impl CursorClient {
    /// Build a client, validating the key's shape.
    ///
    /// [`ApiKey::new`] has already trimmed the stray quotes and newlines a key
    /// picks up in transit, so what is checked here is the key itself.
    pub fn new(config: CursorConfig) -> Result<Self, CursorClientError> {
        let key = config.api_key.expose();
        if !key.starts_with("crsr_") {
            return Err(CursorClientError::MalformedKey {
                length: key.len(),
                prefix: key.chars().take(4).collect(),
            });
        }
        // No global timeout — the run stream is long-lived by design — but a
        // bounded connect: a peer that neither answers nor closes would
        // otherwise hang a caller forever, and the session poller runs its
        // idle check between calls, so one wedged call is a session that
        // never retires.
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()?;
        Ok(Self { http, config })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.config.base_url)
    }

    /// POST a JSON body and decode a JSON response, mapping non-2xx statuses
    /// to reports that carry the body — Cursor's error bodies are the only
    /// diagnostic there is.
    async fn post_json<Body, Reply>(
        &self,
        path: &str,
        body: &Body,
    ) -> Result<Reply, rootcause::Report>
    where
        Body: serde::Serialize + Sync,
        Reply: serde::de::DeserializeOwned,
    {
        let response = self
            .http
            .post(self.url(path))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .json(body)
            .send()
            .await
            .map_err(|error| rootcause::report!(error))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| rootcause::report!(error))?;
        if !status.is_success() {
            return Err(rootcause::report!("cursor POST {path} -> {status}: {text}"));
        }
        serde_json::from_str(&text)
            .map_err(|error| rootcause::report!("cursor POST {path}: bad response body: {error}"))
    }

    /// GET a JSON response, mapping non-2xx statuses to reports that carry
    /// the body, same as [`Self::post_json`].
    async fn get_json<Reply>(&self, path: &str) -> Result<Reply, rootcause::Report>
    where
        Reply: serde::de::DeserializeOwned,
    {
        let response = self
            .http
            .get(self.url(path))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .send()
            .await
            .map_err(|error| rootcause::report!(error))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| rootcause::report!(error))?;
        if !status.is_success() {
            return Err(rootcause::report!("cursor GET {path} -> {status}: {text}"));
        }
        serde_json::from_str(&text)
            .map_err(|error| rootcause::report!("cursor GET {path}: bad response body: {error}"))
    }

    /// Fetch one agent's durable record.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_agent(
        &self,
        agent: &CursorAgentId,
    ) -> Result<AgentSummary, rootcause::Report> {
        self.get_json(&format!("/v1/agents/{agent}")).await
    }

    /// Fetch one page of the key's agents, newest first.
    ///
    /// `cursor` is the previous page's `next_cursor`; `None` starts from the
    /// top. Pagination is the caller's loop — the manager reconciling on boot
    /// decides how far back is worth walking.
    #[tracing::instrument(skip(self), err)]
    pub async fn list_agents(
        &self,
        limit: u32,
        cursor: Option<&str>,
    ) -> Result<ListAgentsResponse, rootcause::Report> {
        let path = match cursor {
            Some(cursor) => format!("/v1/agents?limit={limit}&cursor={cursor}"),
            None => format!("/v1/agents?limit={limit}"),
        };
        self.get_json(&path).await
    }

    /// Archive an agent: readable but closed to new runs. Idempotent, and
    /// deliberately not delete — teardown of a session must not destroy work
    /// the agent's owner may still want on cursor.com.
    #[tracing::instrument(skip(self), err)]
    pub async fn archive_agent(&self, agent: &CursorAgentId) -> Result<(), rootcause::Report> {
        let _: ArchiveAgentResponse = self
            .post_json(
                &format!("/v1/agents/{agent}/archive"),
                &serde_json::json!({}),
            )
            .await?;
        Ok(())
    }

    /// Identify the configured API key. The cheap call that proves the key is
    /// live, for a boot-time health check.
    #[tracing::instrument(skip(self), err)]
    pub async fn me(&self) -> Result<MeResponse, rootcause::Report> {
        self.get_json("/v1/me").await
    }
}

impl CursorAgents for CursorClient {
    #[tracing::instrument(skip_all, err, fields(mcp_servers = mcp_servers.len()))]
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        mcp_servers: &[McpServer],
        model: Option<&ModelChoice>,
    ) -> Result<(CursorAgentId, CursorRunId), rootcause::Report> {
        let request = CreateAgentRequest {
            prompt: PromptBody {
                text: prompt.to_owned(),
            },
            repos: repo
                .map(|repo| {
                    vec![RepoSelection {
                        url: repo.as_str().to_owned(),
                        starting_ref: self.config.starting_ref.clone(),
                    }]
                })
                .unwrap_or_default(),
            model: model.map(ModelSelection::from),
            mcp_servers: mcp_servers.iter().map(McpServerSelection::from).collect(),
        };
        let reply: CreateAgentResponse = self.post_json("/v1/agents", &request).await?;
        tracing::info!(agent = %reply.agent.id, url = %reply.agent.url, "cursor agent created");
        Ok((
            CursorAgentId::new(reply.agent.id),
            CursorRunId::new(reply.run.id),
        ))
    }

    #[tracing::instrument(skip(self, prompt), err)]
    async fn create_run(
        &self,
        agent: &CursorAgentId,
        prompt: &str,
        model: Option<&ModelChoice>,
    ) -> Result<CursorRunId, rootcause::Report> {
        let request = CreateRunRequest {
            prompt: PromptBody {
                text: prompt.to_owned(),
            },
            model: model.map(ModelSelection::from),
        };
        let reply: CreateRunResponse = self
            .post_json(&format!("/v1/agents/{agent}/runs"), &request)
            .await?;
        Ok(CursorRunId::new(reply.into_run_id()))
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_models(&self) -> Result<Vec<CursorModel>, rootcause::Report> {
        let reply: ListModelsResponse = self.get_json("/v1/models").await?;
        Ok(reply
            .items
            .into_iter()
            .map(|listing| CursorModel {
                display_name: listing.display_name.unwrap_or_else(|| listing.id.clone()),
                id: listing.id,
                variants: listing
                    .variants
                    .into_iter()
                    .map(|variant| ModelVariant {
                        params: variant
                            .params
                            .into_iter()
                            .map(|param| ModelParam {
                                id: param.id,
                                value: param.value,
                            })
                            .collect(),
                        is_default: variant.is_default,
                    })
                    .collect(),
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn cancel_run(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<(), rootcause::Report> {
        let _: serde_json::Value = self
            .post_json(
                &format!("/v1/agents/{agent}/runs/{run}/cancel"),
                &serde_json::json!({}),
            )
            .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn run_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<RunOutcome, rootcause::Report> {
        let detail: RunDetail = self
            .get_json(&format!("/v1/agents/{agent}/runs/{run}"))
            .await?;
        Ok(RunOutcome {
            status: detail.status,
            text: detail.result,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_runs(&self, agent: &CursorAgentId) -> Result<Vec<RunListing>, rootcause::Report> {
        // One page is plenty: the caller walks back only to the last run it
        // drove itself, which is at most one cursor.com visit ago.
        let page: ListRunsResponse = self
            .get_json(&format!("/v1/agents/{agent}/runs?limit=20"))
            .await?;
        Ok(page
            .items
            .into_iter()
            .map(|item| RunListing {
                id: CursorRunId::new(item.id),
                status: item.status,
            })
            .collect())
    }
}

/// How many times a run's stream is connected before an unavailable stream
/// is the turn's failure.
const STREAM_CONNECT_ATTEMPTS: usize = 5;

/// Pause between stream connect attempts. The window being papered over is
/// the second or so between a run's creation and its stream existing.
const STREAM_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(400);

impl RunStream for CursorClient {
    async fn stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<impl Stream<Item = Result<CursorEvent, rootcause::Report>> + Send, rootcause::Report>
    {
        // A stream opened right after `POST …/runs` can answer
        // `stream_unavailable` before the run's stream is provisioned —
        // observed on follow-up runs, whose create-to-stream gap is much
        // shorter than a first run's, and in both shapes the endpoint uses:
        // a 200 whose first event is an `error`, and an outright 409. The
        // run itself is fine (it finishes server-side), so an unavailable
        // stream at the head is a reason to reconnect, not to fail the turn.
        // Only the head: the same error after real events means the stream
        // genuinely went away.
        let mut attempt = 1;
        loop {
            let mut stream = match self.connect_stream(agent, run).await {
                Ok(stream) => Box::pin(stream),
                Err(StreamConnectError::Unavailable(message))
                    if attempt < STREAM_CONNECT_ATTEMPTS =>
                {
                    tracing::info!(%agent, %run, attempt, %message, "run stream not up yet; reconnecting");
                    attempt += 1;
                    tokio::time::sleep(STREAM_RETRY_DELAY).await;
                    continue;
                }
                Err(StreamConnectError::Unavailable(message)) => {
                    return Err(rootcause::report!(
                        "cursor stream unavailable after {STREAM_CONNECT_ATTEMPTS} connects: {message}"
                    ));
                }
                Err(StreamConnectError::Other(report)) => return Err(report),
            };
            let mut leading = Vec::new();
            let retry = loop {
                match stream.next().await {
                    Some(Ok(event @ (CursorEvent::Status { .. } | CursorEvent::Heartbeat))) => {
                        leading.push(Ok(event));
                    }
                    Some(Ok(CursorEvent::Error { code, message }))
                        if code.as_deref() == Some("stream_unavailable")
                            && attempt < STREAM_CONNECT_ATTEMPTS =>
                    {
                        tracing::info!(%agent, %run, attempt, %message, "run stream not up yet; reconnecting");
                        break true;
                    }
                    Some(event) => {
                        leading.push(event);
                        break false;
                    }
                    None => break false,
                }
            };
            if retry {
                attempt += 1;
                tokio::time::sleep(STREAM_RETRY_DELAY).await;
                continue;
            }
            // The buffered head replays before the live remainder, so the
            // caller sees one uninterrupted stream.
            return Ok(futures::stream::iter(leading).chain(stream));
        }
    }
}

/// Why one stream connect did not produce a stream: the endpoint saying the
/// stream is not there (retryable — it appears seconds after run creation),
/// or anything else (not).
enum StreamConnectError {
    /// `stream_unavailable`, as an HTTP status. Carries the server's message.
    Unavailable(String),
    /// Every other failure.
    Other(rootcause::Report),
}

impl CursorClient {
    async fn connect_stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<
        impl Stream<Item = Result<CursorEvent, rootcause::Report>> + Send + use<>,
        StreamConnectError,
    > {
        let response = self
            .http
            .get(self.url(&format!("/v1/agents/{agent}/runs/{run}/stream")))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|error| StreamConnectError::Other(rootcause::report!(error).into()))?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            if text.contains("stream_unavailable") {
                return Err(StreamConnectError::Unavailable(format!("{status}: {text}")));
            }
            return Err(StreamConnectError::Other(rootcause::report!(
                "cursor stream -> {status}: {text}"
            )));
        }

        // Recording taps the bytes before the decoder sees them, so a
        // fixture is byte-identical to the wire.
        let recording = match &self.config.record_dir {
            Some(dir) => SseRecording::create(dir, agent.as_str(), run.as_str()),
            None => SseRecording::disabled(),
        };

        // Decode incrementally: SSE records straddle read boundaries, so the
        // decoder holds a partial record in its own buffers and the unfold
        // drains whole ones only. One read can complete several records, hence
        // the queue.
        let state = (
            response.bytes_stream().boxed(),
            sse_core::SseDecoder::with_limit(MAX_SSE_PAYLOAD),
            VecDeque::new(),
            recording,
        );
        Ok(futures::stream::try_unfold(
            state,
            |(mut bytes, mut decoder, mut pending, mut recording)| async move {
                loop {
                    if let Some(event) = pending.pop_front() {
                        return Ok(Some((event, (bytes, decoder, pending, recording))));
                    }
                    match bytes.next().await {
                        Some(Ok(chunk)) => {
                            recording.write(&chunk);
                            let mut cursor = chunk;
                            while let Some(record) = decoder.next(&mut cursor) {
                                // A payload past the limit is the run's
                                // problem, not this stream's shape: report it
                                // and stop rather than resync mid-record.
                                let record = record.map_err(|error| {
                                    rootcause::report!(
                                        "cursor sse payload over {} bytes: {error}",
                                        MAX_SSE_PAYLOAD
                                    )
                                })?;
                                let SseEvent::Message(message) = record else {
                                    continue; // `retry:`; nothing reconnects yet
                                };
                                let data = serde_json::from_str(&message.data)
                                    .unwrap_or(serde_json::Value::Null);
                                pending.push_back(CursorEvent::from_wire(&message.event, data));
                            }
                        }
                        Some(Err(error)) => {
                            return Err(rootcause::report!(error).into_dynamic());
                        }
                        None => return Ok(None),
                    }
                }
            },
        ))
    }
}
