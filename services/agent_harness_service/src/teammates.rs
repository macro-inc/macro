//! Delivering agent teammates to their owners' own machines.
//!
//! Only the replica holding a machine's macrod socket delivers to it, as
//! with a Macro computer's agent. It keeps, per machine, what the runtime
//! runs: the installs and `(generation, delivery)` pairs of its
//! `TeammateHost` report, then what it was sent and what it reported since.
//! From that and the machine's install rows it:
//!
//! - delivers an install whose row is ahead of what the runtime runs: the
//!   authentication service counts the delivery and mints its credentials
//!   (which revokes the previous key), then this replica sends `RunTeammate`;
//! - stops an install that is moving away or being removed, and tells the
//!   authentication service once the runtime reports it stopped, or after
//!   [`CHECKPOINT_TIMEOUT`], so the move or removal finishes;
//! - stops an install the runtime keeps that is no longer this machine's;
//! - gives an install a new generation (new keys) when the runtime image for
//!   the machine's architecture differs from the one it was last delivered;
//! - redelivers, at most once per [`BAD_CONFIGURATION_REDELIVERY`], an
//!   install whose current delivery failed with `badConfiguration`: its key
//!   may be revoked (a mint whose count was lost), and a new delivery is a
//!   new key.
//!
//! A reconnect whose report matches the rows sends nothing. A change made on
//! another replica (an invite, a move, a removal) reaches this one through
//! the runtime bus ([`TeammatesChanged`]).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use agent_harness::domain::ports::{RuntimeConnectionId, TeammateEvent, TeammateReport};
use agent_runtime_protocol::domain::schema::v0::{
    AgentEnvironment, HostArch, TeammateHostReport, TeammateImage, TeammateInstall,
    TeammateInstallId, TeammateRunFailure, TeammateRunState, ToServerMessage,
};
use axum::Router;
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::routing::post;
use futures::future::BoxFuture;
use harness_id::HarnessId;
use hosted_runtimes::domain::agent::AgentEnrollmentError;
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use team_agents::domain::models::TeamAgentError;
use team_agents::domain::self_hosting::{
    CHECKPOINT_TIMEOUT, InstallFailure, InstallRunState, IssuedInstall, RuntimeImages,
    TeammateInstallRecord, install_state,
};
use tracing::Instrument as _;
use uuid::Uuid;

pub(crate) mod auth_installs;
pub(crate) mod telemetry;

macro_env_var::maybe_env_vars! {
    /// A local stack's x86-64 teammate runtime image,
    /// `<repository>@sha256:<hex>`; ignored outside `ENVIRONMENT=local`.
    struct OverrideTeammateRuntimeImageAmd64;
    /// The same for arm64.
    struct OverrideTeammateRuntimeImageArm64;
}

/// The teammate runtime images, with a local stack's overrides read once,
/// at startup.
pub(crate) fn teammate_runtime_images() -> team_agents::domain::self_hosting::RuntimeImages {
    use team_agents::domain::self_hosting::{LocalImages, TeammateRuntimeImage};
    let amd64 = OverrideTeammateRuntimeImageAmd64::new().map(|value| value.to_string());
    let arm64 = OverrideTeammateRuntimeImageArm64::new().map(|value| value.to_string());
    let overrides = LocalImages::read(macro_env::Environment::new_or_prod(), |name| {
        if name == TeammateRuntimeImage::OVERRIDE_AMD64 {
            amd64.clone()
        } else if name == TeammateRuntimeImage::OVERRIDE_ARM64 {
            arm64.clone()
        } else {
            None
        }
    });
    TeammateRuntimeImage::images(overrides)
}
#[cfg(test)]
mod test;

/// Install rows and hosting reports, as delivery reads and writes them.
pub(crate) trait InstallStore: Send + Sync + 'static {
    /// The installs that run on `harness` or are leaving it.
    fn installs_on(
        &self,
        harness: HarnessId,
    ) -> BoxFuture<'_, Result<Vec<TeammateInstallRecord>, TeamAgentError>>;

    /// Keep the machine's latest hosting report.
    fn save_host_report(
        &self,
        harness: HarnessId,
        report: TeammateHostReport,
    ) -> BoxFuture<'_, Result<(), TeamAgentError>>;

    /// Give the install its next generation when its latest delivery
    /// carried another image than `image_id`; the updated install, if so.
    fn new_image_generation(
        &self,
        install_id: Uuid,
        generation: u64,
        image_id: &str,
    ) -> BoxFuture<'_, Result<Option<TeammateInstallRecord>, TeamAgentError>>;

    /// Record what the runtime said about an install's delivery.
    fn record_status(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        delivery: (u64, u64),
        run_state: InstallRunState,
        failure: Option<InstallFailure>,
    ) -> BoxFuture<'_, Result<bool, TeamAgentError>>;
}

impl InstallStore for team_agents::outbound::pg_teammate_installs::PgTeammateInstalls {
    fn installs_on(
        &self,
        harness: HarnessId,
    ) -> BoxFuture<'_, Result<Vec<TeammateInstallRecord>, TeamAgentError>> {
        Box::pin(self.installs_on(harness))
    }

    fn save_host_report(
        &self,
        harness: HarnessId,
        report: TeammateHostReport,
    ) -> BoxFuture<'_, Result<(), TeamAgentError>> {
        Box::pin(async move { self.save_host_report(harness, &report).await })
    }

    fn new_image_generation(
        &self,
        install_id: Uuid,
        generation: u64,
        image_id: &str,
    ) -> BoxFuture<'_, Result<Option<TeammateInstallRecord>, TeamAgentError>> {
        let image_id = image_id.to_owned();
        Box::pin(async move {
            self.new_image_generation(install_id, generation, &image_id)
                .await
        })
    }

    fn record_status(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        delivery: (u64, u64),
        run_state: InstallRunState,
        failure: Option<InstallFailure>,
    ) -> BoxFuture<'_, Result<bool, TeamAgentError>> {
        Box::pin(self.record_status(harness, install_id, delivery, run_state, failure))
    }
}

/// A call to the authentication service failed; nothing secret in it.
#[derive(Debug, thiserror::Error)]
#[error("the authentication service did not finish the install's checkpoint")]
pub(crate) struct CheckpointUnfinished;

/// The authentication service's side: it owns the agent's credentials.
pub(crate) trait InstallIssuer: Send + Sync + 'static {
    /// Count and mint the next delivery of an install for `harness`, given
    /// what the runtime runs of it.
    fn issue(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> BoxFuture<'_, Result<Option<IssuedInstall>, AgentEnrollmentError>>;

    /// The runtime stopped an install that is moving or being removed, or
    /// the wait gave up.
    fn checkpointed(&self, install_id: Uuid) -> BoxFuture<'_, Result<(), CheckpointUnfinished>>;
}

/// The machines' sockets on this replica.
pub(crate) trait TeammateSockets: Send + Sync + 'static {
    /// The dial `harness`'s runtime is connected on here, and whether it
    /// hosts teammates in containers.
    fn dial(&self, harness: HarnessId) -> Option<(RuntimeConnectionId, bool)>;

    /// Send `RunTeammate` on that dial; whether it was sent.
    fn run(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: TeammateInstall,
        image: TeammateImage,
        environment: AgentEnvironment,
        traceparent: Option<String>,
    ) -> BoxFuture<'_, bool>;

    /// Send `StopTeammate` on that dial; whether it was sent.
    fn stop(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: TeammateInstall,
        traceparent: Option<String>,
    ) -> BoxFuture<'_, bool>;

    /// Send `RecheckTeammateHost` to `harness`'s runtime, if it is connected
    /// here and listed it; whether it was sent.
    fn recheck(&self, harness: HarnessId) -> BoxFuture<'_, bool>;
}

impl<Sender> TeammateSockets for agent_harness::outbound::runtime_registry::RuntimeRegistry<Sender>
where
    Sender: agent_runtime_protocol::domain::ports::TransportSender<
            agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage,
        > + 'static,
{
    fn dial(&self, harness: HarnessId) -> Option<(RuntimeConnectionId, bool)> {
        self.teammate_dial(harness)
    }

    fn run(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: TeammateInstall,
        image: TeammateImage,
        environment: AgentEnvironment,
        traceparent: Option<String>,
    ) -> BoxFuture<'_, bool> {
        Box::pin(self.run_teammate(
            harness,
            connection,
            install,
            image,
            environment,
            traceparent,
        ))
    }

    fn stop(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: TeammateInstall,
        traceparent: Option<String>,
    ) -> BoxFuture<'_, bool> {
        Box::pin(self.stop_teammate(harness, connection, install, traceparent))
    }

    fn recheck(&self, harness: HarnessId) -> BoxFuture<'_, bool> {
        Box::pin(self.recheck_teammate_host(harness))
    }
}

/// What a machine's runtime runs, as this replica knows it.
#[derive(Debug, Default)]
struct MachineView {
    connection: Option<RuntimeConnectionId>,
    /// The architecture of its last report, for the image it should run.
    arch: Option<HostArch>,
    /// Each install the runtime keeps, with the pair it runs.
    runs: HashMap<TeammateInstallId, (u64, u64)>,
    /// Installs told to stop and not yet reported stopped.
    stopping: HashSet<TeammateInstallId>,
}

impl MachineView {
    fn of(connection: RuntimeConnectionId, report: &TeammateHostReport) -> Self {
        Self {
            connection: Some(connection),
            arch: Some(report.arch),
            runs: report
                .installs
                .iter()
                .map(|install| {
                    (
                        install.install_id.clone(),
                        (install.generation, install.delivery),
                    )
                })
                .collect(),
            stopping: HashSet::new(),
        }
    }

    /// Remember that the runtime runs at least `pair` of `install`.
    fn runs_at_least(&mut self, install: &TeammateInstallId, pair: (u64, u64)) {
        let known = self.runs.entry(install.clone()).or_insert(pair);
        *known = (*known).max(pair);
    }
}

/// The least time between two redeliveries of an install after its
/// current delivery failed with `badConfiguration`, so a truly bad setting
/// can't rotate keys in a loop.
pub(crate) const BAD_CONFIGURATION_REDELIVERY: std::time::Duration =
    std::time::Duration::from_secs(5 * 60);

/// Delivery on this replica.
pub(crate) struct TeammateDelivery {
    store: Arc<dyn InstallStore>,
    issuer: Arc<dyn InstallIssuer>,
    sockets: Arc<dyn TeammateSockets>,
    /// The runtime image for each architecture.
    images: RuntimeImages,
    /// One lock per machine: a reconcile reads and changes its view across
    /// awaits (a delivery waits on the authentication service), and two at
    /// once could deliver twice. Other machines don't wait on it.
    views: std::sync::Mutex<HashMap<HarnessId, Arc<tokio::sync::Mutex<MachineView>>>>,
    /// When each install was last redelivered after a `badConfiguration`,
    /// within [`BAD_CONFIGURATION_REDELIVERY`]; kept across reconnects.
    redelivered: std::sync::Mutex<HashMap<TeammateInstallId, tokio::time::Instant>>,
}

/// The current span's W3C `traceparent`, for the runtime's spans to join.
fn traceparent() -> Option<String> {
    agent_harness::outbound::forward::current_trace_context().remove("traceparent")
}

fn protocol_id(install_id: Uuid) -> Option<TeammateInstallId> {
    TeammateInstallId::new(install_id.to_string()).ok()
}

impl TeammateDelivery {
    pub(crate) fn new(
        store: Arc<dyn InstallStore>,
        issuer: Arc<dyn InstallIssuer>,
        sockets: Arc<dyn TeammateSockets>,
        images: RuntimeImages,
    ) -> Arc<Self> {
        Arc::new(Self {
            store,
            issuer,
            sockets,
            images,
            views: std::sync::Mutex::new(HashMap::new()),
            redelivered: std::sync::Mutex::new(HashMap::new()),
        })
    }

    fn view(&self, harness: HarnessId) -> Arc<tokio::sync::Mutex<MachineView>> {
        let mut views = self
            .views
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Arc::clone(views.entry(harness).or_default())
    }

    /// Consume the runtimes' teammate reports until the registry goes away:
    /// each machine's in order, on its own task, so a slow delivery to one
    /// machine never holds up another's.
    pub(crate) async fn run(
        self: Arc<Self>,
        mut reports: tokio::sync::mpsc::UnboundedReceiver<TeammateReport>,
    ) {
        let mut machines: HashMap<HarnessId, tokio::sync::mpsc::UnboundedSender<TeammateReport>> =
            HashMap::new();
        while let Some(report) = reports.recv().await {
            let harness = report.harness;
            let report = match machines.get(&harness) {
                Some(queue) => match queue.send(report) {
                    Ok(()) => continue,
                    Err(tokio::sync::mpsc::error::SendError(report)) => report,
                },
                None => report,
            };
            let (queue, mut queued) = tokio::sync::mpsc::unbounded_channel();
            let delivery = Arc::clone(&self);
            tokio::spawn(async move {
                while let Some(report) = queued.recv().await {
                    delivery.on_report(report).await;
                }
            });
            if queue.send(report).is_ok() {
                machines.insert(harness, queue);
            }
        }
    }

    /// One report from a runtime.
    pub(crate) async fn on_report(self: &Arc<Self>, report: TeammateReport) {
        let message = match report.event {
            TeammateEvent::Message(message) => message,
            TeammateEvent::Closed => {
                self.on_closed(report.harness, report.connection).await;
                return;
            }
        };
        match message {
            ToServerMessage::TeammateHost { report: host } => {
                self.on_host(report.harness, report.connection, host).await;
            }
            ToServerMessage::TeammateStatus { install, state } => {
                self.on_status(report.harness, install, state).await;
            }
            other => tracing::debug!(message = ?other, "not a teammate report"),
        }
    }

    /// A dial closed: forget its machine's view, unless a newer dial
    /// already replaced it.
    async fn on_closed(&self, harness: HarnessId, connection: RuntimeConnectionId) {
        let machine = self.view(harness);
        let view = machine.lock().await;
        if view.connection.is_some_and(|current| current != connection) {
            return;
        }
        let mut views = self
            .views
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if views
            .get(&harness)
            .is_some_and(|kept| Arc::ptr_eq(kept, &machine))
        {
            views.remove(&harness);
        }
        drop(view);
    }

    async fn on_host(
        self: &Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        report: TeammateHostReport,
    ) {
        let span = tracing::info_span!(
            "teammate.host",
            %harness,
            installs = report.installs.len(),
            problem = ?report.problem,
        );
        async {
            if let Err(error) = self.store.save_host_report(harness, report.clone()).await {
                tracing::error!(error = ?error, "could not store a machine's hosting report");
            }
            *self.view(harness).lock().await = MachineView::of(connection, &report);
            self.reconcile(harness).await;
        }
        .instrument(span)
        .await;
    }

    async fn on_status(
        self: &Arc<Self>,
        harness: HarnessId,
        install: TeammateInstall,
        state: TeammateRunState,
    ) {
        let span = tracing::info_span!(
            "teammate.status",
            install_id = install.install_id.as_str(),
            generation = install.generation,
            delivery = install.delivery,
            state = ?state,
        );
        async {
            let pair = (install.generation, install.delivery);
            let machine = self.view(harness);
            let mut view = machine.lock().await;
            let stopped = matches!(state, TeammateRunState::Stopped);
            if stopped {
                view.runs.remove(&install.install_id);
            } else {
                view.runs_at_least(&install.install_id, pair);
            }
            let finished_stop = stopped && view.stopping.remove(&install.install_id);
            let redeliver = matches!(
                state,
                TeammateRunState::Failed {
                    reason: TeammateRunFailure::BadConfiguration
                }
            ) && view.runs.get(&install.install_id) == Some(&pair)
                && install.delivery > 0
                && self.may_redeliver(&install.install_id);
            if redeliver {
                // Behind by one: the next reconcile counts a new delivery if
                // this is still the row's, with a new key.
                view.runs.insert(
                    install.install_id.clone(),
                    (install.generation, install.delivery - 1),
                );
            }
            drop(view);

            let Ok(install_id) = Uuid::parse_str(install.install_id.as_str()) else {
                return;
            };
            let (run_state, failure) = install_state(&state);
            if let Err(error) = self
                .store
                .record_status(harness, install_id, pair, run_state, failure)
                .await
            {
                tracing::error!(error = ?error, "could not record an install's state");
            }
            if finished_stop {
                // A move or removal waiting on this stop may finish now; for a
                // stale install it is a no-op.
                self.finish_checkpoint(install_id).await;
            }
            if redeliver {
                tracing::info!("redelivering an install whose configuration was refused");
                self.reconcile(harness).await;
            }
        }
        .instrument(span)
        .await;
    }

    /// Whether `install` may be redelivered after a `badConfiguration` now;
    /// if so, counts this one.
    fn may_redeliver(&self, install: &TeammateInstallId) -> bool {
        let now = tokio::time::Instant::now();
        let mut redelivered = self
            .redelivered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Only redeliveries still inside the window matter; forget older ones.
        redelivered.retain(|_, last| now.duration_since(*last) < BAD_CONFIGURATION_REDELIVERY);
        if redelivered.contains_key(install) {
            tracing::warn!("configuration refused again; not redelivering yet");
            return false;
        }
        redelivered.insert(install.clone(), now);
        true
    }

    /// The machine's installs changed elsewhere: reconcile if this replica
    /// holds its socket.
    pub(crate) async fn installs_changed(self: &Arc<Self>, harness: HarnessId) {
        if self.sockets.dial(harness).is_some() {
            self.reconcile(harness).await;
        }
    }

    /// Someone asked to check the machine's hosting again: ask its runtime,
    /// if this replica holds its socket. It answers with a fresh report.
    pub(crate) async fn recheck_host(&self, harness: HarnessId) {
        let sent = self.sockets.recheck(harness).await;
        tracing::Span::current().record("sent", sent);
    }

    async fn finish_checkpoint(&self, install_id: Uuid) {
        if let Err(error) = self.issuer.checkpointed(install_id).await {
            tracing::warn!(error = %error, %install_id, "could not finish an install's checkpoint; it finishes at the next try");
        }
    }

    /// Bring the machine's runtime in line with its install rows.
    async fn reconcile(self: &Arc<Self>, harness: HarnessId) {
        let Some((connection, hosts_teammates)) = self.sockets.dial(harness) else {
            return;
        };
        let rows = match self.store.installs_on(harness).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(error = ?error, %harness, "could not read a machine's installs");
                return;
            }
        };

        let machine = self.view(harness);
        let mut guard = machine.lock().await;
        let view = &mut *guard;
        if view.connection != Some(connection) {
            if hosts_teammates {
                // Wait for this dial's report: until then nobody knows what
                // the runtime runs.
                return;
            }
            // A runtime that can't host teammates runs none of them.
            *view = MachineView {
                connection: Some(connection),
                ..MachineView::default()
            };
        }

        let mut wanted = HashSet::new();
        for row in rows {
            let Some(install_id) = protocol_id(row.install_id) else {
                continue;
            };
            wanted.insert(install_id.clone());
            let reported = view.runs.get(&install_id).copied();

            if row.checkpoint.is_some() {
                self.stop_for_checkpoint(
                    harness,
                    connection,
                    view,
                    &install_id,
                    reported,
                    row.install_id,
                )
                .await;
                continue;
            }
            let row = self.with_current_image(view.arch, row).await;
            let caught_up = reported.is_some_and(|pair| pair >= (row.generation, row.delivery))
                && row.delivery > 0;
            if caught_up || !hosts_teammates {
                continue;
            }
            self.deliver(
                harness,
                connection,
                view,
                &install_id,
                reported,
                row.install_id,
            )
            .await;
        }

        // What the runtime keeps that isn't this machine's any more: moved
        // away or removed while it was offline.
        let stale: Vec<_> = view
            .runs
            .iter()
            .filter(|(install_id, _)| !wanted.contains(*install_id))
            .filter(|(install_id, _)| !view.stopping.contains(*install_id))
            .map(|(install_id, pair)| (install_id.clone(), *pair))
            .collect();
        for (install_id, (generation, delivery)) in stale {
            let install = TeammateInstall {
                install_id: install_id.clone(),
                generation,
                delivery,
            };
            if self
                .sockets
                .stop(harness, connection, install, traceparent())
                .await
            {
                tracing::info!(install_id = install_id.as_str(), "stopping a stale install");
                view.stopping.insert(install_id);
            }
        }
    }

    /// `row`, given its next generation when the image for `arch` differs
    /// from the one it was last delivered, so it is delivered anew.
    async fn with_current_image(
        &self,
        arch: Option<HostArch>,
        row: TeammateInstallRecord,
    ) -> TeammateInstallRecord {
        let Some(image) = arch.and_then(|arch| (self.images)(arch)) else {
            return row;
        };
        if row
            .image_id
            .as_ref()
            .is_none_or(|delivered| *delivered == image.image_id)
        {
            return row;
        }
        match self
            .store
            .new_image_generation(row.install_id, row.generation, &image.image_id)
            .await
        {
            Ok(Some(updated)) => {
                tracing::info!(
                    install_id = %row.install_id,
                    generation = updated.generation,
                    "a new runtime image: the install's next generation"
                );
                updated
            }
            Ok(None) => row,
            Err(error) => {
                tracing::error!(error = ?error, "could not give an install its new image");
                row
            }
        }
    }

    /// Stop an install whose move or removal waits on it; finish at once
    /// when the runtime doesn't run it.
    async fn stop_for_checkpoint(
        self: &Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        view: &mut MachineView,
        install_id: &TeammateInstallId,
        reported: Option<(u64, u64)>,
        row_id: Uuid,
    ) {
        let Some((generation, delivery)) = reported else {
            self.finish_checkpoint(row_id).await;
            return;
        };
        if view.stopping.contains(install_id) {
            return;
        }
        let install = TeammateInstall {
            install_id: install_id.clone(),
            generation,
            delivery,
        };
        if !self
            .sockets
            .stop(harness, connection, install, traceparent())
            .await
        {
            return;
        }
        view.stopping.insert(install_id.clone());
        tracing::info!(
            install_id = install_id.as_str(),
            "stopping an install for its move or removal"
        );

        // Give the agent its last push, then finish anyway.
        let delivery = Arc::clone(self);
        tokio::spawn(
            async move {
                tokio::time::sleep(CHECKPOINT_TIMEOUT).await;
                delivery.finish_checkpoint(row_id).await;
            }
            .in_current_span(),
        );
    }

    /// Mint and send the next delivery of an install.
    async fn deliver(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        view: &mut MachineView,
        install_id: &TeammateInstallId,
        reported: Option<(u64, u64)>,
        row_id: Uuid,
    ) {
        let span = tracing::info_span!(
            "teammate.deliver",
            install_id = install_id.as_str(),
            generation = tracing::field::Empty,
            delivery = tracing::field::Empty,
            sent = tracing::field::Empty,
        );
        async {
            let issued = match self.issuer.issue(harness, row_id, reported).await {
                Ok(Some(issued)) => issued,
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(error = ?error, "could not issue an install's credentials");
                    return;
                }
            };
            let span = tracing::Span::current();
            span.record("generation", issued.generation);
            span.record("delivery", issued.delivery);
            let install = TeammateInstall {
                install_id: install_id.clone(),
                generation: issued.generation,
                delivery: issued.delivery,
            };
            let environment = AgentEnvironment(
                issued
                    .env
                    .expose()
                    .iter()
                    .map(|(key, value)| (key.as_str().to_owned(), value.clone()))
                    .collect(),
            );
            let sent = self
                .sockets
                .run(
                    harness,
                    connection,
                    install,
                    issued.image.clone(),
                    environment,
                    traceparent(),
                )
                .await;
            span.record("sent", sent);
            // A lost send leaves the runtime behind; its next report
            // redelivers as the next delivery.
            if sent {
                view.runs_at_least(install_id, (issued.generation, issued.delivery));
            }
        }
        .instrument(span)
        .await;
    }
}

/// Ask whichever replica holds `harness`'s socket to reconcile its
/// installs. No credential travels on the bus.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct TeammatesChanged {
    pub(crate) teammates_changed_harness: HarnessId,
    /// W3C context of the change, so the delivery joins its trace.
    pub(crate) trace_context: HashMap<String, String>,
}

impl TeammatesChanged {
    pub(crate) fn new(harness: HarnessId) -> Self {
        Self {
            teammates_changed_harness: harness,
            trace_context: agent_harness::outbound::forward::current_trace_context(),
        }
    }

    pub(crate) fn span(&self) -> tracing::Span {
        let span = tracing::info_span!(
            "teammate.changed",
            otel.kind = "consumer",
            messaging.system = "redis",
            harness_id = %self.teammates_changed_harness,
        );
        agent_harness::outbound::forward::adopt_trace_context(&span, &self.trace_context);
        span
    }
}

/// Ask whichever replica holds `harness`'s socket to have its runtime check
/// its teammate hosting again.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct TeammateHostRecheck {
    pub(crate) recheck_teammate_host: HarnessId,
    /// W3C context of the request, so the recheck joins its trace.
    pub(crate) trace_context: HashMap<String, String>,
}

impl TeammateHostRecheck {
    pub(crate) fn new(harness: HarnessId) -> Self {
        Self {
            recheck_teammate_host: harness,
            trace_context: agent_harness::outbound::forward::current_trace_context(),
        }
    }

    pub(crate) fn span(&self) -> tracing::Span {
        let span = tracing::info_span!(
            "teammate.recheck_host",
            otel.kind = "consumer",
            messaging.system = "redis",
            harness_id = %self.recheck_teammate_host,
            sent = tracing::field::Empty,
        );
        agent_harness::outbound::forward::adopt_trace_context(&span, &self.trace_context);
        span
    }
}

struct ChangedState<Auth> {
    redis: redis::Client,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for ChangedState<Auth> {
    fn clone(&self) -> Self {
        Self {
            redis: self.redis.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<ChangedState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ChangedState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Internal-only, called by the authentication service:
/// `POST /internal/teammates/{harness_id}/changed` after an invite, move or
/// removal on an own machine, which broadcasts [`TeammatesChanged`] on the
/// runtime bus; `POST /internal/teammates/{harness_id}/recheck` when its
/// owner asks to check the machine again, which broadcasts
/// [`TeammateHostRecheck`].
pub(crate) fn router<Auth: MacroAuthorizationService>(
    redis: redis::Client,
    authorization_state: MacroAuthorizationState<Auth>,
) -> Router {
    Router::new()
        .route(
            "/internal/teammates/{harness_id}/changed",
            post(installs_changed::<Auth>),
        )
        .route(
            "/internal/teammates/{harness_id}/recheck",
            post(recheck_host::<Auth>),
        )
        .with_state(ChangedState {
            redis,
            authorization_state,
        })
}

#[tracing::instrument(skip_all, fields(%harness_id))]
async fn installs_changed<Auth: MacroAuthorizationService>(
    State(state): State<ChangedState<Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(harness_id): Path<Uuid>,
) -> StatusCode {
    let changed = TeammatesChanged::new(HarnessId::new_from_uuid(harness_id));
    match crate::runtime_commands::publish(&state.redis, &changed).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(error) => {
            tracing::error!(error = ?error, "could not broadcast a teammate change");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

#[tracing::instrument(skip_all, fields(%harness_id))]
async fn recheck_host<Auth: MacroAuthorizationService>(
    State(state): State<ChangedState<Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(harness_id): Path<Uuid>,
) -> StatusCode {
    let recheck = TeammateHostRecheck::new(HarnessId::new_from_uuid(harness_id));
    match crate::runtime_commands::publish(&state.redis, &recheck).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(error) => {
            tracing::error!(error = ?error, "could not broadcast a teammate host recheck");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}
