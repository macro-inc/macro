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

use crate::cursor::record::SseRecording;
use crate::cursor::wire::{
    CreateAgentRequest, CreateAgentResponse, CreateRunRequest, CreateRunResponse,
    McpServerSelection, ModelSelection, PromptBody, RepoSelection,
};
use crate::domain::event::CursorEvent;
use crate::domain::model::{CursorAgentId, CursorRunId, McpServer, RepoUrl};
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

/// A Cursor API key that never prints itself.
///
/// The key used to be a bare `String` in a `Debug`-deriving config, so a
/// single `tracing::debug!(?config)` — or any `{:?}` on the client — wrote a
/// live credential into the user's log file. A newtype whose `Debug` redacts
/// makes that unrepresentable; the plaintext leaves only through
/// [`ApiKey::expose`], which is the Basic-auth header and nothing else.
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    /// Wrap a key.
    ///
    /// Keys routinely arrive from JSON `env` blocks with surrounding quotes
    /// or a trailing newline, which the API rejects as an *invalid* key rather
    /// than a malformed header — so the key is trimmed and unquoted here,
    /// before anything validates or sends it.
    #[must_use]
    pub fn new(key: impl AsRef<str>) -> Self {
        Self(
            key.as_ref()
                .trim()
                .trim_matches(|character| character == '"' || character == '\'')
                .to_owned(),
        )
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
    /// The key is missing or does not look like a Cursor key. Caught here so
    /// a placeholder (`"..."`) fails at startup with a message instead of at
    /// the first prompt with a bare 401.
    #[error(
        "CURSOR_API_KEY does not look like a Cursor key (got {length} chars starting {prefix:?}, expected a \"crsr_\" prefix)"
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
        // No global timeout: the run stream is long-lived by design.
        let http = reqwest::Client::builder().build()?;
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
}

impl CursorAgents for CursorClient {
    #[tracing::instrument(skip(self, prompt), err)]
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        mcp_servers: &[McpServer],
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
            model: self.config.model.clone().map(|id| ModelSelection { id }),
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
    ) -> Result<CursorRunId, rootcause::Report> {
        let request = CreateRunRequest {
            prompt: PromptBody {
                text: prompt.to_owned(),
            },
        };
        let reply: CreateRunResponse = self
            .post_json(&format!("/v1/agents/{agent}/runs"), &request)
            .await?;
        Ok(CursorRunId::new(reply.into_run_id()))
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
}

impl RunStream for CursorClient {
    async fn stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<impl Stream<Item = Result<CursorEvent, rootcause::Report>> + Send, rootcause::Report>
    {
        let response = self
            .http
            .get(self.url(&format!("/v1/agents/{agent}/runs/{run}/stream")))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|error| rootcause::report!(error))?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(rootcause::report!("cursor stream -> {status}: {text}"));
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
