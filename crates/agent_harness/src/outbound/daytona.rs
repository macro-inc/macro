//! Daytona sandbox provider: a thin client over the handful of REST calls
//! this worker needs, plus the [`SandboxProvider`]/[`AgentSandbox`] adapters.
//!
//! Deliberately not the `daytona-client` crate: we use five endpoints, and
//! adopting it would drag a second `reqwest`/`tokio` feature set into
//! workspace-hack for calls that are one `reqwest` invocation each.
//!
//! The client's methods are `pub` so one-off binaries can drive them without
//! going through the (still unimplemented) [`SandboxProvider`] adapter - see
//! `src/bin/daytona_hello.rs`.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Deserialize;

use anyhow::Context;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use crate::domain::ports::{AcpFrames, AgentSandbox, SandboxProvider};
use crate::domain::provision;
use crate::outbound::sidecar_pump;

/// How often the state and readiness polls re-check.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Bound on the last-gasp log fetch from a sandbox that failed to come up.
const LOG_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

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

    /// Create a sandbox from `snapshot` with `env` baked in, and return its
    /// id.
    ///
    /// `autoStopInterval: 0` disables Daytona's idle stop: sessions are
    /// long-lived and torn down explicitly by [`DaytonaClient::delete`].
    ///
    /// The sandbox is still booting when this returns; wait for it with
    /// [`DaytonaClient::wait_for_started`].
    #[tracing::instrument(err, skip(self, env))]
    pub async fn create(
        &self,
        snapshot: &str,
        env: HashMap<String, String>,
    ) -> anyhow::Result<String> {
        let sandbox: SandboxDto = self
            .json(
                self.http
                    .post(format!("{}/sandbox", self.base))
                    .json(&serde_json::json!({
                        "snapshot": snapshot,
                        "env": env,
                        "autoStopInterval": 0,
                    })),
                "create sandbox",
            )
            .await?;

        Ok(sandbox.id)
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
    /// Lives here rather than in `domain::provision` because polling is an
    /// HTTP concern; the timeout it is given is the domain's
    /// [`crate::domain::provision::PING_TIMEOUT`].
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
pub struct DaytonaProvider {
    client: DaytonaClient,
    snapshot: String,
    github_token: GithubToken,
}

impl DaytonaProvider {
    /// Build the provider from its settings.
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
}

impl SandboxProvider for DaytonaProvider {
    type Sandbox = DaytonaSandbox;

    #[tracing::instrument(err, skip(self))]
    async fn spawn(&self) -> anyhow::Result<Self::Sandbox> {
        // The repo url and token ride in the sandbox environment so the ensure
        // script takes no arguments and a reconnect need not rethread them -
        // and so a credential never lands in a command line.
        let env = HashMap::from([
            ("REPO_URL".to_owned(), provision::REPO_URL.to_owned()),
            (
                "GITHUB_TOKEN".to_owned(),
                self.github_token.expose().to_owned(),
            ),
        ]);

        let id = self
            .client
            .create(&self.snapshot, env)
            .await
            .context("creating daytona sandbox")?;
        tracing::info!(sandbox_id = %id, "sandbox created");

        // Everything past create runs against a sandbox we are paying for, so
        // failures destroy it rather than leaking it.
        match self.bring_up(&id).await {
            Ok(sandbox) => Ok(sandbox),
            Err(error) => {
                // The sandbox is about to be destroyed, taking the only evidence
                // with it, so grab the sidecar's log first. Best effort: this
                // runs on a sandbox that is already failing.
                if let Ok(log) = self
                    .client
                    .exec(
                        &id,
                        &format!("tail -50 {} 2>&1 || true", provision::SIDECAR_LOG),
                        LOG_FETCH_TIMEOUT,
                    )
                    .await
                {
                    tracing::error!(sandbox_id = %id, sidecar_log = %log, "sidecar log");
                }

                if let Err(delete_error) = self.client.delete(&id).await {
                    tracing::error!(
                        error = ?delete_error,
                        sandbox_id = %id,
                        "failed to delete a sandbox that never came up"
                    );
                }
                Err(error)
            }
        }
    }
}

impl DaytonaProvider {
    /// Wait for the sandbox to boot, run the readiness recipe, and confirm the
    /// sidecar answers.
    ///
    /// Split out of `spawn` so every failure past `create` shares one cleanup
    /// path.
    async fn bring_up(&self, id: &str) -> anyhow::Result<DaytonaSandbox> {
        self.client
            .wait_for_started(id, provision::ENSURE_TIMEOUT)
            .await?;

        let output = self
            .client
            .exec(
                id,
                &provision::ensure_ready_command(),
                provision::ENSURE_TIMEOUT,
            )
            .await
            .context("running the readiness recipe")?;
        // At info, not debug: this is the only window into what happened inside
        // the container, and a readiness failure right after is unreadable
        // without it.
        tracing::info!(sandbox_id = %id, %output, "readiness recipe finished");

        let preview = self
            .client
            .port_preview(id, provision::SIDECAR_PORT)
            .await?;
        self.client
            .wait_for_ping(
                &format!("{}/ping", preview.url),
                preview.token.as_deref(),
                provision::PING_TIMEOUT,
            )
            .await?;

        Ok(DaytonaSandbox {
            id: id.to_owned(),
            client: self.client.clone(),
            sidecar_url: preview.url,
            preview_token: preview.token,
        })
    }
}

/// One Daytona sandbox running the ACP sidecar.
pub struct DaytonaSandbox {
    id: String,
    client: DaytonaClient,
    /// Externally reachable base URL of the sidecar, resolved at spawn.
    sidecar_url: String,
    /// Token the preview proxy expects, when it wants one.
    preview_token: Option<String>,
}

impl AgentSandbox for DaytonaSandbox {
    fn id(&self) -> &str {
        &self.id
    }

    #[tracing::instrument(err, skip(self), fields(sandbox_id = %self.id))]
    async fn connect(&self) -> anyhow::Result<AcpFrames> {
        // The preview URL is https; the sidecar speaks WebSocket on the same
        // host and path.
        let ws_url = self.sidecar_url.replacen("http", "ws", 1);
        let mut request = IntoClientRequest::into_client_request(ws_url.as_str())
            .context("sidecar preview url is not a valid websocket request")?;
        if let Some(token) = &self.preview_token {
            request.headers_mut().insert(
                "x-daytona-preview-token",
                token.parse().context("preview token is not header-safe")?,
            );
        }

        let (socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .context("dialing the sidecar websocket")?;

        Ok(sidecar_pump::spawn(socket))
    }

    async fn release(&self) {
        // No pooling on Daytona: releasing destroys. Reported rather than
        // propagated - a leaked sandbox should not mask why the run ended.
        let _ = self.client.delete(&self.id).await.inspect_err(|error| {
            tracing::error!(error = ?error, sandbox_id = %self.id, "sandbox delete failed");
        });
    }
}
