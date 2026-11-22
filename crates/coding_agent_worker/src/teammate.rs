//! Agent teammates hosted on this machine, each in the teammate runtime
//! container (docs/design/teammate-runtime.md).
//!
//! The service sends `RunTeammate` and `StopTeammate` over the runtime
//! socket; [`Teammates`] keeps the installs in a store
//! (`~/.macrod/teammates/<harness>/`), runs one supervisor per install
//! against the container engine, and reports each state change back as
//! `TeammateStatus`. Containers outlive macrod: a restarted macrod adopts
//! the ones still running. The engine is never installed here, only found.

pub mod cli;
pub mod command;
pub mod egress;
pub mod engine;
pub mod host;
pub mod hosted_unit;
pub mod ingest;
pub mod isolation;
pub mod netfacts;
pub mod store;
pub mod supervisor;

#[cfg(test)]
pub(crate) mod test;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{
    AgentEnvironment, ContainerEngineKind, EngineIsolation, InstalledEngine, TeammateHostProblem,
    TeammateHostReport, TeammateImage, TeammateInstall, TeammateInstallId, TeammateRunFailure,
    TeammateRunState, ToRuntimeMessage, ToServerMessage,
};
use tokio::sync::{broadcast, mpsc};
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

use crate::harness::{CredentialPath, TeammateEvent};
use engine::{
    Delivery, Engine, EngineUnavailable, container_name, network_name, provider_volume_name,
    volume_name,
};
use host::{Platform, can_host, host_report};
use store::{Lifecycle, StopCause, Store, StoredInstall};
use supervisor::{STOP_GRACE, Supervision, supervise, terminal_failure};
use teammate_lifecycle::supervisor::{ExitEvent, Phase};

/// The teammate's seccomp profile: Docker's default plus the user
/// namespace calls bubblewrap and Chromium's sandbox need, each only
/// without the capability that would otherwise allow it.
const SECCOMP_PROFILE: &str = include_str!("../../../nix/macro-box/files/teammate-seccomp.json");

/// How long the engine may take to say what it is before macrod reports it
/// unreachable: a hung engine must not hold up the runtime connection.
const ENGINE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// How often an unreachable engine is checked again on a live connection:
/// the web polls the machine's report every 15 s and says it can't reach
/// the engine right now.
const ENGINE_RECHECK: Duration = Duration::from_secs(30);

/// The install id the isolation probe runs under.
const PROBE_INSTALL: &str = "isolation-probe";

/// How long the user-namespace probe may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

/// Write the seccomp profile where the engine reads it,
/// `~/.macrod/teammates/teammate-seccomp.json`, whole, and return its path.
/// The engine reads the file when it creates a container (on Docker
/// Desktop, through its file share).
#[cfg(not(test))]
pub fn install_seccomp_profile() -> rootcause::Result<PathBuf> {
    let directory = store::teammates_directory()?;
    store::write_file(
        &directory,
        "teammate-seccomp.json",
        SECCOMP_PROFILE.as_bytes(),
    )
}

/// The teammates of the macrod on this machine, on its real engine.
#[cfg(not(test))]
pub type HostTeammates = Teammates<cli::CliEngine>;

/// In tests, the bridge serves teammates on the fake engine.
#[cfg(test)]
pub type HostTeammates = Teammates<test::FakeEngine>;

/// The teammates this harness's macrod hosts, on whichever engine is
/// installed, kept in `~/.macrod/teammates/<harness>/`.
#[cfg(not(test))]
pub fn host(
    harness_id: impl std::fmt::Display,
    ingest: ingest::IngestTarget,
    network: Option<&str>,
    settings: &crate::config::TeammatesSettings,
) -> rootcause::Result<HostTeammates> {
    let seccomp_profile = install_seccomp_profile()?;
    let network = network
        .map(engine::TeammateNetwork::new)
        .transpose()
        .map_err(|error| rootcause::report!("[macro] teammate_network: {error}"))?;
    let allow = settings
        .allow
        .iter()
        .map(|entry| {
            let network = entry.network.parse().map_err(|_| {
                rootcause::report!("[[teammates.allow]]: {} is not a network", entry.network)
            })?;
            egress::Allow::new(network, entry.ports.clone())
                .map_err(|error| rootcause::report!("[[teammates.allow]]: {error}"))
        })
        .collect::<rootcause::Result<Vec<_>>>()?;
    let mut teammates = Teammates::new(
        cli::CliEngine::with_choice(settings.engine),
        Store::for_harness(harness_id)?,
        Platform::current(),
        seccomp_profile,
        Egress { network, allow },
    );
    // The lifecycle spans go to the service from here on; without a client
    // they are dropped, and teammates are still hosted.
    match ingest::HttpPost::new(ingest) {
        Ok(post) => {
            teammates._ingest = Some(ingest::Ingest::start(
                &crate::telemetry::TEAMMATE_SPANS,
                post,
            ));
        }
        Err(error) => tracing::warn!(error = %error, "could not set up the teammate span ingest"),
    }
    Ok(teammates)
}

/// What a teammate's network may reach beyond the public internet.
#[derive(Debug, Clone, Default)]
pub struct Egress {
    /// A local stack's network the holder also joins (development).
    pub network: Option<engine::TeammateNetwork>,
    /// The explicit exceptions (`[[teammates.allow]]`).
    pub allow: Vec<egress::Allow>,
}

/// An install's state, as reported to the service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    /// The install and its delivery.
    pub install: TeammateInstall,
    /// Its state.
    pub state: TeammateRunState,
}

impl From<Status> for ToServerMessage {
    fn from(status: Status) -> Self {
        ToServerMessage::TeammateStatus {
            install: status.install,
            state: status.state,
        }
    }
}

/// A teammate message from the service.
#[derive(Debug)]
pub enum TeammateRequest {
    /// Run this delivery.
    Run {
        /// The install and delivery.
        install: TeammateInstall,
        /// The image.
        image: TeammateImage,
        /// Its credentials and addresses.
        environment: AgentEnvironment,
        /// The sending span's W3C `traceparent`.
        traceparent: Option<String>,
    },
    /// Stop and delete the install.
    Stop {
        /// The install and generation.
        install: TeammateInstall,
        /// The sending span's W3C `traceparent`.
        traceparent: Option<String>,
    },
}

impl TeammateRequest {
    /// The request a runtime message carries; any other message is handed
    /// back.
    pub fn from_message(message: ToRuntimeMessage) -> Result<Self, Box<ToRuntimeMessage>> {
        match message {
            ToRuntimeMessage::RunTeammate {
                install,
                image,
                environment,
                traceparent,
            } => Ok(Self::Run {
                install,
                image,
                environment,
                traceparent,
            }),
            ToRuntimeMessage::StopTeammate {
                install,
                traceparent,
            } => Ok(Self::Stop {
                install,
                traceparent,
            }),
            other => Err(Box::new(other)),
        }
    }
}

/// How long an agent has to stop once the machine's credentials are
/// refused: its own key is revoked with them, so it can't sync anyway.
pub const CREDENTIALS_REFUSED_GRACE: Duration = Duration::from_secs(10);

/// How long the credentials must stay refused (a second refusal this long
/// after the first, none accepted between) before the teammates stop: one
/// refusal can be a passing auth or proxy failure.
pub const REFUSAL_PERSISTS: Duration = Duration::from_secs(10);

/// How long after the first refusal a second still counts: one later than
/// this starts the wait over, so two blips far apart never add up.
pub const REFUSAL_WINDOW: Duration = Duration::from_secs(60);

/// The teammates this macrod hosts. Requests are handled one at a time, in
/// order; dropping it stops supervising (the containers keep running).
pub struct Teammates<EngineImpl: Engine> {
    shared: Arc<Shared<EngineImpl>>,
    requests: mpsc::UnboundedSender<Work>,
    _manager: AbortOnDropHandle<()>,
    /// Sends the lifecycle spans while macrod hosts teammates.
    _ingest: Option<ingest::Ingest>,
}

struct Shared<EngineImpl> {
    engine: EngineImpl,
    store: Store,
    platform: Platform,
    seccomp_profile: PathBuf,
    /// What every install's network may reach.
    egress: Egress,
    statuses: broadcast::Sender<Status>,
    latest: Mutex<BTreeMap<TeammateInstallId, Status>>,
    /// The last engine check.
    host: Mutex<Option<TeammateHostReport>>,
    /// Each engine's last finished isolation probe: a probe that times out
    /// is no verdict, and the check keeps this one.
    isolation: Mutex<Vec<(ContainerEngineKind, EngineIsolation)>>,
    /// Whether a probe of the last engine check timed out, so it is made
    /// again on the live connection.
    inconclusive: AtomicBool,
    resumed: AtomicBool,
}

/// What an isolation probe found.
enum Probed {
    /// It finished (or wasn't made: no image here yet).
    Finished(EngineIsolation),
    /// It took too long; with the engine's last finished result, if any.
    TimedOut(Option<EngineIsolation>),
}

enum Work {
    Request(TeammateRequest),
    Resume,
    CredentialsRefused(CredentialPath),
    CredentialsAccepted(CredentialPath),
    StoppedCalling(CredentialPath),
}

impl<EngineImpl: Engine> Teammates<EngineImpl> {
    /// Start handling requests. Kept installs are resumed after the first
    /// engine check that finds a usable engine ([`Teammates::detect`]).
    pub fn new(
        engine: EngineImpl,
        store: Store,
        platform: Platform,
        seccomp_profile: PathBuf,
        egress: Egress,
    ) -> Self {
        let (statuses, _) = broadcast::channel(64);
        let shared = Arc::new(Shared {
            engine,
            store,
            platform,
            seccomp_profile,
            egress,
            statuses,
            latest: Mutex::new(BTreeMap::new()),
            host: Mutex::new(None),
            isolation: Mutex::new(Vec::new()),
            inconclusive: AtomicBool::new(false),
            resumed: AtomicBool::new(false),
        });
        let (requests, queue) = mpsc::unbounded_channel();
        let manager = tokio::spawn(manage(Arc::clone(&shared), queue));
        Self {
            shared,
            requests,
            _manager: AbortOnDropHandle::new(manager),
            _ingest: None,
        }
    }

    /// Check the engine and the machine, and remember the result for the
    /// requests that follow. The report lists the kept installs.
    pub async fn detect(&self) -> TeammateHostReport {
        let shared = &self.shared;
        let span = tracing::info_span!(
            "teammate.engine_check",
            engine = tracing::field::Empty,
            problem = tracing::field::Empty
        );
        let report = async {
            let installs = shared.store.installs();
            let (engine, engines) = self.choose_engine(&installs).await;
            let user_namespaces = match &engine {
                Ok(info) if info.supported_version => self.probe_user_namespaces(&installs).await,
                _ => None,
            };
            host_report(
                shared.platform,
                engine,
                user_namespaces,
                engines,
                installs.into_iter().map(|stored| stored.install).collect(),
            )
        }
        .instrument(span.clone())
        .await;
        if let Some(engine) = &report.engine {
            span.record("engine", tracing::field::debug(engine.kind));
        }
        if let Some(problem) = &report.problem {
            span.record("problem", tracing::field::debug(problem));
        }
        *lock(&shared.host) = Some(report.clone());
        if let Err(error) = shared.store.save_host_report(&report) {
            tracing::warn!(error = ?error, "could not keep the host report");
        }

        if can_host(&report) && !shared.resumed.swap(true, Ordering::SeqCst) {
            let _ = self.requests.send(Work::Resume);
        }
        report
    }

    /// Probe user namespaces with a kept install's image, when one is here:
    /// the probe needs an image, and macrod fetches none just to probe.
    /// Check every installed engine the choice allows, and pick one: the
    /// first (Docker, then Podman) whose isolation probe passes, else the
    /// first not yet probed (no image here), else the first that answers.
    /// Deterministic, and the list says why.
    async fn choose_engine(
        &self,
        installs: &[StoredInstall],
    ) -> (
        Result<engine::EngineInfo, EngineUnavailable>,
        Vec<InstalledEngine>,
    ) {
        let engine = &self.shared.engine;
        let kinds = engine.installed();
        if kinds.is_empty() {
            return (Err(EngineUnavailable::NotInstalled), Vec::new());
        }
        let mut listed = Vec::new();
        // Engines whose probe timed out with no finished result: unknown,
        // so reported like an engine that didn't answer.
        let mut undecided = Vec::new();
        let mut inconclusive = false;
        for kind in &kinds {
            let info = tokio::time::timeout(ENGINE_CHECK_TIMEOUT, engine.select(*kind))
                .await
                .unwrap_or(Err(EngineUnavailable::Unreachable));
            let isolation = match self.probe_isolation(&info, installs).await {
                Probed::Finished(isolation) => {
                    if isolation != EngineIsolation::NotProbed {
                        let mut kept = lock(&self.shared.isolation);
                        kept.retain(|(engine, _)| engine != kind);
                        kept.push((*kind, isolation));
                    }
                    isolation
                }
                Probed::TimedOut(kept) => {
                    inconclusive = true;
                    kept.unwrap_or_else(|| {
                        undecided.push(*kind);
                        EngineIsolation::NotProbed
                    })
                }
            };
            listed.push(InstalledEngine {
                kind: *kind,
                version: info.as_ref().ok().map(|info| info.version.clone()),
                rootless: info.as_ref().is_ok_and(|info| info.rootless),
                isolation,
            });
        }
        let answered = |engine: &&InstalledEngine| engine.version.is_some();
        let chosen = listed
            .iter()
            .find(|engine| engine.isolation == EngineIsolation::Enforced)
            .or_else(|| {
                listed
                    .iter()
                    .filter(answered)
                    .find(|engine| engine.isolation == EngineIsolation::NotProbed)
            })
            .or_else(|| listed.iter().find(answered))
            .map_or(kinds[0], |engine| engine.kind);
        let info = if undecided.contains(&chosen) {
            Err(EngineUnavailable::Unreachable)
        } else {
            tokio::time::timeout(ENGINE_CHECK_TIMEOUT, engine.select(chosen))
                .await
                .unwrap_or(Err(EngineUnavailable::Unreachable))
        };
        self.shared
            .inconclusive
            .store(inconclusive, Ordering::SeqCst);
        (info, listed)
    }

    /// Whether the selected engine can put an egress policy in place: a
    /// probe install's holder, guard and readback, with a kept install's
    /// image (not probed when there is none here yet).
    async fn probe_isolation(
        &self,
        engine: &Result<engine::EngineInfo, EngineUnavailable>,
        installs: &[StoredInstall],
    ) -> Probed {
        let Ok(info) = engine else {
            return Probed::Finished(EngineIsolation::NotProbed);
        };
        if !info.supported_version {
            return Probed::Finished(EngineIsolation::NotProbed);
        }
        let kind = info.kind;
        let engine = &self.shared.engine;
        for stored in installs {
            let image_id = &stored.image.image_id;
            if !matches!(engine.image_id(image_id).await, Ok(Some(local)) if &local == image_id) {
                continue;
            }
            let Ok(probe) = TeammateInstallId::new(PROBE_INSTALL) else {
                return Probed::Finished(EngineIsolation::NotProbed);
            };
            let network = network_name(&probe);
            let probed = async {
                engine
                    .create_network(&network)
                    .await
                    .map_err(isolation::IsolationError::Engine)?;
                isolation::isolate(
                    engine,
                    &isolation::Isolation {
                        install_id: probe.clone(),
                        image_id: image_id.clone(),
                        networks: vec![network.clone()],
                        allow: &[],
                        services: &[],
                    },
                )
                .await
            };
            let outcome = tokio::time::timeout(PROBE_TIMEOUT, probed).await;
            let _ = engine.remove_container(&engine::holder_name(&probe)).await;
            let _ = engine.remove_network(&network).await;
            return match outcome {
                Ok(Ok(_)) => Probed::Finished(EngineIsolation::Enforced),
                Ok(Err(error)) => {
                    tracing::warn!(error = %error, "this engine can't enforce a teammate's egress policy");
                    Probed::Finished(EngineIsolation::Unavailable {
                        reason: error.problem(),
                    })
                }
                Err(_) => {
                    let kept = lock(&self.shared.isolation)
                        .iter()
                        .find(|(engine, _)| *engine == kind)
                        .map(|(_, isolation)| *isolation);
                    tracing::warn!(kept = ?kept, "the network isolation probe took too long; keeping the last finished result and checking again");
                    Probed::TimedOut(kept)
                }
            };
        }
        Probed::Finished(EngineIsolation::NotProbed)
    }

    async fn probe_user_namespaces(&self, installs: &[StoredInstall]) -> Option<bool> {
        let engine = &self.shared.engine;
        for stored in installs {
            let image_id = &stored.image.image_id;
            if !matches!(engine.image_id(image_id).await, Ok(Some(local)) if &local == image_id) {
                continue;
            }
            let probe = engine.user_namespaces(image_id, &self.shared.seccomp_profile);
            return match tokio::time::timeout(PROBE_TIMEOUT, probe).await {
                Ok(Ok(available)) => Some(available),
                Ok(Err(error)) => {
                    tracing::warn!(error = %error, "could not probe user namespaces");
                    None
                }
                Err(_) => {
                    tracing::warn!("the user-namespace probe took too long");
                    None
                }
            };
        }
        tracing::info!("no teammate image is here yet: the user-namespace probe is skipped");
        None
    }

    /// Queue a request from the service.
    pub fn handle(&self, request: TeammateRequest) {
        let _ = self.requests.send(Work::Request(request));
    }

    /// The service refused this machine's harness credentials (it was
    /// unpaired or removed): stop every teammate it runs.
    pub fn credentials_refused(&self, path: CredentialPath) {
        let _ = self.requests.send(Work::CredentialsRefused(path));
    }

    /// The service accepted this machine's harness credentials (a runtime
    /// dial went through): run again what a refusal stopped.
    pub fn credentials_accepted(&self, path: CredentialPath) {
        let _ = self.requests.send(Work::CredentialsAccepted(path));
    }

    /// Nothing calls the service on `path` any more (its runtime
    /// supervisor ended): forget its refusal, so it no longer holds the
    /// agents stopped. They run again on the next accepted call.
    pub fn stopped_calling(&self, path: CredentialPath) {
        let _ = self.requests.send(Work::StoppedCalling(path));
    }

    /// State changes from now on.
    pub fn subscribe(&self) -> broadcast::Receiver<Status> {
        self.shared.statuses.subscribe()
    }

    /// The last state of every install reported since macrod started.
    pub fn latest(&self) -> Vec<Status> {
        lock(&self.shared.latest).values().cloned().collect()
    }
}

/// One runtime connection's teammate traffic: the host report and every
/// state change go to the service, its teammate messages come here.
pub struct Link {
    teammates: Arc<HostTeammates>,
    statuses: broadcast::Receiver<Status>,
    /// The engine checks made while the engine is unreachable: their own
    /// task, so a relay busy with other traffic can't cancel one midway.
    rechecks: Option<(
        mpsc::UnboundedReceiver<TeammateEvent>,
        AbortOnDropHandle<()>,
    )>,
}

impl Link {
    /// Open the connection's traffic: send the report from the engine check
    /// that preceded the dial, then each install's last state, so the
    /// service sees where every install is after a reconnect.
    pub fn open(
        teammates: Arc<HostTeammates>,
        report: TeammateHostReport,
        to_service: &mpsc::UnboundedSender<ToServerMessage>,
    ) -> Self {
        // Subscribed first: a change between the two is sent twice, never
        // lost.
        let statuses = teammates.subscribe();
        let listed = can_host(&report);
        let recheck = report.problem == Some(TeammateHostProblem::EngineUnreachable)
            || teammates.shared.inconclusive.load(Ordering::SeqCst);
        let _ = to_service.send(ToServerMessage::TeammateHost { report });
        for status in teammates.latest() {
            let _ = to_service.send(status.into());
        }
        let rechecks = recheck.then(|| {
            let (events, rechecks) = mpsc::unbounded_channel();
            let task = tokio::spawn(recheck_engine(Arc::clone(&teammates), listed, events));
            (rechecks, AbortOnDropHandle::new(task))
        });
        Self {
            teammates,
            statuses,
            rechecks,
        }
    }

    /// The next report to send, or a redial.
    pub async fn next(&mut self) -> TeammateEvent {
        let recheck = async {
            match &mut self.rechecks {
                Some((events, _task)) => match events.recv().await {
                    Some(event) => event,
                    None => std::future::pending().await,
                },
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            event = recheck => event,
            status = next_status(&mut self.statuses) => TeammateEvent::Send(status.into()),
        }
    }

    /// Handle a teammate message from the service.
    pub fn handle(&self, request: TeammateRequest) {
        self.teammates.handle(request);
    }
}

/// While the engine check finds the engine unreachable, or a probe timed
/// out, check again every [`ENGINE_RECHECK`] and report each result on the
/// live connection. Once the machine can host on a connection whose dial
/// didn't list the teammate capability (`listed`), ask for a redial instead
/// until the link ends; a conclusive result ends the checks.
async fn recheck_engine(
    teammates: Arc<HostTeammates>,
    listed: bool,
    events: mpsc::UnboundedSender<TeammateEvent>,
) {
    let mut ticks =
        tokio::time::interval_at(tokio::time::Instant::now() + ENGINE_RECHECK, ENGINE_RECHECK);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        let report = teammates.detect().await;
        if !listed && can_host(&report) {
            if events.send(TeammateEvent::Redial).is_err() {
                return;
            }
            continue;
        }
        let again = report.problem == Some(TeammateHostProblem::EngineUnreachable)
            || teammates.shared.inconclusive.load(Ordering::SeqCst);
        let sent = events.send(TeammateEvent::Send(ToServerMessage::TeammateHost {
            report,
        }));
        if sent.is_err() || !again {
            return;
        }
    }
}

/// The next state change, past any dropped ones.
async fn next_status(statuses: &mut broadcast::Receiver<Status>) -> Status {
    loop {
        match statuses.recv().await {
            Ok(status) => return status,
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                tracing::warn!(
                    skipped,
                    "teammate states were dropped before they were sent"
                );
            }
            Err(broadcast::error::RecvError::Closed) => std::future::pending().await,
        }
    }
}

impl<EngineImpl: Engine> Shared<EngineImpl> {
    fn report(&self, install: &TeammateInstall, state: TeammateRunState) {
        let status = Status {
            install: install.clone(),
            state,
        };
        tracing::info!(install_id = install.install_id.as_str(), generation = install.generation, delivery = install.delivery, state = ?status.state, "teammate state");
        lock(&self.latest).insert(install.install_id.clone(), status.clone());
        let _ = self.statuses.send(status);
    }

    fn usable_host(&self) -> bool {
        lock(&self.host).as_ref().is_some_and(can_host)
    }
}

fn lock<Value>(mutex: &Mutex<Value>) -> std::sync::MutexGuard<'_, Value> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Handle requests in order, owning the supervisors.
async fn manage<EngineImpl: Engine>(
    shared: Arc<Shared<EngineImpl>>,
    mut queue: mpsc::UnboundedReceiver<Work>,
) {
    // Dropped with the manager: dropping [`Teammates`] stops supervising.
    let mut supervisors: HashMap<TeammateInstallId, AbortOnDropHandle<()>> = HashMap::new();
    // Each path still refused, and the first refusal of its window. An
    // accept clears only its own path: a dial an edge keeps refusing isn't
    // cleared by the stream's calls, so the agents don't churn.
    let mut refused: HashMap<CredentialPath, tokio::time::Instant> = HashMap::new();
    while let Some(work) = queue.recv().await {
        match work {
            Work::Resume => resume(&shared, &mut supervisors),
            Work::CredentialsRefused(path) => {
                let now = tokio::time::Instant::now();
                // A refusal past the window starts it over: blips far apart
                // never add up.
                let first = refused.entry(path).or_insert(now);
                if now.duration_since(*first) > REFUSAL_WINDOW {
                    *first = now;
                }
                let persists = now.duration_since(*first) >= REFUSAL_PERSISTS;
                let span = tracing::info_span!("teammate.credentials_refused", ?path, persists);
                if persists {
                    stop_all(&shared, &mut supervisors).instrument(span).await;
                } else {
                    span.in_scope(|| {
                        tracing::warn!("the service refused this machine's credentials; stopping its teammates if it still does in {REFUSAL_PERSISTS:?}");
                    });
                }
            }
            // Not an accept: the agents wait for the next accepted call.
            Work::StoppedCalling(path) => {
                if refused.remove(&path).is_some() {
                    tracing::info!(
                        ?path,
                        "nothing calls the service on a refused path any more; its refusal no longer holds the teammates"
                    );
                }
            }
            Work::CredentialsAccepted(path) => {
                refused.remove(&path);
                if refused.is_empty() {
                    let span = tracing::info_span!("teammate.credentials_accepted", ?path);
                    let _entered = span.enter();
                    start_refused(&shared, &mut supervisors);
                }
            }
            Work::Request(TeammateRequest::Run {
                install,
                image,
                environment,
                traceparent,
            }) => {
                let span = tracing::info_span!(
                    "teammate.run",
                    install_id = install.install_id.as_str(),
                    generation = install.generation,
                    delivery = install.delivery,
                );
                hosted_runtimes::domain::telemetry::attach(&span, traceparent.as_deref());
                run(&shared, &mut supervisors, install, image, &environment)
                    .instrument(span)
                    .await;
            }
            Work::Request(TeammateRequest::Stop {
                install,
                traceparent,
            }) => {
                let span = tracing::info_span!(
                    "teammate.stop",
                    install_id = install.install_id.as_str(),
                    generation = install.generation,
                    delivery = install.delivery,
                );
                hosted_runtimes::domain::telemetry::attach(&span, traceparent.as_deref());
                stop(&shared, &mut supervisors, install)
                    .instrument(span)
                    .await;
            }
        }
    }
}

/// Supervise every kept install again after macrod started, adopting the
/// containers still running. An install the policy gave up on stays down
/// until a new delivery, and its failure is reported again.
fn resume<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
) {
    if !shared.usable_host() {
        return;
    }
    for stored in shared.store.installs() {
        if supervisors.contains_key(&stored.install.install_id) {
            continue;
        }
        match stored.lifecycle.policy.phase() {
            Phase::Failed { reason } => {
                let reason = terminal_failure(reason);
                shared.report(&stored.install, TeammateRunState::Failed { reason });
                continue;
            }
            Phase::Stopped => {
                shared.report(&stored.install, TeammateRunState::Stopped);
                continue;
            }
            Phase::Idle | Phase::Running { .. } | Phase::Waiting { .. } => {}
        }
        let id = stored.install.install_id.clone();
        let handle = spawn_supervisor(shared, stored, true);
        supervisors.insert(id, handle);
    }
}

/// Keep a newer delivery and supervise it in place of the older one. A
/// delivery no newer than the kept one is ignored, so a late or repeated
/// copy never restarts the agent or replaces newer credentials.
async fn run<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
    install: TeammateInstall,
    image: TeammateImage,
    environment: &AgentEnvironment,
) {
    let id = install.install_id.clone();
    if let Ok(Some(kept)) = shared.store.read(&id)
        && Delivery::of(&kept.install) >= Delivery::of(&install)
    {
        tracing::info!(
            kept_generation = kept.install.generation,
            kept_delivery = kept.install.delivery,
            "ignoring a teammate delivery no newer than the kept one"
        );
        return;
    }

    if !shared.usable_host() {
        shared.report(
            &install,
            TeammateRunState::Failed {
                reason: TeammateRunFailure::HostUnsupported,
            },
        );
        return;
    }

    // The policy's state and the settled image carry over; the image
    // update is this delivery's own.
    let kept = shared.store.read(&id).ok().flatten();
    let lifecycle = Lifecycle {
        update: None,
        stopped_for: None,
        ..kept.map(|kept| kept.lifecycle).unwrap_or_default()
    };
    let stored = StoredInstall {
        install,
        image,
        lifecycle,
    };
    if let Err(error) = shared.store.save(&stored, &environment.0) {
        tracing::error!(error = ?error, "could not keep the teammate install");
        shared.report(
            &stored.install,
            TeammateRunState::Failed {
                reason: TeammateRunFailure::EngineRefused,
            },
        );
        return;
    }

    end_supervisor(supervisors, &id).await;
    let handle = spawn_supervisor(shared, stored, false);
    supervisors.insert(id, handle);
}

/// Stop the container (the agent gets [`STOP_GRACE`] for its last sync),
/// then delete it, its network, both volumes and the kept install, and
/// report `stopped`. The install stays kept, and listed in reports, until
/// every deletion succeeded, so the service's next stop retries what failed.
async fn stop<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
    install: TeammateInstall,
) {
    let id = &install.install_id;
    if let Ok(Some(kept)) = shared.store.read(id)
        && kept.install.generation > install.generation
    {
        tracing::info!(
            kept_generation = kept.install.generation,
            "ignoring a stop for an older teammate generation"
        );
        return;
    }
    end_supervisor(supervisors, id).await;
    // Kept as asked to stop before anything can fail, so a restarted macrod
    // never starts it again while the deletions wait for the next stop.
    if let Ok(Some(mut kept)) = shared.store.read(id) {
        let stop = ExitEvent {
            code: None,
            requested: true,
        };
        kept.lifecycle.policy.exited(stop, chrono::Utc::now());
        kept.lifecycle.stopped_for = None;
        if let Err(error) = shared.store.save_lifecycle(&kept.install, &kept.lifecycle) {
            tracing::warn!(error = ?error, "could not keep the teammate's stop");
        }
    }

    let engine = &shared.engine;
    let name = container_name(id);
    let stopped = match engine.container(&name).await {
        Ok(Some(state)) if state.running => engine.stop(&name, STOP_GRACE).await,
        Ok(_) => Ok(()),
        Err(error) => Err(error),
    };
    if let Err(error) = stopped {
        tracing::warn!(error = %error, "could not stop the teammate container");
        return;
    }
    let deleted = async {
        engine.remove_container(&name).await?;
        engine.remove_container(&engine::holder_name(id)).await?;
        engine.remove_network(&network_name(id)).await?;
        engine.remove_volume(&volume_name(id)).await?;
        engine.remove_volume(&provider_volume_name(id)).await
    }
    .await;
    match deleted {
        Ok(()) => {
            if let Err(error) = shared.store.delete(id) {
                tracing::warn!(error = ?error, "could not forget the teammate install");
            }
        }
        Err(error) => {
            tracing::warn!(error = %error, "could not delete the teammate's container, network or volumes");
        }
    }
    // Reported once the deletions were tried, so the service's move goes on
    // with this machine done.
    shared.report(&install, TeammateRunState::Stopped);
    if shared.store.read(id).ok().flatten().is_none() {
        lock(&shared.latest).remove(id);
    }
}

/// Stop every kept install's agent and holder, keeping its volumes and the
/// install itself (a later stop deletes them), and report `stopped`. Kept
/// as asked to stop, so a restarted macrod doesn't start them again.
async fn stop_all<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
) {
    for mut kept in shared.store.installs() {
        let id = kept.install.install_id.clone();
        if !supervisors.contains_key(&id) && matches!(kept.lifecycle.policy.phase(), Phase::Stopped)
        {
            continue;
        }
        end_supervisor(supervisors, &id).await;
        let stop = ExitEvent {
            code: None,
            requested: true,
        };
        kept.lifecycle.policy.exited(stop, chrono::Utc::now());
        kept.lifecycle.stopped_for = Some(StopCause::CredentialsRefused);
        if let Err(error) = shared.store.save_lifecycle(&kept.install, &kept.lifecycle) {
            tracing::warn!(error = ?error, "could not keep the teammate's stop");
        }
        for name in [container_name(&id), engine::holder_name(&id)] {
            let running =
                matches!(shared.engine.container(&name).await, Ok(Some(state)) if state.running);
            if running
                && let Err(error) = shared.engine.stop(&name, CREDENTIALS_REFUSED_GRACE).await
            {
                tracing::warn!(install_id = id.as_str(), error = %error, "could not stop a teammate container");
            }
        }
        shared.report(&kept.install, TeammateRunState::Stopped);
    }
}

/// Run again each kept install macrod stopped because its credentials
/// were refused, as its delivery came (the service stops any it no longer
/// wants here).
fn start_refused<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
) {
    if !shared.usable_host() {
        return;
    }
    for mut stored in shared.store.installs() {
        let id = stored.install.install_id.clone();
        if supervisors.contains_key(&id)
            || stored.lifecycle.stopped_for != Some(StopCause::CredentialsRefused)
        {
            continue;
        }
        stored.lifecycle.stopped_for = None;
        if let Err(error) = shared
            .store
            .save_lifecycle(&stored.install, &stored.lifecycle)
        {
            tracing::warn!(error = ?error, "could not keep the teammate's lifecycle");
            continue;
        }
        tracing::info!(
            install_id = id.as_str(),
            "running a teammate stopped for refused credentials again"
        );
        let handle = spawn_supervisor(shared, stored, false);
        supervisors.insert(id, handle);
    }
}

async fn end_supervisor(
    supervisors: &mut HashMap<TeammateInstallId, AbortOnDropHandle<()>>,
    id: &TeammateInstallId,
) {
    if let Some(handle) = supervisors.remove(id) {
        handle.abort();
        // Waited for, so the old supervisor reports nothing after this.
        let _ = handle.await;
    }
}

/// The service endpoints a kept agent environment names.
fn local_services(credentials_file: &std::path::Path) -> Vec<(String, u16)> {
    match std::fs::read_to_string(credentials_file) {
        Ok(agent_env) => netfacts::service_endpoints(&agent_env),
        Err(error) => {
            tracing::warn!(error = %error, "could not read the agent environment for its services");
            Vec::new()
        }
    }
}

/// Supervise a kept install. A request's trace (the current span) is handed
/// on so the first fetch and start join it. The lifecycle is kept after
/// each step, so a restarted macrod goes on from it.
fn spawn_supervisor<EngineImpl: Engine>(
    shared: &Arc<Shared<EngineImpl>>,
    stored: StoredInstall,
    resume: bool,
) -> AbortOnDropHandle<()> {
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;

    let shared = Arc::clone(shared);
    let current = tracing::Span::current();
    let supervision = Supervision {
        credentials_file: shared.store.credentials_file(&stored.install.install_id),
        seccomp_profile: shared.seccomp_profile.clone(),
        network: shared.egress.network.clone(),
        allow: shared.egress.allow.clone(),
        // A local stack: its services the agent was given, one by one.
        services: if shared.egress.network.is_some() {
            local_services(&shared.store.credentials_file(&stored.install.install_id))
        } else {
            Vec::new()
        },
        install: stored.install,
        image: stored.image,
        resume,
        lifecycle: stored.lifecycle,
        trace: (!current.is_none()).then(|| current.context()),
    };
    AbortOnDropHandle::new(tokio::spawn(async move {
        let install = supervision.install.clone();
        let keep = |lifecycle: &Lifecycle| {
            if let Err(error) = shared.store.save_lifecycle(&install, lifecycle) {
                tracing::warn!(error = ?error, "could not keep the teammate's lifecycle");
            }
        };
        supervise(&shared.engine, supervision, keep, |state| {
            shared.report(&install, state);
        })
        .await;
    }))
}
