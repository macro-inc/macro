//! Daytona sandbox provider: a thin client over the handful of REST calls
//! this worker needs, plus the [`ContainerManager`] adapter.
//!
//! Deliberately not the `daytona-client` crate: we use six endpoints, and
//! adopting it would drag a second `reqwest`/`tokio` feature set into
//! workspace-hack for calls that are one `reqwest` invocation each.
//!
//! The client's methods are `pub` so one-off binaries can drive them without
//! going through the [`ContainerManager`] adapter - see `src/bin/boot_agent.rs`.
//!
//! ## Finding a session's sandbox again
//!
//! Daytona assigns the sandbox id, so it cannot be derived from a session id and
//! [`ContainerManager::resume`] has nothing to look one up by. Rather than
//! persist a mapping, `spawn` stamps the session id onto the sandbox as the
//! [`SESSION_LABEL`] label and `resume` queries for it. The provider stays
//! self-contained - no schema change, no second source of truth that can drift
//! from what Daytona actually has.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_runtime_protocol::domain::ports::{Transport, TransportError};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::AgentSessionId;
use serde::Deserialize;

use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::outbound::provision;
use crate::outbound::sidecar::SidecarTransport;

/// How often the state and readiness polls re-check.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Bound on the last-gasp log fetch from a sandbox that failed to come up.
const LOG_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Label carrying the id of the session a sandbox was booted for.
const SESSION_LABEL: &str = "macro.agent_session_id";

/// Sandbox lifecycle states, as reported by `GET /sandbox/{id}`.
///
/// Only the three this client branches on are named; everything else Daytona
/// can report (`creating`, `pulling_snapshot`, `restoring`, ...) is a
/// transient the poll keeps waiting through, so it lands in `Other` rather
/// than growing a variant that nothing reads.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SandboxState {
    /// Booted and accepting toolbox commands.
    Started,
    /// Terminal failure; the sandbox will not come up.
    Error,
    /// Terminal failure building the snapshot's image.
    BuildFailed,
    /// Any other state, all of which are transient.
    #[serde(other)]
    Other,
}

/// The slice of Daytona's `Sandbox` DTO this client reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxDto {
    id: String,
    state: SandboxState,
    /// Why the sandbox is in [`SandboxState::Error`], when it is.
    error_reason: Option<String>,
}

/// Response of `GET /sandbox/{id}/toolbox-proxy-url`.
#[derive(Debug, Deserialize)]
struct ToolboxProxyUrlDto {
    url: String,
}

/// Response of `GET /sandbox/{id}/ports/{port}/preview-url`.
#[derive(Debug, Deserialize)]
struct PortPreviewUrlDto {
    url: String,
    /// Authorizes requests through the preview proxy. Absent on sandboxes whose
    /// preview is public.
    token: Option<String>,
}

/// A sandbox port's externally reachable address.
pub struct PortPreview {
    /// URL the port is reachable at, no trailing slash.
    pub url: String,
    /// Token the preview proxy expects, when it wants one.
    pub token: Option<String>,
}

/// Response of the toolbox's `POST /process/execute`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponseDto {
    exit_code: Option<i32>,
    /// Combined stdout and stderr.
    result: String,
}

/// Thin Daytona REST client: create, exec, preview-url, delete.
#[derive(Clone)]
pub struct DaytonaClient {
    http: reqwest::Client,
    base: String,
    api_key: DaytonaApiKey,
}

impl DaytonaClient {
    /// Build a client against `api_url` (e.g. `https://app.daytona.io/api`).
    #[must_use]
    pub fn new(api_url: String, api_key: DaytonaApiKey) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: api_url.trim_end_matches('/').to_owned(),
            api_key,
        }
    }

    /// Create a sandbox from `snapshot` with `env` baked in and `labels`
    /// attached, and return its id.
    ///
    /// `autoStopInterval: 0` disables Daytona's idle stop: sessions are
    /// long-lived and torn down explicitly by [`DaytonaClient::delete`].
    ///
    /// Labels are how a sandbox is found again later - see the module docs and
    /// [`DaytonaClient::find_by_label`].
    ///
    /// The sandbox is still booting when this returns; wait for it with
    /// [`DaytonaClient::wait_for_started`].
    #[tracing::instrument(err, skip(self, env))]
    pub async fn create(
        &self,
        snapshot: &str,
        env: HashMap<String, String>,
        labels: HashMap<String, String>,
    ) -> anyhow::Result<String> {
        let sandbox: SandboxDto = self
            .json(
                self.http
                    .post(format!("{}/sandbox", self.base))
                    .json(&serde_json::json!({
                        "snapshot": snapshot,
                        "env": env,
                        "labels": labels,
                        "autoStopInterval": 0,
                    })),
                "create sandbox",
            )
            .await?;

        Ok(sandbox.id)
    }

    /// Find the one sandbox carrying `label = value`, if it still exists.
    ///
    /// `GET /sandbox` takes its label filter as a JSON object in a query
    /// parameter, so the filter is serialized rather than passed as pairs.
    ///
    /// Errored and deleted sandboxes are left out - `includeErroredDeleted`
    /// defaults to false - which is what the caller wants: a session asking for
    /// its sandbox wants one it can still use, and a destroyed one should read
    /// as absent rather than as something to reattach to.
    #[tracing::instrument(err, skip(self))]
    pub async fn find_by_label(&self, label: &str, value: &str) -> anyhow::Result<Option<String>> {
        let filter = serde_json::to_string(&HashMap::from([(label, value)]))
            .map_err(|error| anyhow::anyhow!("could not encode the label filter: {error}"))?;

        let sandboxes: Vec<SandboxDto> = self
            .json(
                self.http
                    .get(format!("{}/sandbox", self.base))
                    .query(&[("labels", filter.as_str())]),
                "list sandboxes",
            )
            .await?;

        // One sandbox per session is the invariant `spawn` maintains, so more
        // than one means something else created one. Which of them is picked is
        // arbitrary - Daytona does not document an ordering for this list - so
        // the ambiguity is logged rather than resolved by guessing.
        if sandboxes.len() > 1 {
            tracing::warn!(
                label,
                value,
                count = sandboxes.len(),
                "more than one sandbox carries this label; picking one arbitrarily"
            );
        }

        Ok(sandboxes.into_iter().next().map(|sandbox| sandbox.id))
    }

    /// Poll a sandbox until it reports [`SandboxState::Started`].
    ///
    /// Creating from a snapshot the runner has not pulled yet takes minutes,
    /// so the timeout belongs to the caller.
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_for_started(
        &self,
        sandbox_id: &str,
        timeout: Duration,
    ) -> anyhow::Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let sandbox: SandboxDto = self
                .json(
                    self.http.get(format!("{}/sandbox/{sandbox_id}", self.base)),
                    "get sandbox",
                )
                .await?;

            match sandbox.state {
                SandboxState::Started => return Ok(()),
                SandboxState::Error | SandboxState::BuildFailed => anyhow::bail!(
                    "sandbox {sandbox_id} failed to start ({:?}): {}",
                    sandbox.state,
                    sandbox.error_reason.as_deref().unwrap_or("no reason given")
                ),
                SandboxState::Other => {}
            }

            if Instant::now() >= deadline {
                anyhow::bail!("sandbox {sandbox_id} was not started within {timeout:?}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Run one command inside a sandbox, wait for it to finish, and return
    /// its combined stdout and stderr. A non-zero exit is an error.
    #[tracing::instrument(err, skip(self))]
    pub async fn exec(
        &self,
        sandbox_id: &str,
        command: &str,
        timeout: Duration,
    ) -> anyhow::Result<String> {
        // The toolbox lives behind its own proxy host, addressed as
        // `{toolboxProxyUrl}/{sandboxId}`, not under the REST api's base.
        let toolbox: ToolboxProxyUrlDto = self
            .json(
                self.http.get(format!(
                    "{}/sandbox/{sandbox_id}/toolbox-proxy-url",
                    self.base
                )),
                "get toolbox proxy url",
            )
            .await?;
        let toolbox_url = toolbox.url.trim_end_matches('/');

        let response: ExecuteResponseDto = self
            .json(
                self.http
                    .post(format!("{toolbox_url}/{sandbox_id}/process/execute"))
                    .json(&serde_json::json!({
                        "command": command,
                        "timeout": timeout.as_secs(),
                    })),
                "execute command",
            )
            .await?;

        match response.exit_code {
            Some(0) | None => Ok(response.result),
            Some(code) => anyhow::bail!(
                "command exited {code} in sandbox {sandbox_id}: {command}\n{}",
                response.result
            ),
        }
    }

    /// Resolve the externally reachable URL for a port inside a sandbox.
    #[tracing::instrument(err, skip(self))]
    pub async fn preview_url(&self, sandbox_id: &str, port: u16) -> anyhow::Result<String> {
        let preview: PortPreviewUrlDto = self
            .json(
                self.http.get(format!(
                    "{}/sandbox/{sandbox_id}/ports/{port}/preview-url",
                    self.base
                )),
                "get port preview url",
            )
            .await?;

        Ok(preview.url.trim_end_matches('/').to_owned())
    }

    /// Like [`DaytonaClient::preview_url`], but also returns the token the
    /// preview proxy authorizes with - which a WebSocket dial needs and a
    /// plain fetch through the proxy does not.
    #[tracing::instrument(err, skip(self))]
    pub async fn port_preview(&self, sandbox_id: &str, port: u16) -> anyhow::Result<PortPreview> {
        let preview: PortPreviewUrlDto = self
            .json(
                self.http.get(format!(
                    "{}/sandbox/{sandbox_id}/ports/{port}/preview-url",
                    self.base
                )),
                "get port preview url",
            )
            .await?;

        Ok(PortPreview {
            url: preview.url.trim_end_matches('/').to_owned(),
            token: preview.token,
        })
    }

    /// Destroy a sandbox.
    #[tracing::instrument(err, skip(self))]
    pub async fn delete(&self, sandbox_id: &str) -> anyhow::Result<()> {
        let _: serde::de::IgnoredAny = self
            .json(
                self.http
                    .delete(format!("{}/sandbox/{sandbox_id}", self.base)),
                "delete sandbox",
            )
            .await?;

        Ok(())
    }

    /// Poll the sidecar's readiness probe until it answers or the deadline
    /// passes.
    ///
    /// Lives here rather than in `outbound::provision` because polling is an
    /// HTTP concern; the timeout it is given is the domain's
    /// [`crate::outbound::provision::PING_TIMEOUT`].
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_for_ping(
        &self,
        ping_url: &str,
        preview_token: Option<&str>,
        timeout: Duration,
    ) -> anyhow::Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let mut request = self.http.get(ping_url);
            if let Some(token) = preview_token {
                request = request.header("x-daytona-preview-token", token);
            }
            // Every error here - connection refused, a 502 from the preview
            // proxy - just means "not up yet", so none of them are fatal
            // until the deadline is.
            if let Ok(response) = request.send().await
                && response.status().is_success()
            {
                return Ok(());
            }

            if Instant::now() >= deadline {
                anyhow::bail!("sidecar did not answer {ping_url} within {timeout:?}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Send an authenticated request and deserialize its body, turning a
    /// non-2xx status into an error that carries Daytona's response body -
    /// which is where the actual reason lives.
    async fn json<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        what: &str,
    ) -> anyhow::Result<T> {
        let response = request
            .bearer_auth(self.api_key.expose())
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("failed to {what}: {error}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| anyhow::anyhow!("failed to read the {what} response: {error}"))?;

        if !status.is_success() {
            anyhow::bail!("failed to {what}: daytona returned {status}: {body}");
        }

        serde_json::from_str(&body).map_err(|error| {
            anyhow::anyhow!("failed to parse the {what} response: {error}: {body}")
        })
    }
}

/// API key the Daytona client authenticates with.
///
/// Neither `Debug` nor `Display`, so it cannot reach a log or an error message
/// without an explicit [`DaytonaApiKey::expose`]. Its own type rather than the
/// service's `config::DaytonaApiKey`: that one is generated by `macro_env_var`
/// and means "came from `DAYTONA_API_KEY`", which is the composition root's
/// business. This one means "is a credential", which is ours. The root converts
/// between them.
#[derive(Clone)]
pub struct DaytonaApiKey(String);

/// Token with read access to the repo cloned into sandboxes.
///
/// Secret on the same terms as [`DaytonaApiKey`].
#[derive(Clone)]
pub struct GithubToken(String);

crate::outbound::secret!(DaytonaApiKey, GithubToken);

/// What the Daytona provider needs to talk to Daytona and to stamp out
/// sandboxes.
///
/// Deliberately not the service's `Config`: reading the environment and
/// mapping it onto adapter arguments is the composition root's job, so this
/// crate never learns how those values are sourced.
///
/// No `Debug`: it holds two credentials, and the newtypes are the only thing
/// stopping a derive here from printing them.
pub struct DaytonaSettings {
    /// Base URL of the Daytona REST API.
    pub api_url: String,
    /// API key the client authenticates with.
    pub api_key: DaytonaApiKey,
    /// Prebuilt snapshot sandboxes are created from. The image is built and
    /// pushed out of band, keeping image builds off the first-prompt
    /// critical path.
    pub snapshot: String,
    /// Token with read access to the repo cloned into sandboxes.
    pub github_token: GithubToken,
}

/// Hands out Daytona sandboxes.
pub struct DaytonaContainerManager {
    client: DaytonaClient,
    snapshot: String,
    github_token: GithubToken,
}

impl DaytonaContainerManager {
    /// Build the manager from its settings.
    #[must_use]
    pub fn new(settings: DaytonaSettings) -> Self {
        let DaytonaSettings {
            api_url,
            api_key,
            snapshot,
            github_token,
        } = settings;
        Self {
            client: DaytonaClient::new(api_url, api_key),
            snapshot,
            github_token,
        }
    }

    /// Bring a created sandbox up and connect to its sidecar.
    ///
    /// Idempotent end to end, which is what lets `resume` reuse it whole:
    /// `wait_for_started` restarts a stopped sandbox, `ensure_ready.sh` skips
    /// every stage it has already done, and the preview url is re-resolved
    /// rather than remembered.
    async fn bring_up(&self, id: &str) -> Result<DaytonaContainer> {
        self.client
            .wait_for_started(id, provision::ENSURE_TIMEOUT)
            .await
            .map_err(unavailable)?;

        let output = self
            .client
            .exec(
                id,
                &provision::ensure_ready_command(),
                provision::ENSURE_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;
        // At info, not debug: this is the only window into what happened inside
        // the container, and a readiness failure right after is unreadable
        // without it.
        tracing::info!(sandbox_id = %id, %output, "readiness recipe finished");

        let preview = self
            .client
            .port_preview(id, provision::SIDECAR_PORT)
            .await
            .map_err(unavailable)?;
        self.client
            .wait_for_ping(
                &format!("{}/ping", preview.url),
                preview.token.as_deref(),
                provision::PING_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;

        let socket = dial_sidecar(&preview).await?;

        Ok(DaytonaContainer {
            id: id.to_owned(),
            client: self.client.clone(),
            wire: Arc::new(SidecarTransport::connect(socket)),
        })
    }

    /// Grab the sidecar's log, then destroy a sandbox that never came up.
    ///
    /// The sandbox is about to be destroyed, taking the only evidence with it,
    /// so the log is fetched first. Best effort throughout: this runs on a
    /// sandbox that is already failing, and the failure that got us here is the
    /// one worth reporting.
    async fn discard(&self, id: &str) {
        if let Ok(log) = self
            .client
            .exec(
                id,
                &format!("tail -50 {} 2>&1 || true", provision::SIDECAR_LOG),
                LOG_FETCH_TIMEOUT,
            )
            .await
        {
            tracing::error!(sandbox_id = %id, sidecar_log = %log, "sidecar log");
        }

        if let Err(error) = self.client.delete(id).await {
            tracing::error!(
                error = ?error,
                sandbox_id = %id,
                "failed to delete a sandbox that never came up"
            );
        }
    }
}

impl ContainerManager for DaytonaContainerManager {
    type Transport = DaytonaContainer;

    #[tracing::instrument(err, skip(self))]
    async fn spawn(&self, command: SpawnContainer) -> Result<DaytonaContainer> {
        let SpawnContainer {
            session_id,
            repo_url,
        } = command;
        // The repo url and token ride in the sandbox environment so the ensure
        // script takes no arguments and a reconnect need not rethread them -
        // and so a credential never lands in a command line.
        let env = HashMap::from([
            ("REPO_URL".to_owned(), repo_url),
            (
                "GITHUB_TOKEN".to_owned(),
                self.github_token.expose().to_owned(),
            ),
        ]);
        // Stamped at creation, because this is the only thing `resume` has to
        // find the sandbox by.
        let labels = HashMap::from([(SESSION_LABEL.to_owned(), session_id.to_string())]);

        let id = self
            .client
            .create(&self.snapshot, env, labels)
            .await
            .map_err(unavailable)?;
        tracing::info!(sandbox_id = %id, session = %session_id, "sandbox created");

        // Everything past create runs against a sandbox we are paying for, so
        // failures destroy it rather than leaking it.
        match self.bring_up(&id).await {
            Ok(container) => Ok(container),
            Err(error) => {
                self.discard(&id).await;
                Err(error)
            }
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn resume(&self, session: AgentSessionId) -> Result<DaytonaContainer> {
        let id = self
            .client
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)?
            .ok_or_else(|| {
                HarnessError::Container(format!("session {session} has no sandbox to resume"))
            })?;

        // Not destroyed on failure, unlike `spawn`: this sandbox holds the
        // agent's working state, and a bring-up that failed once may well
        // succeed on the next action. A sandbox that is genuinely unusable is
        // the reaper's problem, not this call's.
        self.bring_up(&id).await
    }
}

/// One Daytona sandbox and the live protocol connection to its sidecar.
///
/// Cloneable because the domain splits sending from receiving across two tasks;
/// clones share one socket, and only one of them can be receiving at a time.
#[derive(Clone)]
pub struct DaytonaContainer {
    id: String,
    client: DaytonaClient,
    wire: Arc<SidecarTransport>,
}

impl DaytonaContainer {
    /// Destroy the sandbox.
    ///
    /// The domain has no lifecycle policy to call this yet: an idle session is
    /// resumed rather than finished, so the caller that knows a session is over
    /// is the one that releases it.
    ///
    /// Reported rather than propagated: a leaked sandbox should not mask why the
    /// run ended.
    pub async fn release(&self) {
        let _ = self.client.delete(&self.id).await.inspect_err(|error| {
            tracing::error!(error = ?error, sandbox_id = %self.id, "sandbox delete failed");
        });
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for DaytonaContainer {
    async fn send(&self, message: ToRuntimeMessage) -> Result<(), TransportError> {
        self.wire.send(message).await
    }

    async fn recv(&self) -> Result<Option<ToServerMessage>, TransportError> {
        self.wire.recv().await
    }
}

/// Dial the sidecar behind a preview url.
///
/// The preview URL is https; the sidecar speaks WebSocket on the same host and
/// path, and the preview proxy wants its token as a header - which a WebSocket
/// dial has to set itself, unlike a plain fetch through the proxy.
async fn dial_sidecar(
    preview: &PortPreview,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
> {
    let ws_url = preview.url.replacen("http", "ws", 1);
    let mut request = IntoClientRequest::into_client_request(ws_url.as_str()).map_err(|error| {
        HarnessError::Container(format!(
            "the sidecar preview url is not a valid websocket request: {error}"
        ))
    })?;
    if let Some(token) = &preview.token {
        request.headers_mut().insert(
            "x-daytona-preview-token",
            token.parse().map_err(|error| {
                HarnessError::Container(format!("the preview token is not header-safe: {error}"))
            })?,
        );
    }

    let (socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| {
            HarnessError::Container(format!("dialing the sidecar websocket failed: {error}"))
        })?;
    Ok(socket)
}

/// Report a provider failure as the port's error.
///
/// Every call in this adapter fails the same way as far as the domain is
/// concerned - the container is not available - so the provider's own error text
/// is carried through rather than classified.
fn unavailable(error: anyhow::Error) -> HarnessError {
    HarnessError::Container(format!("{error:#}"))
}
