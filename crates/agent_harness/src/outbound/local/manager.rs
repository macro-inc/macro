use std::time::Duration;

use agent_session::domain::model::{AgentSessionId, SandboxSize};

use super::docker::{ContainerRef, Docker, RunSpec};
use super::errors::LocalError;
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{SandboxEgress, SpawnContainer};
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::{SandboxResizeEffect, create_only_resize_effect};
use crate::outbound::daytona::AnthropicApiKey;
use crate::outbound::provision::{self, SESSION_LABEL};
use crate::outbound::sidecar::SidecarTransport;

#[cfg(test)]
mod test;

/// How long to keep asking the sidecar whether it is up.
const PING_INTERVAL: Duration = Duration::from_millis(250);

/// Settings for the local Docker-backed provider.
pub struct LocalSettings {
    /// The `docker`-compatible binary to drive.
    pub docker_binary: String,
    /// Image sandboxes are created from.
    pub image: String,
    /// Compose network the sandbox joins so this service can dial it by name.
    pub network: String,
    /// Key sandboxes run Anthropic models with.
    pub anthropic_api_key: AnthropicApiKey,
}

/// Hands out containers on the local Docker daemon.
///
/// The development counterpart to the Daytona provider, and deliberately the
/// same shape: it runs the same image, execs the same readiness recipe, and
/// dials the same sidecar, so what it exercises is what a deployed sandbox
/// does.
///
/// What it does not have is Daytona's idle reaper. A local sandbox costs
/// nothing per hour; `teardown` and [`Self::shutdown_all`] still remove
/// containers so nothing outlives a deleted session or a stopped stack.
#[derive(Clone)]
pub struct LocalContainerManager {
    docker: Docker,
    image: String,
    network: String,
    anthropic_api_key: AnthropicApiKey,
}

impl LocalContainerManager {
    /// Build the manager from its settings.
    #[must_use]
    pub fn new(settings: LocalSettings) -> Self {
        let LocalSettings {
            docker_binary,
            image,
            network,
            anthropic_api_key,
        } = settings;
        Self {
            docker: Docker::new(docker_binary),
            image,
            network,
            anthropic_api_key,
        }
    }

    /// Stop every sandbox this provider still owns, returning how many refused.
    ///
    /// Compose does not reap siblings created over the mounted Docker socket,
    /// so without this a `just run_local` Ctrl-C leaves `macro-agent-*`
    /// containers on the network.
    pub async fn shutdown_all(&self) -> usize {
        let containers = match self.docker.find_all_by_label_key(SESSION_LABEL).await {
            Ok(containers) => containers,
            Err(error) => {
                tracing::error!(error = ?error, "failed to list local sandboxes for shutdown");
                return 1;
            }
        };

        let mut failures = 0;
        for container in containers {
            if let Err(error) = self.docker.remove(&container).await {
                tracing::error!(
                    error = ?error,
                    container = %container.name,
                    "failed to remove a local sandbox on shutdown"
                );
                failures += 1;
            }
        }
        failures
    }

    /// Run the readiness recipe, then dial the sidecar behind it.
    async fn bring_up(&self, container: &ContainerRef) -> Result<SidecarTransport> {
        let (status, output) = self
            .docker
            .exec(
                container,
                &provision::ensure_ready_command(),
                provision::ENSURE_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;
        if status != 0 {
            return Err(unavailable(LocalError::ReadinessRecipe {
                container: container.name.clone(),
                status,
                output,
            }));
        }
        tracing::info!(container = %container.name, %output, "readiness recipe finished");

        let address = sidecar_address(container);
        self.wait_for_ping(container, &address).await?;

        let url = format!("ws://{address}");
        let (socket, _) = tokio_tungstenite::connect_async(&url)
            .await
            .map_err(|source| {
                unavailable(LocalError::WebSocketConnect {
                    url: url.clone(),
                    source,
                })
            })?;
        Ok(SidecarTransport::connect(socket))
    }

    /// Poll the sidecar's `/ping` until it answers or we give up.
    ///
    /// The recipe backgrounds the sidecar with `nohup`, so it has returned
    /// before the sidecar is listening; dialing the websocket immediately would
    /// race it.
    async fn wait_for_ping(&self, container: &ContainerRef, address: &str) -> Result<()> {
        let client = reqwest::Client::new();
        let url = format!("http://{address}/ping");
        let deadline = tokio::time::Instant::now() + provision::PING_TIMEOUT;

        while tokio::time::Instant::now() < deadline {
            if let Ok(response) = client.get(&url).send().await
                && response.status().is_success()
            {
                return Ok(());
            }
            tokio::time::sleep(PING_INTERVAL).await;
        }

        // Say what the sidecar said before it failed to come up; without this
        // the only symptom is a timeout with no cause attached.
        if let Ok((_status, log)) = self
            .docker
            .exec(
                container,
                &format!("tail -50 {} 2>&1 || true", provision::SIDECAR_LOG),
                Duration::from_secs(15),
            )
            .await
        {
            tracing::error!(container = %container.name, sidecar_log = %log, "sidecar log");
        }

        Err(unavailable(LocalError::NotReady {
            container: container.name.clone(),
            seconds: provision::PING_TIMEOUT.as_secs(),
        }))
    }

    async fn find(&self, session: AgentSessionId) -> Result<Option<ContainerRef>> {
        self.docker
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)
    }

    /// Remove a container that never came up, so a retry is not blocked by the
    /// name it already took.
    async fn discard(&self, container: &ContainerRef) {
        let _ = self.docker.remove(container).await.inspect_err(|error| {
            tracing::error!(
                error = ?error,
                container = %container.name,
                "failed to remove a container that never came up"
            );
        });
    }
}

impl ContainerManager for LocalContainerManager {
    type Transport = SidecarTransport;

    // `skip_all`: `SpawnContainer` carries the egress session token; nothing
    // secret-bearing may be Debug-recorded into the span.
    #[tracing::instrument(err, skip_all, fields(session_id = %command.session_id))]
    async fn spawn(&self, command: SpawnContainer) -> Result<Self::Transport> {
        let SpawnContainer {
            session_id,
            // Routing already consumed the kind; every spawn that reaches
            // the local provider is a sandbox spawn.
            kind: _,
            size: _,
            egress,
            ..
        } = command;

        if !self
            .docker
            .has_image(&self.image)
            .await
            .map_err(unavailable)?
        {
            return Err(unavailable(LocalError::ImageMissing {
                image: self.image.clone(),
            }));
        }

        // A previous run of the same session leaves a container holding this
        // name, and docker refuses to reuse it. Spawning is the point at which
        // the old one is definitively stale.
        if let Some(existing) = self.find(session_id).await? {
            tracing::warn!(
                container = %existing.name,
                session = %session_id,
                "removing a stale container for a session being spawned"
            );
            self.discard(&existing).await;
        }

        let spec = RunSpec {
            image: self.image.clone(),
            name: container_name(session_id),
            labels: vec![(SESSION_LABEL.to_owned(), session_id.to_string())],
            env: sandbox_env(&self.anthropic_api_key, egress),
            network: self.network.clone(),
        };
        let container = self.docker.run(&spec).await.map_err(unavailable)?;
        tracing::info!(container = %container.name, session = %session_id, "container created");

        match self.bring_up(&container).await {
            Ok(transport) => Ok(transport),
            Err(error) => {
                self.discard(&container).await;
                Err(error)
            }
        }
    }

    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        create_only_resize_effect(from, to)
    }

    async fn resize(&self, _session: AgentSessionId, _size: SandboxSize) -> Result<()> {
        Err(HarnessError::Container(
            "Local Docker containers cannot be resized in place".to_owned(),
        ))
    }

    #[tracing::instrument(err, skip(self))]
    async fn resume(&self, session: AgentSessionId) -> Result<Self::Transport> {
        let container = self.find(session).await?.ok_or_else(|| {
            HarnessError::Container(format!("session {session} has no container to resume"))
        })?;

        // Idempotent: docker starts a stopped container and says nothing about
        // one already running.
        self.docker.start(&container).await.map_err(unavailable)?;
        self.bring_up(&container).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        let Some(container) = self.find(session).await? else {
            return Ok(None);
        };
        let (status, output) = self
            .docker
            .exec(
                &container,
                &provision::session_token_command(),
                Duration::from_secs(15),
            )
            .await
            .map_err(unavailable)?;
        if status != 0 {
            return Ok(None);
        }
        Ok(provision::parse_session_token(&output))
    }

    #[tracing::instrument(err, skip(self))]
    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        let Some(container) = self.find(session).await? else {
            // Already the state the caller asked for.
            return Ok(());
        };
        self.docker.remove(&container).await.map_err(unavailable)?;
        tracing::info!(container = %container.name, %session, "container removed");
        Ok(())
    }
}

/// The container name for a session.
///
/// Deterministic so a session has at most one container and `docker ps` reads
/// legibly, and prefixed so a developer can tell Macro's sandboxes apart from
/// the rest of their daemon.
fn container_name(session: AgentSessionId) -> String {
    format!("macro-agent-{session}")
}

/// The sidecar keeps its own port; on a shared network the container name is
/// its DNS name.
fn sidecar_address(container: &ContainerRef) -> String {
    format!("{}:{}", container.name, provision::SIDECAR_PORT)
}

fn sandbox_env(
    anthropic_api_key: &AnthropicApiKey,
    egress: SandboxEgress,
) -> Vec<(String, String)> {
    let mut env = vec![(
        "ANTHROPIC_API_KEY".to_owned(),
        anthropic_api_key.expose().to_owned(),
    )];
    env.extend(egress.environment());
    env
}

fn unavailable(error: LocalError) -> HarnessError {
    HarnessError::Container(error.to_string())
}
