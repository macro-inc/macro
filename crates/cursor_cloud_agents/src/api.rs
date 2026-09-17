//! The Cursor cloud API client.
//!
//! A plain reqwest wrapper over `api.cursor.com`'s Cloud Agents API — create
//! an agent, follow up with runs, cancel, and stream a run's SSE events. It
//! knows nothing about ACP; it implements the domain's
//! [`CursorAgents`]/[`RunStream`] ports, retaining native SSE records for
//! capture before the domain decodes them.
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
    AgentSummary, ArchiveAgentResponse, ArtifactDownloadResponse, ConversationResponse,
    CreateAgentRequest, CreateAgentResponse, CreateRunRequest, CreateRunResponse,
    ListAgentsResponse, ListArtifactsResponse, ListModelsResponse, ListRunsResponse,
    McpServerSelection, MeResponse, ModelSelection, PromptBody, RepoSelection,
};
use crate::domain::artifact::{ArtifactListing, FetchedArtifact};
use crate::domain::model::{
    ConversationLine, ConversationSpeaker, CursorAgentId, CursorModel, CursorRunId, McpServer,
    ModelChoice, ModelParam, ModelVariant, RepoUrl, RunListing,
};
use crate::domain::ports::{
    ConnectedStream, CursorAgents, CursorArtifacts, RunStream, StreamConnectError,
};
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

macro_env_var::maybe_env_vars! {
    /// Overrides [`CURSOR_API_BASE_URL`] when set. Only a local stack sets
    /// it, to point every Cursor call at a stand-in server; deployed
    /// environments leave it unset and talk to Cursor.
    pub struct CursorApiBaseUrl;
}

/// The Cursor API base url this process should call: the
/// `CURSOR_API_BASE_URL` override when set, else the one real
/// [`CURSOR_API_BASE_URL`].
#[must_use]
pub fn cursor_api_base_url() -> String {
    CursorApiBaseUrl::new()
        .map(|url| url.trim_end_matches('/').to_owned())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| CURSOR_API_BASE_URL.to_owned())
}

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

/// Cursor's error codes for "this key's account cannot reach that repository".
///
/// `repository_access` is the direct one: the repo exists but this account
/// cannot use it. `integration_not_connected` is the same wall one step
/// earlier — the GitHub app is not installed for the owner at all — and its
/// remedy is the same connect flow, which is why both map to one error.
///
/// Deliberately excluded: `repository_required` (the request sent no repo, a
/// bug here, not the user's), `validation_error` (a malformed url is ours to
/// fix), and `unauthorized`/`plan_required` (about the key, not the repo).
const REPOSITORY_ACCESS_CODES: [&str; 2] = ["repository_access", "integration_not_connected"];

/// Whether a create-agent failure means Cursor cannot reach the repository.
///
/// Matches only the documented envelope, `{"error": {"code": "…"}}`, and only
/// on a 4xx: an unrecognized body — a different code, a proxy's HTML, a 5xx —
/// is left to the generic path so a new failure mode is never mislabelled as
/// a repository the user must go connect.
fn repository_is_inaccessible(status: reqwest::StatusCode, body: &str) -> bool {
    if !status.is_client_error() || status == reqwest::StatusCode::REQUEST_TIMEOUT {
        return false;
    }
    serde_json::from_str::<crate::api::wire::ApiErrorEnvelope>(body)
        .is_ok_and(|envelope| REPOSITORY_ACCESS_CODES.contains(&envelope.error.code.as_str()))
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
        let (status, text) = self.post_for_text(path, body).await?;
        Self::decode_post(path, status, &text)
    }

    /// POST a JSON body and read the response back as status plus raw text.
    ///
    /// Split out of [`Self::post_json`] so a caller that classifies error
    /// bodies — [`Self::create_agent`] — sees the body itself rather than
    /// re-parsing it out of a formatted message.
    async fn post_for_text<Body>(
        &self,
        path: &str,
        body: &Body,
    ) -> Result<(reqwest::StatusCode, String), rootcause::Report>
    where
        Body: serde::Serialize + Sync,
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
        Ok((status, text))
    }

    /// Turn one POST's status and body into the reply or a report.
    fn decode_post<Reply>(
        path: &str,
        status: reqwest::StatusCode,
        text: &str,
    ) -> Result<Reply, rootcause::Report>
    where
        Reply: serde::de::DeserializeOwned,
    {
        if !status.is_success() {
            if status.is_client_error() && status != reqwest::StatusCode::REQUEST_TIMEOUT {
                return Err(
                    rootcause::report!(crate::domain::error::PromptRejected(format!(
                        "cursor POST {path} -> {status}: {text}"
                    )))
                    .into_dynamic(),
                );
            }
            return Err(rootcause::report!("cursor POST {path} -> {status}: {text}"));
        }
        serde_json::from_str(text)
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

    /// List the files an agent has written to its `artifacts/` directory —
    /// the screenshots and screen recordings a walkthrough produces.
    ///
    /// The listing is agent-scoped and cumulative: artifacts survive their
    /// run, and Cursor offers no run filter, so every turn sees everything
    /// every earlier turn wrote. A caller that wants "new since last turn"
    /// has to diff `path` plus `updated_at` against what it saw before —
    /// `path` alone is not enough, because an agent that reshoots a
    /// screenshot writes the same path again.
    #[tracing::instrument(skip(self), err)]
    pub async fn list_artifacts(
        &self,
        agent: &CursorAgentId,
    ) -> Result<ListArtifactsResponse, rootcause::Report> {
        self.get_json(&format!("/v1/agents/{agent}/artifacts"))
            .await
    }

    /// Ask for a presigned url to one artifact's bytes.
    ///
    /// `path` is a [`wire::ArtifactListing::path`] exactly as the listing gave it;
    /// Cursor requires it to be under `artifacts/` and rejects anything else.
    /// The url it answers with is good for fifteen minutes, so it is worth
    /// requesting when a caller is ready to fetch and not worth storing.
    #[tracing::instrument(skip(self), err)]
    pub async fn artifact_download_url(
        &self,
        agent: &CursorAgentId,
        path: &str,
    ) -> Result<ArtifactDownloadResponse, rootcause::Report> {
        self.get_json(&format!(
            "/v1/agents/{agent}/artifacts/download?path={}",
            urlencoding::encode(path)
        ))
        .await
    }

    /// Fetch an artifact's bytes from the presigned url
    /// [`Self::artifact_download_url`] handed back.
    ///
    /// Its own method rather than another `get_*` because everything about
    /// the request differs from a Cursor API call: the url is S3's, not this
    /// client's base url; its credentials are already in its query string, so
    /// the Cursor key must *not* be attached — sending a live API key to a
    /// third-party host is a credential leak, not a harmless extra header —
    /// and it stops working fifteen minutes after it was minted.
    ///
    /// The response is returned unread. Artifact videos run to tens of
    /// megabytes, so the caller decides whether to stream the body somewhere
    /// or buffer it; this method will not buffer it for them.
    #[tracing::instrument(skip(self, url), err)]
    pub async fn fetch_artifact(&self, url: &str) -> Result<reqwest::Response, rootcause::Report> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|error| rootcause::report!(error))?;
        let status = response.status();
        if !status.is_success() {
            // S3 answers a stale or malformed presigned url with an XML body
            // naming the reason, which is the only diagnostic there is — the
            // same bargain `get_json` makes with Cursor's error bodies.
            let text = response.text().await.unwrap_or_default();
            return Err(rootcause::report!("artifact fetch -> {status}: {text}"));
        }
        Ok(response)
    }

    /// Identify the configured API key. The cheap call that proves the key is
    /// live, for a boot-time health check.
    #[tracing::instrument(skip(self), err)]
    pub async fn me(&self) -> Result<MeResponse, rootcause::Report> {
        self.get_json("/v1/me").await
    }
}

impl CursorAgents for CursorClient {
    #[tracing::instrument(skip(self), err)]
    async fn raw_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<String, rootcause::Report> {
        let response = self
            .http
            .get(self.url(&format!("/v1/agents/{agent}/runs/{run}")))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .send()
            .await
            .map_err(|e| rootcause::report!(e))?;
        let status = response.status();
        let text = response.text().await.map_err(|e| rootcause::report!(e))?;
        if !status.is_success() {
            return Err(rootcause::report!(
                "Cursor run poll failed: {status}: {text}"
            ));
        }
        Ok(text)
    }

    #[tracing::instrument(skip_all, err, fields(mcp_servers = mcp_servers.len()))]
    async fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        open_pull_request: bool,
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
            // A repo-less agent has nothing to open a pull request against,
            // whatever the caller asked for.
            auto_create_pr: open_pull_request && repo.is_some(),
        };
        let (status, text) = self.post_for_text("/v1/agents", &request).await?;
        if let Some(repo) = repo
            && repository_is_inaccessible(status, &text)
        {
            return Err(
                rootcause::report!(crate::domain::error::RepositoryUnavailable {
                    repo: repo.clone(),
                    detail: text,
                })
                .into_dynamic(),
            );
        }
        let reply: CreateAgentResponse = Self::decode_post("/v1/agents", status, &text)?;
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
    async fn list_runs(
        &self,
        agent: &CursorAgentId,
        through: Option<&CursorRunId>,
    ) -> Result<Vec<RunListing>, rootcause::Report> {
        let mut listings = Vec::new();
        let mut cursor = None;
        let mut seen_cursors = std::collections::HashSet::new();
        loop {
            let mut request = self
                .http
                .get(self.url(&format!("/v1/agents/{agent}/runs")))
                .basic_auth(self.config.api_key.expose(), Some(""))
                .query(&[("limit", "100")]);
            if let Some(cursor) = cursor.as_deref() {
                request = request.query(&[("cursor", cursor)]);
            }
            let response = request
                .send()
                .await
                .map_err(|error| rootcause::report!(error))?;
            let status = response.status();
            let text = response
                .text()
                .await
                .map_err(|error| rootcause::report!(error))?;
            if !status.is_success() {
                return Err(rootcause::report!(
                    "cursor GET /v1/agents/{agent}/runs -> {status}: {text}"
                ));
            }
            let page: ListRunsResponse = serde_json::from_str(&text).map_err(|error| {
                rootcause::report!("cursor run list: bad response body: {error}")
            })?;
            let reached = through
                .is_some_and(|through| page.items.iter().any(|item| item.id == through.as_str()));
            listings.extend(page.items.into_iter().map(|item| RunListing {
                id: CursorRunId::new(item.id),
                status: item.status,
            }));
            if reached {
                break;
            }
            let Some(next) = page.next_cursor else {
                break;
            };
            if !seen_cursors.insert(next.clone()) {
                return Err(rootcause::report!(
                    "cursor run list repeated pagination cursor"
                ));
            }
            cursor = Some(next);
        }
        Ok(listings)
    }

    /// Version zero on purpose: v1 exposes no conversation endpoint, and this
    /// one answers for the agents v1 created.
    #[tracing::instrument(skip(self), err)]
    async fn conversation(
        &self,
        agent: &CursorAgentId,
    ) -> Result<Vec<ConversationLine>, rootcause::Report> {
        let reply: ConversationResponse = self
            .get_json(&format!("/v0/agents/{agent}/conversation"))
            .await?;
        Ok(reply
            .messages
            .into_iter()
            .filter_map(|message| {
                let speaker = match message.kind.as_str() {
                    "user_message" => ConversationSpeaker::User,
                    "assistant_message" => ConversationSpeaker::Agent,
                    _ => return None,
                };
                Some(ConversationLine {
                    speaker,
                    text: message.text?,
                })
            })
            .collect())
    }
}

impl CursorArtifacts for CursorClient {
    #[tracing::instrument(skip(self), err)]
    async fn list_artifacts(
        &self,
        agent: &CursorAgentId,
    ) -> Result<Vec<ArtifactListing>, rootcause::Report> {
        let reply = CursorClient::list_artifacts(self, agent).await?;
        Ok(reply
            .items
            .into_iter()
            .map(|listing| ArtifactListing {
                path: listing.path,
                size_bytes: listing.size_bytes,
                updated_at: listing.updated_at,
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn fetch_artifact(
        &self,
        agent: &CursorAgentId,
        path: &str,
    ) -> Result<FetchedArtifact, rootcause::Report> {
        // Minted and spent inside this method: the url carries credentials in
        // its query string and stops working in fifteen minutes, so it is
        // never returned, logged, or stored.
        let download = self.artifact_download_url(agent, path).await?;
        let response = CursorClient::fetch_artifact(self, &download.url).await?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = response
            .bytes()
            .await
            .map_err(|error| rootcause::report!(error))?;
        Ok(FetchedArtifact {
            content_type,
            bytes,
        })
    }
}

/// How many times a run's stream is connected before an unavailable stream
/// is the turn's failure.
const STREAM_CONNECT_ATTEMPTS: usize = 5;

/// Pause between stream connect attempts. The window being papered over is
/// the second or so between a run's creation and its stream existing.
const STREAM_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(400);

/// Cursor's header naming how long a dropped stream stays resumable.
const RETENTION_HEADER: &str = "x-cursor-stream-retention-seconds";

/// The SSE resume header. Not in `http`'s constant set, so it is spelled here.
const LAST_EVENT_ID_HEADER: &str = "last-event-id";

impl RunStream for CursorClient {
    // Covers connecting the stream, retries included; reading it belongs to
    // the caller's `cursor.run.ingest` span.
    #[tracing::instrument(skip(self), fields(cursor.stream.resumed = resume_from.is_some()))]
    async fn raw_stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
        resume_from: Option<&str>,
    ) -> Result<
        ConnectedStream<
            impl Stream<Item = Result<crate::domain::journal::NativeRecord, rootcause::Report>> + Send,
        >,
        StreamConnectError,
    > {
        // Only retry an unavailable stream. Successful SSE records, including
        // a `stream_unavailable` record, must reach the domain journal before
        // inspection, and a rejected or expired resume position is the
        // domain's decision to make, not a thing to sit and retry.
        for attempt in 1..=STREAM_CONNECT_ATTEMPTS {
            match self.connect_stream(agent, run, resume_from).await {
                Ok(stream) => return Ok(stream),
                Err(StreamConnectError::Unavailable(_)) if attempt < STREAM_CONNECT_ATTEMPTS => {
                    tokio::time::sleep(STREAM_RETRY_DELAY).await
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!("connect attempts are nonzero")
    }
}

impl CursorClient {
    async fn connect_stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
        resume_from: Option<&str>,
    ) -> Result<
        ConnectedStream<
            impl Stream<Item = Result<crate::domain::journal::NativeRecord, rootcause::Report>>
            + Send
            + use<>,
        >,
        StreamConnectError,
    > {
        let mut request = self
            .http
            .get(self.url(&format!("/v1/agents/{agent}/runs/{run}/stream")))
            .basic_auth(self.config.api_key.expose(), Some(""))
            .header(reqwest::header::ACCEPT, "text/event-stream");
        if let Some(resume_from) = resume_from {
            request = request.header(LAST_EVENT_ID_HEADER, resume_from);
        }
        let response = request
            .send()
            .await
            .map_err(|error| StreamConnectError::Other(rootcause::report!(error).into()))?;
        let status = response.status();
        // Read before the body is consumed; a resumed stream's window is the
        // only thing that says whether the next drop is recoverable at all.
        let retention_seconds = response
            .headers()
            .get(RETENTION_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok());
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let detail = format!("{status}: {text}");
            if text.contains("stream_unavailable") {
                return Err(StreamConnectError::Unavailable(detail));
            }
            if status == reqwest::StatusCode::BAD_REQUEST && text.contains("invalid_last_event_id")
            {
                return Err(StreamConnectError::InvalidResumePosition(detail));
            }
            if status == reqwest::StatusCode::GONE || text.contains("stream_expired") {
                return Err(StreamConnectError::Expired(detail));
            }
            return Err(StreamConnectError::Other(rootcause::report!(
                "cursor stream -> {detail}"
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
        let records = futures::stream::try_unfold(
            state,
            |(mut bytes, mut decoder, mut pending, mut recording)| async move {
                loop {
                    if let Some(event) = pending.pop_front() {
                        return Ok(Some((event?, (bytes, decoder, pending, recording))));
                    }
                    match bytes.next().await {
                        Some(Ok(chunk)) => {
                            recording.write(&chunk);
                            let mut cursor = chunk;
                            while let Some(record) = decoder.next(&mut cursor) {
                                // A payload past the limit is the run's
                                // problem, not this stream's shape: report it
                                // and stop rather than resync mid-record.
                                let record = match record {
                                    Ok(record) => record,
                                    Err(error) => {
                                        // Deliver every earlier complete record
                                        // in this chunk before the decoder error.
                                        pending.push_back(Err(rootcause::report!(
                                            "cursor sse payload over {} bytes: {error}",
                                            MAX_SSE_PAYLOAD
                                        )
                                        .into_dynamic()));
                                        break;
                                    }
                                };
                                let SseEvent::Message(message) = record else {
                                    continue; // `retry:`; the domain drives reconnects
                                };
                                pending.push_back(Ok(crate::domain::journal::NativeRecord {
                                    event: message.event.into_owned(),
                                    data: message.data,
                                    id: message.last_event_id.map(|id| id.to_string()),
                                }));
                            }
                        }
                        Some(Err(error)) => {
                            return Err(rootcause::report!(error).into_dynamic());
                        }
                        None => return Ok(None),
                    }
                }
            },
        );
        Ok(ConnectedStream {
            records,
            retention_seconds,
        })
    }
}
