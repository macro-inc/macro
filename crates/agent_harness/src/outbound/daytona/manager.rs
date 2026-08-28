use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use agent_runtime_protocol::domain::ports::Transport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::AgentSessionId;
use futures::{StreamExt as _, stream};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;

use super::client::DaytonaClient;
use super::errors::DaytonaError;
use super::types::{AnthropicApiKey, DaytonaSettings, Env, Labels, PortPreview, Snapshot};
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::{
    SandboxResizeEffect, SandboxResources, resize_effect_from_resources, resources,
};
use crate::outbound::managed_containers::ManagedContainers;
use crate::outbound::provision::{self, SESSION_LABEL};
use crate::outbound::sidecar::SidecarTransport;

const LOG_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const EXEC_TIMEOUT: Duration = Duration::from_secs(15);
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REAP_INTERVAL: Duration = Duration::from_secs(1);
const STOP_TIMEOUT: Duration = Duration::from_secs(30);
const STOP_CONCURRENCY: usize = 10;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DaytonaSandboxId(String);

impl DaytonaSandboxId {
    fn new(id: String) -> Self {
        Self(id)
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

struct DaytonaContainerManagerState {
    containers: ManagedContainers<DaytonaSandboxId>,
    shutdown: CancellationToken,
    shutdown_complete: CancellationToken,
    lifecycle: Mutex<ManagerLifecycle>,
    tasks: TaskTracker,
}

#[derive(Default)]
struct ManagerLifecycle {
    shutting_down: bool,
}

impl DaytonaContainerManagerState {
    fn new() -> Self {
        Self {
            containers: ManagedContainers::new(),
            shutdown: CancellationToken::new(),
            shutdown_complete: CancellationToken::new(),
            lifecycle: Mutex::new(ManagerLifecycle::default()),
            tasks: TaskTracker::new(),
        }
    }

    fn register(&self, id: DaytonaSandboxId) -> bool {
        let lifecycle = self
            .lifecycle
            .lock()
            .expect("manager state should not be poisoned");
        if lifecycle.shutting_down {
            return false;
        }
        self.containers.register(id);
        true
    }
}

/// Hands out Daytona sandboxes.
#[derive(Clone)]
pub struct DaytonaContainerManager {
    client: DaytonaClient,
    snapshot: Snapshot,
    anthropic_api_key: AnthropicApiKey,
    managed: Arc<DaytonaContainerManagerState>,
}

impl DaytonaContainerManager {
    /// Build the manager from its settings.
    #[must_use]
    pub fn new(settings: DaytonaSettings) -> Self {
        let DaytonaSettings {
            api_url,
            api_key,
            snapshot,
            anthropic_api_key,
        } = settings;
        let client = DaytonaClient::new(api_url, api_key);
        let managed = Arc::new(DaytonaContainerManagerState::new());
        managed
            .tasks
            .spawn(reap_idle_containers(client.clone(), managed.clone()));
        Self {
            client,
            snapshot,
            anthropic_api_key,
            managed,
        }
    }

    #[tracing::instrument(
        name = "agent.container.boot",
        err,
        skip(self, id),
        fields(agent.container.provider = "daytona", agent.container.id = id.as_str())
    )]
    async fn bring_up(&self, id: &DaytonaSandboxId) -> Result<DaytonaContainer> {
        self.client
            .wait_for_started(id.as_str(), provision::ENSURE_TIMEOUT)
            .await
            .map_err(unavailable)?;
        let output = self
            .client
            .exec(
                id.as_str(),
                &provision::ensure_ready_command(),
                provision::ENSURE_TIMEOUT,
            )
            .instrument(tracing::info_span!("agent.container.ensure_ready"))
            .await
            .map_err(unavailable)?;
        tracing::info!(sandbox_id = %id.as_str(), %output, "readiness recipe finished");

        let preview = self
            .client
            .port_preview(id.as_str(), provision::SIDECAR_PORT)
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
        let socket = dial_sidecar(&preview)
            .instrument(tracing::info_span!("agent.container.websocket_connect"))
            .await
            .map_err(unavailable)?;
        if !self.managed.containers.activate(id, Instant::now()) {
            return Err(HarnessError::Container(
                "sandbox is no longer managed".to_owned(),
            ));
        }
        let managed = self.managed.clone();
        let observed = id.clone();

        Ok(DaytonaContainer {
            id: id.clone(),
            client: self.client.clone(),
            managed: self.managed.clone(),
            wire: SidecarTransport::connect_observed(socket, move || {
                managed
                    .containers
                    .record_activity(&observed, Instant::now());
            }),
        })
    }

    /// Attempt to stop every Daytona sandbox currently owned by this manager.
    ///
    /// Returns the number of sandboxes that still failed to stop after a retry.
    pub async fn shutdown_all(&self) -> usize {
        let first_shutdown = {
            let mut lifecycle = self
                .managed
                .lifecycle
                .lock()
                .expect("manager state should not be poisoned");
            if lifecycle.shutting_down {
                false
            } else {
                lifecycle.shutting_down = true;
                self.managed.shutdown.cancel();
                self.managed.tasks.close();
                true
            }
        };

        if !first_shutdown {
            self.managed.shutdown_complete.cancelled().await;
            return self.stop_remaining("post-shutdown cleanup").await;
        }

        // The reaper may already own an idle stop. Let it finish and restore
        // its id on failure before taking the authoritative shutdown snapshot.
        self.managed.tasks.wait().await;

        let failures = self.stop_remaining("service shutdown").await;
        self.managed.shutdown_complete.cancel();
        failures
    }

    async fn stop_remaining(&self, reason: &'static str) -> usize {
        let mut remaining =
            stop_managed(&self.client, self.managed.containers.drain(), reason).await;
        if !remaining.is_empty() {
            remaining = stop_managed(&self.client, remaining, "shutdown retry").await;
        }
        let failures = remaining.len();
        for id in remaining {
            self.managed
                .containers
                .restore_failed_stop(id, Instant::now(), IDLE_TIMEOUT);
        }
        failures
    }

    async fn discard(&self, id: &DaytonaSandboxId) -> bool {
        if let Ok(log) = self
            .client
            .exec(
                id.as_str(),
                &format!("tail -50 {} 2>&1 || true", provision::SIDECAR_LOG),
                LOG_FETCH_TIMEOUT,
            )
            .await
        {
            tracing::error!(sandbox_id = %id.as_str(), sidecar_log = %log, "sidecar log");
        }

        match self.client.delete(id.as_str()).await {
            Ok(()) => true,
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    sandbox_id = %id.as_str(),
                    "failed to delete a sandbox that never came up"
                );
                false
            }
        }
    }

    /// Snapshot creates inherit snapshot quotas. Align CPU/RAM to `size`, then
    /// run the readiness recipe.
    async fn align_size_then_bring_up(
        &self,
        id: &DaytonaSandboxId,
        size: agent_session::domain::model::SandboxSize,
    ) -> Result<DaytonaContainer> {
        self.client
            .wait_for_started(id.as_str(), provision::ENSURE_TIMEOUT)
            .await
            .map_err(unavailable)?;
        self.align_size(id, size).await?;
        self.bring_up(id).await
    }

    async fn align_size(
        &self,
        id: &DaytonaSandboxId,
        size: agent_session::domain::model::SandboxSize,
    ) -> Result<()> {
        let (cpu, memory, disk) = self
            .client
            .resources(id.as_str())
            .await
            .map_err(unavailable)?;
        let cpu = cpu.ok_or_else(|| {
            HarnessError::Container("daytona did not report cpu for the new sandbox".to_owned())
        })?;
        let memory = memory.ok_or_else(|| {
            HarnessError::Container("daytona did not report memory for the new sandbox".to_owned())
        })?;
        let current = SandboxResources {
            cpu,
            memory_gib: memory,
            disk_gib: disk.unwrap_or(0),
        };
        let next = resources(size);
        let kind = resize_effect_from_resources(current, next);
        tracing::info!(
            sandbox_id = %id.as_str(),
            %size,
            current_cpu = cpu,
            current_memory_gib = memory,
            next_cpu = next.cpu,
            next_memory_gib = next.memory_gib,
            ?kind,
            "aligning sandbox size after snapshot create"
        );
        self.apply_resize(id, next, kind).await
    }

    async fn apply_resize(
        &self,
        id: &DaytonaSandboxId,
        next: SandboxResources,
        effect: SandboxResizeEffect,
    ) -> Result<()> {
        match effect {
            SandboxResizeEffect::NoOp => Ok(()),
            SandboxResizeEffect::Unsupported => Err(HarnessError::Container(
                "daytona reported resize as unsupported".to_owned(),
            )),
            SandboxResizeEffect::InPlace => {
                self.client
                    .resize(id.as_str(), Some(next.cpu), Some(next.memory_gib), None)
                    .await
                    .map_err(unavailable)?;
                self.client
                    .wait_for_resize(id.as_str(), provision::ENSURE_TIMEOUT)
                    .await
                    .map_err(unavailable)?;
                Ok(())
            }
            SandboxResizeEffect::Restart => {
                self.client.stop(id.as_str()).await.map_err(unavailable)?;
                self.client
                    .wait_for_stopped(id.as_str(), STOP_TIMEOUT)
                    .await
                    .map_err(unavailable)?;
                self.client
                    .resize(id.as_str(), Some(next.cpu), Some(next.memory_gib), None)
                    .await
                    .map_err(unavailable)?;
                self.client
                    .wait_for_resize(id.as_str(), provision::ENSURE_TIMEOUT)
                    .await
                    .map_err(unavailable)?;
                self.client.start(id.as_str()).await.map_err(unavailable)?;
                self.client
                    .wait_for_started(id.as_str(), provision::ENSURE_TIMEOUT)
                    .await
                    .map_err(unavailable)?;
                Ok(())
            }
        }
    }
}

impl ContainerManager for DaytonaContainerManager {
    type Transport = DaytonaContainer;

    #[tracing::instrument(
        name = "agent.container.spawn",
        err,
        skip(self),
        fields(agent.container.provider = "daytona")
    )]
    async fn spawn(&self, command: SpawnContainer) -> Result<DaytonaContainer> {
        let SpawnContainer {
            session_id,
            size,
            egress,
            ..
        } = command;
        // `ANTHROPIC_API_KEY` is what activates opencode's `anthropic`
        // provider — with `enabled_providers` pinned in
        // `container/opencode.json`, it is the sandbox's only model source.
        // Nothing else goes in: the repository and its credential now reach
        // the sandbox through the egress proxy.
        let mut env = HashMap::from([(
            "ANTHROPIC_API_KEY".to_owned(),
            self.anthropic_api_key.expose().to_owned(),
        )]);
        env.extend(egress.environment());
        let env = Env::from(env);
        let labels = Labels::from(HashMap::from([(
            SESSION_LABEL.to_owned(),
            session_id.to_string(),
        )]));
        let id = DaytonaSandboxId::new(
            self.client
                .create(&self.snapshot, env, labels)
                .await
                .map_err(unavailable)?,
        );
        tracing::info!(sandbox_id = %id.as_str(), session = %session_id, "sandbox created");
        if !self.managed.register(id.clone()) {
            if !stop_sandbox(&self.client, &id, "shutdown during sandbox creation").await {
                self.managed
                    .containers
                    .restore_failed_stop(id, Instant::now(), IDLE_TIMEOUT);
            }
            return Err(HarnessError::Container(
                "the container manager is shutting down".to_owned(),
            ));
        }

        match self.align_size_then_bring_up(&id, size).await {
            Ok(container) => Ok(container),
            Err(error) => {
                self.managed.containers.remove(&id);
                if !self.discard(&id).await {
                    self.managed
                        .containers
                        .restore_failed_stop(id, Instant::now(), IDLE_TIMEOUT);
                }
                Err(error)
            }
        }
    }

    fn resize_effect(
        &self,
        from: agent_session::domain::model::SandboxSize,
        to: agent_session::domain::model::SandboxSize,
    ) -> SandboxResizeEffect {
        crate::domain::sandbox::resize_effect(from, to)
    }

    #[tracing::instrument(err, skip(self))]
    async fn resize(
        &self,
        session: AgentSessionId,
        size: agent_session::domain::model::SandboxSize,
    ) -> Result<()> {
        let Some(id) = self
            .client
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)?
            .map(DaytonaSandboxId::new)
        else {
            return Err(HarnessError::Container(format!(
                "session {session} has no sandbox to resize"
            )));
        };
        let (cpu, memory, disk) = self
            .client
            .resources(id.as_str())
            .await
            .map_err(unavailable)?;
        let cpu = cpu.ok_or_else(|| {
            HarnessError::Container("daytona did not report cpu for the sandbox".to_owned())
        })?;
        let memory = memory.ok_or_else(|| {
            HarnessError::Container("daytona did not report memory for the sandbox".to_owned())
        })?;
        let current = SandboxResources {
            cpu,
            memory_gib: memory,
            disk_gib: disk.unwrap_or(0),
        };
        let next = resources(size);
        self.apply_resize(&id, next, resize_effect_from_resources(current, next))
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn resume(&self, session: AgentSessionId) -> Result<DaytonaContainer> {
        let id = DaytonaSandboxId::new(
            self.client
                .find_by_label(SESSION_LABEL, &session.to_string())
                .await
                .map_err(unavailable)?
                .ok_or_else(|| {
                    HarnessError::Container(format!("session {session} has no sandbox to resume"))
                })?,
        );
        if !self.managed.register(id.clone()) {
            return Err(HarnessError::Container(
                "the container manager is shutting down".to_owned(),
            ));
        }
        if let Err(error) = self.client.start(id.as_str()).await {
            self.managed.containers.remove(&id);
            if !stop_sandbox(&self.client, &id, "failed sandbox start").await {
                self.managed
                    .containers
                    .restore_failed_stop(id, Instant::now(), IDLE_TIMEOUT);
            }
            return Err(unavailable(error));
        }
        match self.bring_up(&id).await {
            Ok(container) => Ok(container),
            Err(error) => {
                self.managed.containers.remove(&id);
                if !stop_sandbox(&self.client, &id, "failed sandbox resume").await {
                    self.managed
                        .containers
                        .restore_failed_stop(id, Instant::now(), IDLE_TIMEOUT);
                }
                Err(error)
            }
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>> {
        let Some(id) = self
            .client
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)?
            .map(DaytonaSandboxId::new)
        else {
            return Ok(None);
        };
        let output = self
            .client
            .exec(
                id.as_str(),
                &provision::session_token_command(),
                EXEC_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;
        Ok(provision::parse_session_token(&output))
    }

    #[tracing::instrument(err, skip(self))]
    async fn teardown(&self, session: AgentSessionId) -> Result<()> {
        let Some(id) = self
            .client
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)?
            .map(DaytonaSandboxId::new)
        else {
            // Nothing to destroy. Already the state the caller asked for.
            return Ok(());
        };

        // Drop it from the registry first, so the idle reaper cannot pick it
        // up half-deleted and log a spurious stop failure.
        self.managed.containers.remove(&id);
        self.client.delete(id.as_str()).await.map_err(unavailable)?;
        tracing::info!(sandbox_id = %id.as_str(), session = %session, "sandbox deleted");
        Ok(())
    }
}

async fn reap_idle_containers(client: DaytonaClient, managed: Arc<DaytonaContainerManagerState>) {
    let mut interval = tokio::time::interval(REAP_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;
            () = managed.shutdown.cancelled() => return,
            _ = interval.tick() => {
                let stale = managed.containers.reap_stale(Instant::now(), IDLE_TIMEOUT);
                stop_reaped(&client, &managed, stale).await;
            }
        }
    }
}

async fn stop_reaped(
    client: &DaytonaClient,
    managed: &DaytonaContainerManagerState,
    sandboxes: Vec<DaytonaSandboxId>,
) {
    stream::iter(sandboxes)
        .for_each_concurrent(STOP_CONCURRENCY, |sandbox| async move {
            let stopped = stop_sandbox(client, &sandbox, "ACP idle timeout").await;
            managed.containers.finish_stop(&sandbox, stopped);
        })
        .await;
}

async fn stop_sandbox(client: &DaytonaClient, id: &DaytonaSandboxId, reason: &'static str) -> bool {
    match tokio::time::timeout(STOP_TIMEOUT, client.stop(id.as_str())).await {
        Ok(Ok(())) => {
            tracing::info!(sandbox_id = %id.as_str(), reason, "sandbox stopped");
            true
        }
        Ok(Err(error)) => {
            tracing::error!(error = ?error, sandbox_id = %id.as_str(), reason, "sandbox stop failed");
            false
        }
        Err(_) => {
            tracing::error!(sandbox_id = %id.as_str(), reason, "sandbox stop timed out");
            false
        }
    }
}

async fn stop_managed(
    client: &DaytonaClient,
    sandboxes: Vec<DaytonaSandboxId>,
    reason: &'static str,
) -> Vec<DaytonaSandboxId> {
    stream::iter(sandboxes)
        .map(|sandbox| async move {
            if stop_sandbox(client, &sandbox, reason).await {
                None
            } else {
                Some(sandbox)
            }
        })
        .buffer_unordered(STOP_CONCURRENCY)
        .filter_map(async move |sandbox| sandbox)
        .collect()
        .await
}

/// One Daytona sandbox and the live protocol connection to its sidecar.
pub struct DaytonaContainer {
    id: DaytonaSandboxId,
    client: DaytonaClient,
    managed: Arc<DaytonaContainerManagerState>,
    wire: SidecarTransport,
}

impl DaytonaContainer {
    /// Destroy the sandbox, logging a provider failure rather than masking the run result.
    pub async fn release(&self) {
        if !self.managed.containers.remove(&self.id) {
            return;
        }
        if let Err(error) = self.client.delete(self.id.as_str()).await {
            tracing::error!(error = ?error, sandbox_id = %self.id.as_str(), "sandbox delete failed");
            self.managed.containers.restore_failed_stop(
                self.id.clone(),
                Instant::now(),
                IDLE_TIMEOUT,
            );
        }
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for DaytonaContainer {
    type Sender = crate::outbound::sidecar::SidecarSender;
    type Receiver = tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>;

    /// The sandbox itself is not carried into the halves: nothing reattaches
    /// to a container object once its session has it, and ending a sandbox
    /// goes through the manager by session id.
    fn split(self) -> (Self::Sender, Self::Receiver) {
        self.wire.split()
    }
}

async fn dial_sidecar(
    preview: &PortPreview,
) -> std::result::Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    DaytonaError,
> {
    let mut ws_url =
        url::Url::parse(&preview.url).map_err(|source| DaytonaError::InvalidPreviewUrl {
            url: preview.url.clone(),
            source,
        })?;
    let websocket_scheme = match ws_url.scheme() {
        "http" => "ws",
        "https" => "wss",
        scheme => {
            return Err(DaytonaError::UnsupportedPreviewScheme {
                scheme: scheme.to_owned(),
            });
        }
    };
    ws_url
        .set_scheme(websocket_scheme)
        .map_err(|()| DaytonaError::UnsupportedPreviewScheme {
            scheme: websocket_scheme.to_owned(),
        })?;
    let mut request = ws_url
        .as_str()
        .into_client_request()
        .map_err(DaytonaError::WebSocketRequest)?;
    if let Some(token) = &preview.token {
        request.headers_mut().insert(
            "x-daytona-preview-token",
            token.parse().map_err(DaytonaError::InvalidPreviewToken)?,
        );
    }

    let (socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(DaytonaError::WebSocketConnect)?;
    Ok(socket)
}

fn unavailable(error: DaytonaError) -> HarnessError {
    HarnessError::Container(error.to_string())
}
