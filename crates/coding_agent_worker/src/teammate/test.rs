use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::PermissionsExt as _;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{
    AgentEnvironment, ContainerEngineKind, HostArch, HostOs, HostResource, TeammateHostProblem,
    TeammateImage, TeammateInstall, TeammateInstallId, TeammateRunFailure, TeammateRunState,
};
use tokio::sync::{broadcast, mpsc};

use super::cli::{parse_df_available_kib, version_at_least};
use super::command::{Observed, list_row};
use super::engine::{
    ContainerState, Delivery, Engine, EngineError, EngineInfo, EngineUnavailable, RunSpec,
    TeammateNetwork, run_arguments,
};
use super::host::{Platform, can_host, host_report};
use super::store::{Lifecycle, Store, StoredInstall};
use super::{Egress, Link, Status, TeammateRequest, Teammates};
use crate::harness::{CredentialPath, TeammateEvent};
use teammate_lifecycle::exit::PreviousExit;

const SECCOMP: &str = "/home/ada/.macrod/teammates/teammate-seccomp.json";

const IMAGE_ID: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_IMAGE_ID: &str =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REPOSITORY: &str = "ghcr.io/macro-inc/teammate-runtime";
const OTHER_TAGGED: &str = "ghcr.io/macro-inc/teammate-runtime:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const THIRD_IMAGE_ID: &str =
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const THIRD_TAGGED: &str = "ghcr.io/macro-inc/teammate-runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const TAGGED: &str = "ghcr.io/macro-inc/teammate-runtime:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const LINUX: Platform = Platform {
    os: HostOs::Linux,
    arch: HostArch::Amd64,
};

fn docker_info() -> EngineInfo {
    EngineInfo {
        kind: ContainerEngineKind::Docker,
        version: "29.5.1".to_owned(),
        supported_version: true,
        rootless: false,
        cpus: 8,
        memory_mib: 16 * 1024,
        disk_free_mib: Some(100 * 1024),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    Pull(String),
    CreateNetwork(String),
    RemoveNetwork(String),
    CreateVolume(String),
    RemoveVolume(String),
    Run(RunSpec),
    RunHolder(super::engine::HolderSpec),
    Guard { holder_id: String, loaded: bool },
    Stop(String, Duration),
    RemoveContainer(String),
}

struct FakeState {
    info: Result<EngineInfo, EngineUnavailable>,
    /// Local images: reference → id.
    images: BTreeMap<String, String>,
    /// What a pull of a reference brings: reference → id.
    registry: BTreeMap<String, String>,
    containers: BTreeMap<String, ContainerState>,
    networks: BTreeSet<String>,
    volumes: BTreeSet<String>,
    calls: Vec<Call>,
    /// Runs to refuse before accepting, as an engine that is restarting.
    refuse_runs: u32,
    /// Whether removing a volume fails.
    volume_removal_fails: bool,
    /// Holders started so far (for their ids).
    holders: u32,
    /// What the guard does: load and read back as rendered, refuse, or
    /// print this table.
    guard: FakeGuard,
    /// Whether the host has a default route.
    to_the_internet: bool,
    /// A Podman installed beside Docker, and its guard.
    podman_guard: Option<FakeGuard>,
    /// The engine `select` made current.
    selected: ContainerEngineKind,
    /// The ruleset the guard last loaded.
    last_ruleset: Option<String>,
}

#[derive(Clone)]
enum FakeGuard {
    Loads,
    Refuses,
    RefusesOnce,
    ReadsBack(String),
    /// Never answers, as an engine under heavy load.
    Hangs,
}

/// The facts the fake engine's namespaces have.
fn fake_facts() -> super::egress::NetworkFacts {
    super::egress::NetworkFacts {
        resolvers: vec!["8.8.8.8".parse().unwrap()],
        host_prefixes: vec!["192.168.1.0/24".parse().unwrap()],
        gateways: vec!["172.20.0.1".parse().unwrap()],
        network_prefixes: vec!["172.20.0.0/16".parse().unwrap()],
    }
}

/// An engine in memory. Containers exit with the codes the test sends.
#[derive(Clone)]
pub(crate) struct FakeEngine {
    state: Arc<Mutex<FakeState>>,
    /// Ends the running holders' waits (the test kills them).
    holder_exits: Arc<tokio::sync::Notify>,
    exits: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<i64>>>,
}

impl FakeEngine {
    fn new(info: Result<EngineInfo, EngineUnavailable>) -> (Self, mpsc::UnboundedSender<i64>) {
        let (exit, exits) = mpsc::unbounded_channel();
        let engine = Self {
            state: Arc::new(Mutex::new(FakeState {
                info,
                images: BTreeMap::new(),
                registry: BTreeMap::new(),
                containers: BTreeMap::new(),
                networks: BTreeSet::new(),
                volumes: BTreeSet::new(),
                calls: Vec::new(),
                refuse_runs: 0,
                volume_removal_fails: false,
                holders: 0,
                guard: FakeGuard::Loads,
                to_the_internet: true,
                podman_guard: None,
                selected: ContainerEngineKind::Docker,
                last_ruleset: None,
            })),
            holder_exits: Arc::new(tokio::sync::Notify::new()),
            exits: Arc::new(tokio::sync::Mutex::new(exits)),
        };
        (engine, exit)
    }

    fn state(&self) -> std::sync::MutexGuard<'_, FakeState> {
        self.state.lock().unwrap()
    }

    fn calls(&self) -> Vec<Call> {
        self.state().calls.clone()
    }

    pub(crate) fn runs(&self) -> usize {
        self.calls()
            .iter()
            .filter(|call| matches!(call, Call::Run(_)))
            .count()
    }
}

impl Engine for FakeEngine {
    async fn info(&self) -> Result<EngineInfo, EngineUnavailable> {
        self.state().info.clone()
    }

    async fn user_namespaces(
        &self,
        _image: &str,
        _seccomp_profile: &std::path::Path,
    ) -> Result<bool, EngineError> {
        Ok(true)
    }

    async fn image_id(&self, reference: &str) -> Result<Option<String>, EngineError> {
        let state = self.state();
        let by_id = state
            .images
            .values()
            .find(|id| id.as_str() == reference)
            .cloned();
        Ok(state.images.get(reference).cloned().or(by_id))
    }

    async fn pull(&self, reference: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::Pull(reference.to_owned()));
        let id = state
            .registry
            .get(reference)
            .cloned()
            .ok_or_else(|| EngineError("manifest unknown".to_owned()))?;
        state.images.insert(reference.to_owned(), id);
        Ok(())
    }

    async fn create_network(&self, name: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::CreateNetwork(name.to_owned()));
        state.networks.insert(name.to_owned());
        Ok(())
    }

    async fn remove_network(&self, name: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::RemoveNetwork(name.to_owned()));
        state.networks.remove(name);
        Ok(())
    }

    async fn create_volume(&self, name: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::CreateVolume(name.to_owned()));
        state.volumes.insert(name.to_owned());
        Ok(())
    }

    async fn remove_volume(&self, name: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::RemoveVolume(name.to_owned()));
        if state.volume_removal_fails {
            return Err(EngineError("volume is in use".to_owned()));
        }
        state.volumes.remove(name);
        Ok(())
    }

    async fn container(&self, name: &str) -> Result<Option<ContainerState>, EngineError> {
        Ok(self.state().containers.get(name).cloned())
    }

    async fn run(&self, spec: &RunSpec) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::Run(spec.clone()));
        if state.refuse_runs > 0 {
            state.refuse_runs -= 1;
            return Err(EngineError(
                "Cannot connect to the Docker daemon".to_owned(),
            ));
        }
        state.containers.insert(
            spec.container(),
            ContainerState {
                id: Some(format!("teammate-{}", spec.delivery.generation)),
                running: true,
                delivery: Some(spec.delivery),
                image_id: Some(spec.image_id.clone()),
            },
        );
        Ok(())
    }

    async fn stop(&self, name: &str, grace: Duration) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::Stop(name.to_owned(), grace));
        if let Some(container) = state.containers.get_mut(name) {
            container.running = false;
        }
        Ok(())
    }

    async fn remove_container(&self, name: &str) -> Result<(), EngineError> {
        let mut state = self.state();
        state.calls.push(Call::RemoveContainer(name.to_owned()));
        state.containers.remove(name);
        Ok(())
    }

    async fn wait(&self, name: &str) -> Result<i64, EngineError> {
        if name.starts_with("holder-") {
            self.holder_exits.notified().await;
            for container in self.state().containers.values_mut() {
                if container.id.as_deref() == Some(name) {
                    container.running = false;
                }
            }
            return Ok(137);
        }
        let code = self
            .exits
            .lock()
            .await
            .recv()
            .await
            .ok_or_else(|| EngineError("the test ended".to_owned()))?;
        if let Some(container) = self.state().containers.get_mut(name) {
            container.running = false;
        }
        Ok(code)
    }

    fn installed(&self) -> Vec<ContainerEngineKind> {
        let state = self.state();
        if state.info == Err(EngineUnavailable::NotInstalled) {
            return Vec::new();
        }
        match state.podman_guard {
            Some(_) => vec![ContainerEngineKind::Docker, ContainerEngineKind::Podman],
            None => vec![ContainerEngineKind::Docker],
        }
    }

    async fn select(&self, kind: ContainerEngineKind) -> Result<EngineInfo, EngineUnavailable> {
        let mut state = self.state();
        state.selected = kind;
        let info = state.info.clone()?;
        Ok(EngineInfo { kind, ..info })
    }

    async fn run_holder(&self, spec: &super::engine::HolderSpec) -> Result<String, EngineError> {
        let mut state = self.state();
        state.calls.push(Call::RunHolder(spec.clone()));
        state.holders += 1;
        let id = format!("holder-{}", state.holders);
        state.containers.insert(
            super::engine::holder_name(&spec.install_id),
            ContainerState {
                id: Some(id.clone()),
                running: true,
                delivery: None,
                image_id: Some(spec.image_id.clone()),
            },
        );
        Ok(id)
    }

    async fn network_facts(
        &self,
        _holder_id: &str,
        _networks: &[String],
    ) -> Result<super::egress::NetworkFacts, EngineError> {
        Ok(super::egress::NetworkFacts {
            host_prefixes: Vec::new(),
            ..fake_facts()
        })
    }

    async fn host_network(&self) -> Result<super::engine::HostNetwork, EngineError> {
        Ok(super::engine::HostNetwork {
            prefixes: fake_facts().host_prefixes,
            to_the_internet: self.state().to_the_internet,
        })
    }

    async fn resolve(
        &self,
        _holder_id: &str,
        name: &str,
    ) -> Result<Vec<std::net::IpAddr>, EngineError> {
        match name {
            "agent-harness-service" => Ok(vec!["172.30.0.8".parse().unwrap()]),
            _ => Err(EngineError(format!("{name}: no such host"))),
        }
    }

    async fn guard(
        &self,
        holder_id: &str,
        _image_id: &str,
        ruleset: Option<&str>,
    ) -> Result<String, super::engine::GuardError> {
        if matches!(self.state().guard, FakeGuard::Hangs) {
            return std::future::pending().await;
        }
        let mut state = self.state();
        state.calls.push(Call::Guard {
            holder_id: holder_id.to_owned(),
            loaded: ruleset.is_some(),
        });
        if let Some(ruleset) = ruleset {
            state.last_ruleset = Some(ruleset.to_owned());
        }
        let guard = match (state.selected, &state.podman_guard) {
            (ContainerEngineKind::Podman, Some(podman)) => podman.clone(),
            _ => state.guard.clone(),
        };
        match &guard {
            FakeGuard::Hangs => unreachable!("answered above"),
            FakeGuard::Loads => Ok(super::egress::simulated_readback(&[], &fake_facts())),
            FakeGuard::Refuses => Err(super::engine::GuardError::Refused(
                "nft: Operation not permitted".to_owned(),
            )),
            FakeGuard::ReadsBack(table) => Ok(table.clone()),
            FakeGuard::RefusesOnce => {
                state.guard = FakeGuard::Loads;
                Err(super::engine::GuardError::Refused(
                    "nft: Operation not permitted".to_owned(),
                ))
            }
        }
    }
}

fn install(generation: u64) -> TeammateInstall {
    delivered(generation, 1)
}

fn delivered(generation: u64, delivery: u64) -> TeammateInstall {
    TeammateInstall {
        install_id: TeammateInstallId::new("install-1").unwrap(),
        generation,
        delivery,
    }
}

fn image(image_id: &str) -> TeammateImage {
    TeammateImage {
        repository: REPOSITORY.to_owned(),
        image_id: image_id.to_owned(),
    }
}

fn environment() -> AgentEnvironment {
    AgentEnvironment(
        [
            ("MACRO_API_KEY".to_owned(), "mak_secret".to_owned()),
            ("MACRO_AGENT_NAME".to_owned(), "Ada".to_owned()),
        ]
        .into_iter()
        .collect(),
    )
}

fn run_request(generation: u64) -> TeammateRequest {
    delivery_request(generation, 1)
}

fn delivery_request(generation: u64, delivery: u64) -> TeammateRequest {
    TeammateRequest::Run {
        install: delivered(generation, delivery),
        image: image(IMAGE_ID),
        environment: environment(),
        traceparent: None,
    }
}

fn stop_request(generation: u64) -> TeammateRequest {
    TeammateRequest::Stop {
        install: install(generation),
        traceparent: None,
    }
}

fn stored(install: TeammateInstall) -> StoredInstall {
    StoredInstall {
        install,
        image: image(IMAGE_ID),
        lifecycle: Lifecycle::default(),
    }
}

/// Each run's image and `TEAMMATE_PREVIOUS_EXIT`, in order.
fn run_images_and_exits(engine: &FakeEngine) -> Vec<(String, PreviousExit)> {
    engine
        .calls()
        .iter()
        .filter_map(|call| match call {
            Call::Run(spec) => Some((spec.image_id.clone(), spec.previous_exit)),
            _ => None,
        })
        .collect()
}

fn image_request(generation: u64, image_id: &str) -> TeammateRequest {
    TeammateRequest::Run {
        install: delivered(generation, 1),
        image: image(image_id),
        environment: environment(),
        traceparent: None,
    }
}

fn run_deliveries(engine: &FakeEngine) -> Vec<(u64, u64)> {
    engine
        .calls()
        .iter()
        .filter_map(|call| match call {
            Call::Run(spec) => Some((spec.delivery.generation, spec.delivery.delivery)),
            _ => None,
        })
        .collect()
}

struct Fixture {
    engine: FakeEngine,
    exit: mpsc::UnboundedSender<i64>,
    teammates: Teammates<FakeEngine>,
    statuses: broadcast::Receiver<Status>,
    store: Store,
    _directory: tempfile::TempDir,
}

/// Teammates on a fake Docker whose registry has the image, after the
/// engine check.
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    fixture_with(directory, store).await
}

async fn fixture_with(directory: tempfile::TempDir, store: Store) -> Fixture {
    let (engine, exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    let teammates = Teammates::new(
        engine.clone(),
        store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let statuses = teammates.subscribe();
    teammates.detect().await;
    Fixture {
        engine,
        exit,
        teammates,
        statuses,
        store,
        _directory: directory,
    }
}

async fn next_states(
    statuses: &mut broadcast::Receiver<Status>,
    count: usize,
) -> Vec<TeammateRunState> {
    let mut states = Vec::new();
    for _ in 0..count {
        states.push(statuses.recv().await.unwrap().state);
    }
    states
}

#[test]
fn the_host_report_names_each_problem_in_the_order_to_fix_it() {
    let problem = |platform, engine, user_namespaces| {
        host_report(platform, engine, user_namespaces, Vec::new(), Vec::new()).problem
    };
    let with = |change: fn(&mut EngineInfo)| {
        let mut info = docker_info();
        change(&mut info);
        Ok(info)
    };

    assert_eq!(problem(LINUX, Ok(docker_info()), Some(true)), None);
    assert_eq!(problem(LINUX, Ok(docker_info()), None), None);
    assert_eq!(
        problem(LINUX, Err(EngineUnavailable::NotInstalled), None),
        Some(TeammateHostProblem::NoEngine)
    );
    assert_eq!(
        problem(LINUX, Err(EngineUnavailable::Unreachable), None),
        Some(TeammateHostProblem::EngineUnreachable)
    );
    assert_eq!(
        problem(LINUX, with(|info| info.supported_version = false), None),
        Some(TeammateHostProblem::NoEngine)
    );
    assert_eq!(
        problem(LINUX, with(|info| info.cpus = 1), None),
        Some(TeammateHostProblem::BelowFloor {
            resource: HostResource::Cpus
        })
    );
    assert_eq!(
        problem(LINUX, with(|info| info.memory_mib = 8 * 1024 - 1), None),
        Some(TeammateHostProblem::BelowFloor {
            resource: HostResource::Memory
        })
    );
    assert_eq!(
        problem(
            LINUX,
            with(|info| info.disk_free_mib = Some(20 * 1024 - 1)),
            None
        ),
        Some(TeammateHostProblem::BelowFloor {
            resource: HostResource::Disk
        })
    );
    // A Docker Desktop root the host can't see doesn't count against it.
    assert_eq!(
        problem(LINUX, with(|info| info.disk_free_mib = None), None),
        None
    );
    assert_eq!(
        problem(LINUX, Ok(docker_info()), Some(false)),
        Some(TeammateHostProblem::InnerSandboxUnavailable)
    );
    let riscv = Platform {
        os: HostOs::Linux,
        arch: HostArch::Other,
    };
    assert_eq!(
        problem(riscv, Ok(docker_info()), None),
        Some(TeammateHostProblem::UnsupportedPlatform)
    );
    assert_eq!(
        problem(riscv, Err(EngineUnavailable::NotInstalled), None),
        Some(TeammateHostProblem::UnsupportedPlatform)
    );
    let macos = Platform {
        os: HostOs::Macos,
        arch: HostArch::Arm64,
    };
    // The policy can't be rendered off Linux yet.
    assert_eq!(
        problem(macos, Ok(docker_info()), None),
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    );
}

#[tokio::test]
async fn the_capability_is_declared_only_when_an_engine_answers_and_nothing_is_wrong() {
    for (info, expected) in [
        (Ok(docker_info()), true),
        (Err(EngineUnavailable::NotInstalled), false),
        (Err(EngineUnavailable::Unreachable), false),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let (engine, _exit) = FakeEngine::new(info);
        let teammates = Teammates::new(
            engine,
            Store::new(directory.path().to_owned()),
            LINUX,
            SECCOMP.into(),
            Egress::default(),
        );

        let report = teammates.detect().await;

        assert_eq!(can_host(&report), expected, "{report:?}");
        assert_eq!(
            crate::outbound::link::accepts(can_host(&report)).contains("teammate-container"),
            expected
        );
    }
}

#[test]
fn the_container_runs_with_exactly_the_specified_flags() {
    let spec = RunSpec {
        install_id: TeammateInstallId::new("install-1").unwrap(),
        delivery: Delivery {
            generation: 3,
            delivery: 2,
        },
        image_id: IMAGE_ID.to_owned(),
        credentials_file: "/home/ada/.macrod/teammates/h/install-1/agent.env".into(),
        seccomp_profile: SECCOMP.into(),
        previous_exit: PreviousExit::Exited { code: 78 },
        holder_id: "holder-1".to_owned(),
    };

    let arguments: Vec<String> = run_arguments(&spec)
        .unwrap()
        .into_iter()
        .map(|argument| argument.into_string().unwrap())
        .collect();

    assert_eq!(
        arguments,
        [
            "run",
            "--detach",
            "--name",
            "macro-teammate-install-1",
            "--user",
            "1000:1000",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--security-opt",
            "seccomp=/home/ada/.macrod/teammates/teammate-seccomp.json",
            "--pids-limit",
            "512",
            "--memory",
            "4g",
            "--cpus",
            "2",
            "--shm-size",
            "1g",
            "--tmpfs",
            "/tmp",
            "--tmpfs",
            "/run/teammate-runtime",
            "--network",
            "container:holder-1",
            "--mount",
            "type=volume,src=macro-teammate-install-1,dst=/teammate",
            "--mount",
            "type=volume,src=macro-teammate-install-1-provider,dst=/teammate-provider,readonly",
            "--mount",
            "type=bind,src=/home/ada/.macrod/teammates/h/install-1/agent.env,dst=/run/teammate/agent.env,readonly",
            "--label",
            "macro.teammate.install=install-1",
            "--label",
            "macro.teammate.generation=3",
            "--label",
            "macro.teammate.delivery=2",
            "--env",
            "TEAMMATE_PREVIOUS_EXIT=78",
            "--restart",
            "no",
            IMAGE_ID,
        ]
    );
}

#[tokio::test]
async fn a_run_fetches_the_image_by_its_id_tag_and_starts_the_container() {
    let mut fixture = fixture().await;

    fixture.teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    let calls = fixture.engine.calls();
    assert_eq!(calls[0], Call::Pull(TAGGED.to_owned()));
    assert!(calls.contains(&Call::CreateNetwork("macro-teammate-install-1".to_owned())));
    assert!(calls.contains(&Call::CreateVolume("macro-teammate-install-1".to_owned())));
    assert!(calls.contains(&Call::CreateVolume(
        "macro-teammate-install-1-provider".to_owned()
    )));
    let Some(Call::Run(spec)) = calls.last() else {
        panic!("the container was not run: {calls:?}");
    };
    assert_eq!(spec.image_id, IMAGE_ID);
    assert_eq!(
        spec.delivery,
        Delivery {
            generation: 1,
            delivery: 1
        }
    );
    assert_eq!(
        spec.credentials_file,
        fixture
            .store
            .directory(&install(1).install_id)
            .join("agent.env")
    );
}

#[tokio::test]
async fn a_local_image_with_the_id_is_not_fetched_again() {
    let mut fixture = fixture().await;
    fixture
        .engine
        .state()
        .images
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());

    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Pull(_)))
    );
}

#[tokio::test]
async fn an_image_whose_id_differs_is_refused() {
    let mut fixture = fixture().await;
    fixture
        .engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());

    fixture.teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 2).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Failed {
                reason: TeammateRunFailure::ImageMismatch
            }
        ]
    );
    assert_eq!(fixture.engine.runs(), 0);
}

#[tokio::test]
async fn an_image_that_cant_be_fetched_is_unavailable() {
    let mut fixture = fixture().await;
    fixture.engine.state().registry.clear();

    fixture.teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 2).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Failed {
                reason: TeammateRunFailure::ImageUnavailable
            }
        ]
    );
}

#[tokio::test]
async fn an_older_generation_is_ignored() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(2));
    next_states(&mut fixture.statuses, 3).await;

    fixture.teammates.handle(run_request(1));
    fixture.teammates.handle(stop_request(1));
    // A marker after both: requests are handled in order.
    fixture.teammates.handle(run_request(3));

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(run_deliveries(&fixture.engine), [(2, 1), (3, 1)]);
    // The older stop deleted nothing (generation 3 replaced 2 with a stop
    // of its own, and kept the volumes).
    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::RemoveVolume(..)))
    );
    assert_eq!(
        fixture
            .store
            .read(&install(3).install_id)
            .unwrap()
            .unwrap()
            .install
            .generation,
        3
    );
}

#[tokio::test]
async fn the_same_generation_again_leaves_the_running_container_alone() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture.teammates.handle(run_request(1));
    fixture.teammates.handle(stop_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test]
async fn the_highest_generation_and_delivery_wins_and_lower_pairs_are_ignored() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(delivery_request(2, 3));
    next_states(&mut fixture.statuses, 3).await;

    // Lower or equal pairs: an older generation with a higher delivery, the
    // same generation with an older delivery, and the same pair again.
    fixture.teammates.handle(delivery_request(1, 9));
    fixture.teammates.handle(delivery_request(2, 2));
    fixture.teammates.handle(delivery_request(2, 3));
    // A resend of the same generation, one delivery later, replaces it.
    fixture.teammates.handle(delivery_request(2, 4));

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(run_deliveries(&fixture.engine), [(2, 3), (2, 4)]);
    assert_eq!(
        fixture
            .store
            .read(&install(2).install_id)
            .unwrap()
            .unwrap()
            .install,
        delivered(2, 4)
    );
}

#[tokio::test]
async fn a_new_delivery_stops_the_running_container_with_its_grace_before_replacing_it() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(delivery_request(1, 1));
    next_states(&mut fixture.statuses, 3).await;

    fixture.teammates.handle(delivery_request(2, 1));
    next_states(&mut fixture.statuses, 3).await;

    let calls = fixture.engine.calls();
    let stop = calls
        .iter()
        .position(|call| {
            *call
                == Call::Stop(
                    "macro-teammate-install-1".to_owned(),
                    Duration::from_secs(90),
                )
        })
        .expect("the old container got its last sync");
    let second_run = calls
        .iter()
        .rposition(|call| matches!(call, Call::Run(_)))
        .unwrap();
    assert!(stop < second_run, "{calls:?}");
    assert_eq!(
        calls[stop + 1],
        Call::RemoveContainer("macro-teammate-install-1".to_owned())
    );
}

#[tokio::test]
async fn an_exit_of_a_container_with_another_deliverys_label_is_not_counted() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(delivery_request(1, 1));
    next_states(&mut fixture.statuses, 3).await;
    // Something else put another delivery's container under the name.
    fixture.engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery {
                generation: 1,
                delivery: 2,
            }),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );

    fixture.exit.send(1).unwrap();
    // A marker: the next request's states come next, nothing in between.
    fixture.teammates.handle(stop_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test]
async fn the_credentials_file_is_written_whole_readable_by_the_container_in_a_private_directory() {
    let fixture = fixture().await;
    let stored = stored(install(1));

    fixture.store.save(&stored, &environment().0).unwrap();

    let directory = fixture.store.directory(&stored.install.install_id);
    let credentials = directory.join("agent.env");
    assert_eq!(
        std::fs::read_to_string(&credentials).unwrap(),
        "MACRO_AGENT_NAME=\"Ada\"\nMACRO_API_KEY=\"mak_secret\"\n"
    );
    let mode =
        |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&credentials), 0o644);
    assert_eq!(mode(&directory), 0o700);
    assert_eq!(mode(&directory.join("install.json")), 0o600);
    assert!(
        !std::fs::read_to_string(directory.join("install.json"))
            .unwrap()
            .contains("mak_secret")
    );
    assert_eq!(
        fixture.store.read(&stored.install.install_id).unwrap(),
        Some(stored)
    );
}

#[tokio::test]
async fn exit_75_starts_the_container_again() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture.exit.send(75).unwrap();

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test]
async fn a_restarted_macrod_adopts_the_running_container() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    store.save(&stored(install(4)), &environment().0).unwrap();
    let (engine, exit) = FakeEngine::new(Ok(docker_info()));
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    // Its holder, with the policy in place (the fake guard reads it back).
    engine.state().containers.insert(
        "macro-teammate-install-1-net".to_owned(),
        ContainerState {
            id: Some("holder-0".to_owned()),
            running: true,
            delivery: None,
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    let report = teammates.detect().await;

    assert_eq!(report.installs, [install(4)]);
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Running]
    );
    // Adopted with its policy only read back: nothing started or loaded.
    assert_eq!(
        engine.calls(),
        [Call::Guard {
            holder_id: "holder-0".to_owned(),
            loaded: false
        }]
    );

    // Still supervised: a restart request is honoured.
    engine
        .state()
        .images
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    exit.send(75).unwrap();
    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
}

#[tokio::test]
async fn a_restarted_macrod_starts_an_exited_container_again() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    store.save(&stored(install(4)), &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: false,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    teammates.detect().await;

    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(engine.runs(), 1);
}

#[tokio::test]
async fn a_stop_deletes_the_container_its_network_both_volumes_and_the_install() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(2));
    next_states(&mut fixture.statuses, 3).await;

    fixture.teammates.handle(stop_request(2));

    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    let calls = fixture.engine.calls();
    let stop = calls
        .iter()
        .position(|call| {
            *call
                == Call::Stop(
                    "macro-teammate-install-1".to_owned(),
                    Duration::from_secs(90),
                )
        })
        .expect("stopped with a 90 s grace");
    assert_eq!(
        calls[stop + 1..stop + 6],
        [
            Call::RemoveContainer("macro-teammate-install-1".to_owned()),
            Call::RemoveContainer("macro-teammate-install-1-net".to_owned()),
            Call::RemoveNetwork("macro-teammate-install-1".to_owned()),
            Call::RemoveVolume("macro-teammate-install-1".to_owned()),
            Call::RemoveVolume("macro-teammate-install-1-provider".to_owned()),
        ]
    );
    assert!(fixture.engine.state().volumes.is_empty());
    assert!(fixture.engine.state().networks.is_empty());
    assert_eq!(fixture.store.read(&install(1).install_id).unwrap(), None);
    assert!(!fixture.store.directory(&install(1).install_id).exists());
    assert!(fixture.teammates.latest().is_empty());
}

#[tokio::test]
async fn a_run_on_a_machine_that_cant_host_fails_without_keeping_anything() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().to_owned());
    let (engine, _exit) = FakeEngine::new(Err(EngineUnavailable::Unreachable));
    let teammates = Teammates::new(
        engine.clone(),
        store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;

    teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Failed {
            reason: TeammateRunFailure::HostUnsupported
        }]
    );
    assert_eq!(store.read(&install(1).install_id).unwrap(), None);
    assert!(engine.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_engine_is_checked_again_every_thirty_seconds() {
    // Docker isn't up when the runtime dials: the web shows it can't reach
    // Docker and polls. Each check's result is reported on the live
    // connection, and once the engine answers the runtime redials, so the
    // dial lists the teammate capability.
    let directory = tempfile::tempdir().unwrap();
    let (engine, _exit) = FakeEngine::new(Err(EngineUnavailable::Unreachable));
    let teammates = Arc::new(Teammates::new(
        engine.clone(),
        Store::new(directory.path().to_owned()),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    ));
    let report = teammates.detect().await;
    assert_eq!(report.problem, Some(TeammateHostProblem::EngineUnreachable));
    let (to_service, mut sent) = mpsc::unbounded_channel();
    let mut link = Link::open(Arc::clone(&teammates), report, &to_service);
    assert!(matches!(
        sent.try_recv(),
        Ok(agent_runtime_protocol::domain::schema::v0::ToServerMessage::TeammateHost { .. })
    ));

    assert!(
        tokio::time::timeout(Duration::from_secs(29), link.next())
            .await
            .is_err()
    );
    let checked = tokio::time::timeout(Duration::from_secs(2), link.next())
        .await
        .expect("the engine is checked again at 30 s");
    let TeammateEvent::Send(
        agent_runtime_protocol::domain::schema::v0::ToServerMessage::TeammateHost { report },
    ) = checked
    else {
        panic!("expected a host report, got {checked:?}");
    };
    assert_eq!(report.problem, Some(TeammateHostProblem::EngineUnreachable));

    engine.state().info = Ok(docker_info());
    let checked = tokio::time::timeout(Duration::from_secs(31), link.next())
        .await
        .expect("checked again 30 s later");
    assert!(matches!(checked, TeammateEvent::Redial), "{checked:?}");
}

#[test]
fn macrods_starting_together_all_write_the_seccomp_profile() {
    // Several macrods share `~/.macrod` and start at once: each writes the
    // profile, every write succeeds, and the file is always whole.
    let directory = tempfile::tempdir().unwrap();
    let teammates = directory.path().join("teammates");
    let contents = super::SECCOMP_PROFILE.as_bytes();
    let writers = 8;
    let start = std::sync::Barrier::new(writers);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..writers)
            .map(|_| {
                scope.spawn(|| {
                    start.wait();
                    for _ in 0..50 {
                        super::store::write_file(&teammates, "teammate-seccomp.json", contents)?;
                    }
                    Ok::<_, rootcause::Report>(())
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
    });
    assert_eq!(
        std::fs::read(teammates.join("teammate-seccomp.json")).unwrap(),
        contents
    );
    // Nothing left beside it.
    assert_eq!(std::fs::read_dir(&teammates).unwrap().count(), 1);
}

#[test]
fn writers_racing_with_different_contents_leave_one_whole_file() {
    let directory = tempfile::tempdir().unwrap();
    let contents: Vec<Vec<u8>> = (0..8u8).map(|writer| vec![writer; 64 * 1024]).collect();
    let start = std::sync::Barrier::new(contents.len());
    std::thread::scope(|scope| {
        let handles: Vec<_> = contents
            .iter()
            .map(|mine| {
                let start = &start;
                let directory = directory.path();
                scope.spawn(move || {
                    start.wait();
                    for _ in 0..20 {
                        super::store::write_file(directory, "profile.json", mine)?;
                    }
                    Ok::<_, rootcause::Report>(())
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
    });
    let written = std::fs::read(directory.path().join("profile.json")).unwrap();
    assert!(
        contents.contains(&written),
        "the file is one writer's whole contents"
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn engine_versions_are_compared_by_major_and_minor() {
    assert!(version_at_least("29.5.1", (24, 0)));
    assert!(version_at_least("24.0.0", (24, 0)));
    assert!(!version_at_least("23.0.6", (24, 0)));
    assert!(version_at_least("4.4.0", (4, 4)));
    assert!(version_at_least("5.0.0-dev", (4, 4)));
    assert!(!version_at_least("4.3.1", (4, 4)));
    assert!(!version_at_least("", (4, 4)));
}

#[test]
fn free_disk_is_read_from_posix_df() {
    let output = "Filesystem     1024-blocks      Used Available Capacity Mounted on\n\
                  /dev/nvme0n1p2  1951000000 900000000 1051000000      47% /\n";

    assert_eq!(parse_df_available_kib(output), Some(1_051_000_000));
    assert_eq!(parse_df_available_kib("garbage"), None);
}

/// The same rules against the real engine on this machine, with a
/// throwaway busybox image standing in for the teammate image. Run with
/// `cargo test -p coding_agent_worker teammate -- --ignored`.
#[tokio::test]
#[ignore = "needs a container engine and the teammate image (teammate-runtime:latest)"]
async fn the_real_engine_runs_the_container_confined_and_deletes_it_on_stop() {
    let engine = real_engine();
    let info = engine.info().await.expect("a container engine answers");
    let program = if info.kind == ContainerEngineKind::Docker {
        "docker"
    } else {
        "podman"
    };
    let busybox_id = test_image(program, "confined", RUNS_UNTIL_STOPPED);
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-test"));
    let install_id = TeammateInstallId::new(format!("test-{}", std::process::id())).unwrap();
    let install = TeammateInstall {
        install_id: install_id.clone(),
        generation: 1,
        delivery: 1,
    };
    let seccomp = super::store::write_file(
        directory.path(),
        "teammate-seccomp.json",
        super::SECCOMP_PROFILE.as_bytes(),
    )
    .unwrap();
    let teammates = Teammates::new(
        engine,
        store.clone(),
        Platform::current(),
        seccomp,
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;

    teammates.handle(TeammateRequest::Run {
        install: install.clone(),
        image: TeammateImage {
            repository: "busybox".to_owned(),
            image_id: busybox_id,
        },
        environment: environment(),
        traceparent: None,
    });
    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running,
        ]
    );

    let name = format!("macro-teammate-{}", install_id.as_str());
    let inspected = std::process::Command::new(program)
        .args(["container", "inspect", "--format", "{{json .}}", &name])
        .output()
        .unwrap();
    let inspected: serde_json::Value = serde_json::from_slice(&inspected.stdout).unwrap();
    let host_config = &inspected["HostConfig"];
    assert_eq!(host_config["ReadonlyRootfs"], true);
    // No capability left in its bounding set (Docker lists the drop as
    // ALL, Podman as each default it dropped: the process says it alike).
    let status = std::process::Command::new(program)
        .args(["exec", &name, "cat", "/proc/1/status"])
        .output()
        .unwrap();
    let status = String::from_utf8_lossy(&status.stdout);
    let bounding = status.lines().find(|line| line.starts_with("CapBnd:"));
    assert_eq!(bounding, Some("CapBnd:\t0000000000000000"), "{status}");
    assert_eq!(host_config["Privileged"], false);
    assert_eq!(host_config["PidsLimit"], 512);
    assert_eq!(host_config["Memory"], 4_i64 * 1024 * 1024 * 1024);
    assert_eq!(host_config["NanoCpus"], 2_000_000_000_i64);
    assert_eq!(host_config["RestartPolicy"]["Name"], "no");
    assert!(
        host_config["SecurityOpt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|option| option
                .as_str()
                .is_some_and(|option| option.starts_with("no-new-privileges")))
    );
    assert!(
        host_config["SecurityOpt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|option| option
                .as_str()
                .is_some_and(|option| option.starts_with("seccomp=")))
    );
    assert_eq!(inspected["Config"]["User"], "1000:1000");
    // Only the holder's network namespace, joined by its id.
    let holder_id = inspect(program, "container", &format!("{name}-net"), "{{.Id}}");
    assert_eq!(host_config["NetworkMode"], format!("container:{holder_id}"));
    assert_eq!(host_config["ShmSize"], 1024_i64 * 1024 * 1024);
    assert_eq!(
        inspected["Config"]["Labels"]["macro.teammate.delivery"],
        "1"
    );
    let mounts = inspected["Mounts"].as_array().unwrap();
    let binds: Vec<&serde_json::Value> = mounts
        .iter()
        .filter(|mount| mount["Type"] == "bind")
        .collect();
    assert_eq!(binds.len(), 1, "{mounts:?}");
    assert_eq!(binds[0]["Destination"], "/run/teammate/agent.env");
    assert_eq!(binds[0]["RW"], false);
    assert_eq!(mounts.len(), 3, "{mounts:?}");
    assert!(!mounts.iter().any(|mount| {
        mount["Source"]
            .as_str()
            .is_some_and(|source| source.contains(".sock"))
    }));

    teammates.handle(TeammateRequest::Stop {
        install,
        traceparent: None,
    });
    while statuses.recv().await.unwrap().state != TeammateRunState::Stopped {}
    assert_eq!(store.read(&install_id).unwrap(), None);
    let left = std::process::Command::new(program)
        .args(["container", "inspect", &name])
        .output()
        .unwrap();
    assert!(!left.status.success(), "the container is left");
    let volume = std::process::Command::new(program)
        .args(["volume", "inspect", &name])
        .output()
        .unwrap();
    assert!(!volume.status.success(), "the volume is left");
    let network = std::process::Command::new(program)
        .args(["network", "inspect", &name])
        .output()
        .unwrap();
    assert!(!network.status.success(), "the network is left");
    let _ = std::process::Command::new(program)
        .args([
            "rmi",
            &format!("macro-teammate-test-confined:{}", std::process::id()),
        ])
        .output();
}

fn restarted(attempt: u32) -> [TeammateRunState; 3] {
    [
        TeammateRunState::Restarting { attempt },
        TeammateRunState::Starting,
        TeammateRunState::Running,
    ]
}

#[tokio::test(start_paused = true)]
async fn each_exit_code_maps_to_one_status() {
    // The one exit table, as the service sees it.
    let cases = [
        (75, restarted(1).to_vec()),
        (0, restarted(1).to_vec()),
        (78, restarted(1).to_vec()),
        (1, restarted(1).to_vec()),
        (
            77,
            vec![TeammateRunState::Failed {
                reason: TeammateRunFailure::BadConfiguration,
            }],
        ),
        (
            79,
            vec![TeammateRunState::Failed {
                reason: TeammateRunFailure::IncompatibleRuntime,
            }],
        ),
    ];
    for (code, states) in cases {
        let mut fixture = fixture().await;
        fixture.teammates.handle(run_request(1));
        next_states(&mut fixture.statuses, 3).await;

        fixture.exit.send(code).unwrap();

        assert_eq!(
            next_states(&mut fixture.statuses, states.len()).await,
            states,
            "exit {code}"
        );
        let runs = run_images_and_exits(&fixture.engine);
        if states.len() == 3 {
            assert_eq!(
                runs,
                [
                    (IMAGE_ID.to_owned(), PreviousExit::Unknown),
                    (
                        IMAGE_ID.to_owned(),
                        PreviousExit::Exited {
                            code: u8::try_from(code).unwrap()
                        }
                    ),
                ],
                "exit {code}"
            );
        } else {
            assert_eq!(runs.len(), 1, "exit {code}: not started again");
        }
    }
}

#[tokio::test(start_paused = true)]
async fn crashes_back_off_and_never_give_up() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    let started = tokio::time::Instant::now();

    for attempt in 1..=12 {
        fixture.exit.send(1).unwrap();
        assert_eq!(
            next_states(&mut fixture.statuses, 3).await,
            restarted(attempt)
        );
    }

    assert_eq!(fixture.engine.runs(), 13);
    // 2 + 4 + 8 + 16 + 32, then 60 seconds for each of the other seven.
    assert_eq!(started.elapsed(), Duration::from_secs(482));
}

#[tokio::test(start_paused = true)]
async fn a_terminal_exit_survives_a_macrod_restart_and_a_new_delivery_starts_it() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    fixture.exit.send(77).unwrap();
    next_states(&mut fixture.statuses, 1).await;

    let restarted_macrod = Teammates::new(
        fixture.engine.clone(),
        fixture.store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = restarted_macrod.subscribe();
    restarted_macrod.detect().await;
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Failed {
            reason: TeammateRunFailure::BadConfiguration
        }]
    );
    assert_eq!(fixture.engine.runs(), 1);

    restarted_macrod.handle(delivery_request(1, 2));
    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(
        run_images_and_exits(&fixture.engine)[1],
        (IMAGE_ID.to_owned(), PreviousExit::Exited { code: 77 })
    );
}

#[tokio::test(start_paused = true)]
async fn a_macrod_restart_in_a_backoff_keeps_the_last_exit() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    fixture.exit.send(1).unwrap();
    next_states(&mut fixture.statuses, 3).await;
    fixture.exit.send(78).unwrap();
    // Exited: macrod re-execs before the backoff ends.
    next_states(&mut fixture.statuses, 1).await;
    drop(fixture.teammates);

    let restarted_macrod = Teammates::new(
        fixture.engine.clone(),
        fixture.store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = restarted_macrod.subscribe();
    restarted_macrod.detect().await;
    assert_eq!(next_states(&mut statuses, 3).await, restarted(1));
    assert_eq!(
        run_images_and_exits(&fixture.engine).last().unwrap().1,
        PreviousExit::Exited { code: 78 }
    );
}

#[tokio::test]
async fn a_restarted_macrod_adopts_a_running_container_while_the_host_has_no_route() {
    // Wi-Fi down when macrod comes back: the running agent's policy reads
    // back intact, so it is adopted, not stopped as egress-blocked.
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    store.save(&stored(install(4)), &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine.state().to_the_internet = false;
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    engine.state().containers.insert(
        "macro-teammate-install-1-net".to_owned(),
        ContainerState {
            id: Some("holder-0".to_owned()),
            running: true,
            delivery: None,
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    teammates.detect().await;

    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Running]
    );
    assert_eq!(
        engine.calls(),
        [Call::Guard {
            holder_id: "holder-0".to_owned(),
            loaded: false
        }]
    );
}

#[tokio::test]
async fn an_adopted_containers_exit_is_passed_on_once() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    store.save(&stored(install(4)), &environment().0).unwrap();
    let (engine, exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    // Its holder, with the policy in place (the fake guard reads it back).
    engine.state().containers.insert(
        "macro-teammate-install-1-net".to_owned(),
        ContainerState {
            id: Some("holder-0".to_owned()),
            running: true,
            delivery: None,
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;
    next_states(&mut statuses, 1).await;

    exit.send(1).unwrap();

    next_states(&mut statuses, 3).await;
    assert_eq!(
        run_images_and_exits(&engine),
        [(IMAGE_ID.to_owned(), PreviousExit::Exited { code: 1 })]
    );
}

#[tokio::test]
async fn an_exit_macrod_did_not_see_is_passed_as_unknown() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let mut kept = stored(install(4));
    kept.lifecycle.policy.started(chrono::Utc::now());
    store.save(&kept, &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    teammates.detect().await;

    next_states(&mut statuses, 3).await;
    assert_eq!(
        run_images_and_exits(&engine),
        [(IMAGE_ID.to_owned(), PreviousExit::Unknown)]
    );
}

/// Run generation 1 on IMAGE_ID until it settles (up 120 s).
async fn settled_fixture() -> Fixture {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    tokio::time::sleep(Duration::from_secs(121)).await;
    fixture
}

#[tokio::test(start_paused = true)]
async fn a_new_image_up_for_120_s_replaces_the_old_one_on_the_same_volumes() {
    let mut fixture = settled_fixture().await;
    fixture
        .engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());

    fixture.teammates.handle(image_request(2, OTHER_IMAGE_ID));
    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    tokio::time::sleep(Duration::from_secs(121)).await;

    // The old agent stopped with its checkpoint, and that stop reaches the
    // new boot as a clean one.
    assert_eq!(
        run_images_and_exits(&fixture.engine),
        [
            (IMAGE_ID.to_owned(), PreviousExit::Unknown),
            (OTHER_IMAGE_ID.to_owned(), PreviousExit::Exited { code: 0 }),
        ]
    );
    assert!(fixture.engine.calls().contains(&Call::Stop(
        "macro-teammate-install-1".to_owned(),
        Duration::from_secs(90)
    )));
    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::RemoveVolume(_)))
    );
    let kept = fixture.store.read(&install(2).install_id).unwrap().unwrap();
    assert_eq!(kept.lifecycle.settled_image, Some(image(OTHER_IMAGE_ID)));
}

#[tokio::test(start_paused = true)]
async fn a_new_image_that_cannot_be_fetched_or_differs_runs_the_previous_one() {
    for (registry_id, reason) in [
        (None, TeammateRunFailure::ImageUnavailable),
        (Some(IMAGE_ID), TeammateRunFailure::ImageMismatch),
    ] {
        let mut fixture = settled_fixture().await;
        if let Some(id) = registry_id {
            fixture
                .engine
                .state()
                .registry
                .insert(OTHER_TAGGED.to_owned(), id.to_owned());
        }

        fixture.teammates.handle(image_request(2, OTHER_IMAGE_ID));

        assert_eq!(
            next_states(&mut fixture.statuses, 3).await,
            [
                TeammateRunState::Downloading,
                TeammateRunState::Starting,
                TeammateRunState::RolledBack { reason }
            ],
            "{reason:?}"
        );
        // The previous image again, with the new delivery's credentials.
        let runs = fixture
            .engine
            .calls()
            .into_iter()
            .filter_map(|call| match call {
                Call::Run(spec) => Some((spec.image_id, spec.delivery)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            runs.last().unwrap(),
            &(
                IMAGE_ID.to_owned(),
                Delivery {
                    generation: 2,
                    delivery: 1
                }
            )
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_new_image_that_dies_within_120_s_rolls_back_once() {
    let mut fixture = settled_fixture().await;
    fixture
        .engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());
    fixture.teammates.handle(image_request(2, OTHER_IMAGE_ID));
    next_states(&mut fixture.statuses, 3).await;

    fixture.exit.send(1).unwrap();

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::RolledBack {
                reason: TeammateRunFailure::CrashLoop
            }
        ]
    );
    assert_eq!(
        run_images_and_exits(&fixture.engine).last().unwrap(),
        &(IMAGE_ID.to_owned(), PreviousExit::Exited { code: 1 })
    );
    // The previous image crashing too is backed off, never rolled again.
    fixture.exit.send(1).unwrap();
    next_states(&mut fixture.statuses, 3).await;
    assert_eq!(
        run_images_and_exits(&fixture.engine).last().unwrap().0,
        IMAGE_ID
    );
    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::RemoveVolume(_)))
    );
}

#[tokio::test(start_paused = true)]
async fn a_new_image_whose_code_needs_more_fails_without_a_rollback() {
    let mut fixture = settled_fixture().await;
    fixture
        .engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());
    fixture.teammates.handle(image_request(2, OTHER_IMAGE_ID));
    next_states(&mut fixture.statuses, 3).await;

    fixture.exit.send(79).unwrap();

    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Failed {
            reason: TeammateRunFailure::IncompatibleRuntime
        }]
    );
}

/// An agent stand-in that runs until its stop, which it takes cleanly.
const RUNS_UNTIL_STOPPED: &str = r#"["sh", "-c", "trap 'exit 0' TERM; sleep 100000 & wait"]"#;

/// An agent stand-in that crashes at once.
const CRASHES: &str = r#"["sh", "-c", "exit 1"]"#;

macro_env_var::maybe_env_vars! { struct MacroTeammateTestEngine; }

/// The engine the real-engine tests run on: `MACRO_TEAMMATE_TEST_ENGINE`
/// (`docker` or `podman`), else `auto`.
fn real_engine() -> super::cli::CliEngine {
    use crate::config::EngineChoice;

    // The supervisor's warnings say why a real start was refused.
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();

    let choice = match MacroTeammateTestEngine::new()
        .map(|engine| engine.to_string())
        .as_deref()
    {
        Some("docker") => EngineChoice::Docker,
        Some("podman") => EngineChoice::Podman,
        Some(other) => panic!("MACRO_TEAMMATE_TEST_ENGINE must be docker or podman, not {other}"),
        None => EngineChoice::Auto,
    };
    super::cli::CliEngine::with_choice(choice)
}

/// The teammate image the real-engine tests build on: it has the guard's
/// nftables and `sh` (`nix run .#teammate-runtime-image` loads it).
const TEAMMATE_IMAGE: &str = "teammate-runtime:latest";

/// Build a throwaway image from the teammate image with `command` as its
/// entrypoint; its id. Each test
/// uses its own `role`: the tests run at once, and each removes its tags.
fn test_image(program: &str, role: &str, command: &str) -> String {
    use std::io::Write as _;

    let tag = format!("macro-teammate-test-{role}:{}", std::process::id());
    // A machine without /etc/containers has no signature policy, which
    // `podman build` asks for even for a local base image.
    let policy = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(
        policy.path(),
        r#"{"default":[{"type":"insecureAcceptAnything"}]}"#,
    )
    .unwrap();
    let mut arguments = vec!["build".to_owned(), "--quiet".to_owned()];
    if program == "podman" {
        arguments.push(format!("--signature-policy={}", policy.path().display()));
    }
    arguments.extend(["--tag".to_owned(), tag.clone(), "-".to_owned()]);
    let mut build = std::process::Command::new(program)
        .args(&arguments)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    write!(
        build.stdin.take().unwrap(),
        "FROM {TEAMMATE_IMAGE}\nENTRYPOINT {command}\n"
    )
    .unwrap();
    let output = build.wait_with_output().unwrap();
    assert!(output.status.success(), "could not build {tag}");
    // Podman prints the id without its algorithm.
    let id = String::from_utf8(output.stdout).unwrap().trim().to_owned();
    if id.starts_with("sha256:") {
        id
    } else {
        format!("sha256:{id}")
    }
}

/// An image id as macrod compares them: Podman prints it without its
/// algorithm.
fn with_algorithm(id: String) -> String {
    if id.is_empty() || id.starts_with("sha256:") {
        id
    } else {
        format!("sha256:{id}")
    }
}

fn inspect(program: &str, object: &str, name: &str, format: &str) -> String {
    let output = std::process::Command::new(program)
        .args([object, "inspect", "--format", format, name])
        .output()
        .unwrap();
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// Stage 3 against a real engine: a new image that crashes in its trial and
/// one that can't be fetched both go back to the settled image, on the same
/// volume. Takes over two minutes (the 120 s trial).
#[tokio::test]
#[ignore = "needs a container engine and the teammate image (teammate-runtime:latest); takes over two minutes"]
async fn the_real_engine_swaps_images_rolls_back_and_keeps_the_volume() {
    let engine = real_engine();
    let info = engine.info().await.expect("a container engine answers");
    let program = if info.kind == ContainerEngineKind::Docker {
        "docker"
    } else {
        "podman"
    };
    let up_id = test_image(program, "swap-up", RUNS_UNTIL_STOPPED);
    let crash_id = test_image(program, "swap-crash", CRASHES);

    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-test"));
    let install_id = TeammateInstallId::new(format!("swap-{}", std::process::id())).unwrap();
    let delivery = |generation| TeammateInstall {
        install_id: install_id.clone(),
        generation,
        delivery: 1,
    };
    let request = |generation, image_id: &str| TeammateRequest::Run {
        install: delivery(generation),
        image: TeammateImage {
            repository: "localhost:1/macro-teammate-test".to_owned(),
            image_id: image_id.to_owned(),
        },
        environment: environment(),
        traceparent: None,
    };
    let seccomp = super::store::write_file(
        directory.path(),
        "teammate-seccomp.json",
        super::SECCOMP_PROFILE.as_bytes(),
    )
    .unwrap();
    let teammates = Teammates::new(
        engine,
        store.clone(),
        Platform::current(),
        seccomp,
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;
    let name = format!("macro-teammate-{}", install_id.as_str());

    teammates.handle(request(1, &up_id));
    next_states(&mut statuses, 3).await;
    let volume_created = inspect(program, "volume", &name, "{{.CreatedAt}}");
    tokio::time::sleep(Duration::from_secs(125)).await;
    assert_eq!(
        store
            .read(&install_id)
            .unwrap()
            .unwrap()
            .lifecycle
            .settled_image
            .map(|image| image.image_id),
        Some(up_id.clone())
    );

    // A new image that dies at once: back to the settled one.
    teammates.handle(request(2, &crash_id));
    assert_eq!(
        next_states(&mut statuses, 6).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running,
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::RolledBack {
                reason: TeammateRunFailure::CrashLoop
            },
        ]
    );
    assert_eq!(
        with_algorithm(inspect(program, "container", &name, "{{.Image}}")),
        up_id
    );

    // A new image that can't be fetched: the settled one again.
    let missing = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    teammates.handle(request(3, missing));
    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::RolledBack {
                reason: TeammateRunFailure::ImageUnavailable
            },
        ]
    );
    assert_eq!(
        with_algorithm(inspect(program, "container", &name, "{{.Image}}")),
        up_id
    );
    assert_eq!(
        inspect(
            program,
            "container",
            &name,
            "{{index .Config.Labels \"macro.teammate.generation\"}}"
        ),
        "3"
    );
    assert_eq!(
        inspect(program, "volume", &name, "{{.CreatedAt}}"),
        volume_created
    );

    teammates.handle(TeammateRequest::Stop {
        install: delivery(3),
        traceparent: None,
    });
    while statuses.recv().await.unwrap().state != TeammateRunState::Stopped {}
    assert!(
        inspect(program, "volume", &name, "{{.Name}}").is_empty(),
        "the volume is left"
    );
    for tag in ["swap-up", "swap-crash"] {
        let _ = std::process::Command::new(program)
            .args([
                "rmi",
                &format!("macro-teammate-test-{tag}:{}", std::process::id()),
            ])
            .output();
    }
}

#[tokio::test]
async fn a_stop_whose_deletion_failed_is_not_started_by_a_restarted_macrod() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    fixture.engine.state().volume_removal_fails = true;

    fixture.teammates.handle(stop_request(1));
    next_states(&mut fixture.statuses, 1).await;
    // Kept, so the service's next stop retries the deletion.
    assert!(
        fixture
            .store
            .read(&install(1).install_id)
            .unwrap()
            .is_some()
    );

    let restarted_macrod = Teammates::new(
        fixture.engine.clone(),
        fixture.store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = restarted_macrod.subscribe();
    restarted_macrod.detect().await;
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

/// Refuse the credentials twice, the persistence apart, as an unpaired
/// machine's checks do.
async fn refuse_for_good(teammates: &Teammates<FakeEngine>) {
    teammates.credentials_refused(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS).await;
    teammates.credentials_refused(CredentialPath::Stream);
}

#[tokio::test(start_paused = true)]
async fn a_runtime_only_refusal_stops_once_and_stays_stopped_until_the_dial_is_accepted() {
    // An edge answers the runtime dial 403 for good while the stream's
    // calls go through: the agents stop once and stay stopped, with no
    // churn on each accepted stream call; an accepted dial brings them back.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture
        .teammates
        .credentials_refused(CredentialPath::RuntimeDial);
    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS).await;
    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);
    fixture
        .teammates
        .credentials_refused(CredentialPath::RuntimeDial);
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_secs(30)).await;
        fixture
            .teammates
            .credentials_accepted(CredentialPath::Stream);
        fixture
            .teammates
            .credentials_refused(CredentialPath::RuntimeDial);
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(fixture.statuses.try_recv().is_err());
    assert_eq!(fixture.engine.runs(), 1);

    fixture
        .teammates
        .credentials_accepted(CredentialPath::RuntimeDial);
    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_dial_that_stopped_calling_no_longer_holds_the_agents() {
    // The runtime dial was refused for good, then its supervisor ended (a
    // client error it doesn't redial): nothing will accept on that path
    // again, so the stream's next accepted call runs the agents.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture
        .teammates
        .credentials_refused(CredentialPath::RuntimeDial);
    tokio::time::sleep(super::REFUSAL_PERSISTS).await;
    fixture
        .teammates
        .credentials_refused(CredentialPath::RuntimeDial);
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );

    fixture
        .teammates
        .stopped_calling(CredentialPath::RuntimeDial);
    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);
    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn refusals_further_apart_than_the_window_stop_nothing() {
    // Two single blips an hour apart (say on two paths, with nothing
    // accepted on the one that refused): not one refusal that persisted.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture
        .teammates
        .credentials_refused(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_WINDOW + Duration::from_secs(1)).await;
    fixture
        .teammates
        .credentials_refused(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS / 2).await;

    assert!(fixture.statuses.try_recv().is_err());
    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Stop(..)))
    );
}

#[tokio::test(start_paused = true)]
async fn a_refusal_that_doesnt_persist_stops_nothing() {
    // A blip: refused, refused again too soon, then accepted.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture
        .teammates
        .credentials_refused(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS / 2).await;
    fixture
        .teammates
        .credentials_refused(CredentialPath::Stream);
    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS).await;
    // Accepted in between: the next refusal starts the wait over.
    fixture
        .teammates
        .credentials_refused(CredentialPath::Stream);
    tokio::time::sleep(super::REFUSAL_PERSISTS / 2).await;

    assert!(fixture.statuses.try_recv().is_err());
    assert!(
        !fixture
            .engine
            .calls()
            .iter()
            .any(|call| matches!(call, Call::Stop(..)))
    );
}

#[tokio::test(start_paused = true)]
async fn refused_harness_credentials_stop_every_teammate_and_keep_its_data() {
    // The machine was unpaired: its agents' keys are revoked, so they stop
    // now rather than at the service's next (never coming) stop.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    let before = fixture.engine.calls().len();

    refuse_for_good(&fixture.teammates).await;

    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    let calls = fixture.engine.calls()[before..].to_vec();
    assert_eq!(
        calls,
        [
            Call::Stop(
                "macro-teammate-install-1".to_owned(),
                super::CREDENTIALS_REFUSED_GRACE
            ),
            Call::Stop(
                "macro-teammate-install-1-net".to_owned(),
                super::CREDENTIALS_REFUSED_GRACE
            ),
        ]
    );
    // The volumes and the kept install stay, for a move or a stop to use.
    assert!(
        fixture
            .store
            .read(&install(1).install_id)
            .unwrap()
            .is_some()
    );

    let restarted_macrod = Teammates::new(
        fixture.engine.clone(),
        fixture.store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = restarted_macrod.subscribe();
    restarted_macrod.detect().await;
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn refused_then_accepted_credentials_run_the_agents_again() {
    // A passing refusal (an auth blip): the next accepted dial brings back
    // what it stopped. The service still stops any it no longer wants.
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    refuse_for_good(&fixture.teammates).await;
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );

    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn agents_stopped_for_refused_credentials_come_back_after_a_restart_once_accepted() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    refuse_for_good(&fixture.teammates).await;
    next_states(&mut fixture.statuses, 1).await;

    let restarted_macrod = Teammates::new(
        fixture.engine.clone(),
        fixture.store.clone(),
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = restarted_macrod.subscribe();
    restarted_macrod.detect().await;
    // Down until a dial is accepted: an unpaired machine never gets one.
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Stopped]
    );
    assert_eq!(fixture.engine.runs(), 1);

    restarted_macrod.credentials_accepted(CredentialPath::Stream);

    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn an_operator_stop_is_never_resumed_by_accepted_credentials() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;
    // Kept after the stop (its volumes couldn't be removed).
    fixture.engine.state().volume_removal_fails = true;
    fixture.teammates.handle(stop_request(1));
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Stopped]
    );

    fixture
        .teammates
        .credentials_accepted(CredentialPath::Stream);
    tokio::time::sleep(Duration::from_secs(60)).await;

    assert!(fixture.statuses.try_recv().is_err());
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn an_engine_that_refuses_a_start_is_retried_with_backoff() {
    let mut fixture = fixture().await;
    fixture.engine.state().refuse_runs = 1;

    fixture.teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 5).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::Running,
        ]
    );
    assert_eq!(fixture.engine.runs(), 2);
}

#[tokio::test]
async fn a_running_container_on_another_image_is_updated_not_adopted() {
    // macrod restarted in the middle of an update, before it kept one: the
    // container still runs the old image under this delivery's labels.
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let mut kept = stored(install(4));
    kept.image = image(OTHER_IMAGE_ID);
    store.save(&kept, &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    teammates.detect().await;

    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running,
        ]
    );
    assert!(engine.calls().contains(&Call::Stop(
        "macro-teammate-install-1".to_owned(),
        Duration::from_secs(90)
    )));
    assert_eq!(
        run_images_and_exits(&engine),
        [(OTHER_IMAGE_ID.to_owned(), PreviousExit::Exited { code: 0 })]
    );
}

/// Teammates on a fake Docker whose registry has [`IMAGE_ID`], after the
/// engine check, for the bridge's tests: what a connection serves, the
/// engine, its exits and the store's directory (kept alive by the caller).
pub(crate) async fn fake_hosting() -> (
    crate::harness::TeammateHosting,
    FakeEngine,
    mpsc::UnboundedSender<i64>,
    tempfile::TempDir,
) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let (engine, exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    let teammates = Arc::new(Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    ));
    let report = teammates.detect().await;
    ((teammates, report), engine, exit, directory)
}

/// Teammates on a fake Docker whose one kept install was stopped because
/// the machine's credentials were refused (as a refusal leaves it), after
/// the engine check: nothing runs until a dial is accepted.
pub(crate) async fn fake_hosting_stopped_for_refused_credentials()
-> (Arc<super::HostTeammates>, FakeEngine, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let mut kept = stored(install(1));
    let stop = teammate_lifecycle::supervisor::ExitEvent {
        code: None,
        requested: true,
    };
    kept.lifecycle.policy.exited(stop, chrono::Utc::now());
    kept.lifecycle.stopped_for = Some(super::store::StopCause::CredentialsRefused);
    store.save(&kept, &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    let teammates = Arc::new(Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    ));
    teammates.detect().await;
    (teammates, engine, directory)
}

/// The image [`fake_hosting`]'s registry has.
pub(crate) fn fake_image() -> TeammateImage {
    image(IMAGE_ID)
}

/// A delivery of the fake install.
pub(crate) fn fake_install() -> TeammateInstall {
    install(1)
}

/// Its environment.
pub(crate) fn fake_environment() -> AgentEnvironment {
    environment()
}

#[test]
fn a_credentials_path_a_mount_option_list_cant_carry_is_refused() {
    for path in [
        "/home/a,readonly=false/.macrod/teammates/h/install-1/agent.env",
        "/home/a=b/.macrod/teammates/h/install-1/agent.env",
    ] {
        let spec = RunSpec {
            install_id: TeammateInstallId::new("install-1").unwrap(),
            delivery: Delivery {
                generation: 1,
                delivery: 1,
            },
            image_id: IMAGE_ID.to_owned(),
            credentials_file: path.into(),
            seccomp_profile: SECCOMP.into(),
            previous_exit: PreviousExit::Unknown,
            holder_id: "holder-1".to_owned(),
        };
        assert_eq!(
            run_arguments(&spec),
            Err(super::engine::UnsafeMountPath(path.into())),
            "{path}"
        );
    }
}

/// Put a second image in [`fake_hosting`]'s registry; it.
pub(crate) fn offer_other_image(engine: &FakeEngine) -> TeammateImage {
    engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());
    image(OTHER_IMAGE_ID)
}

/// The images the fake engine ran, in order.
pub(crate) fn run_images(engine: &FakeEngine) -> Vec<String> {
    run_images_and_exits(engine)
        .into_iter()
        .map(|(image_id, _)| image_id)
        .collect()
}

#[test]
fn the_holder_runs_with_exactly_the_specified_flags() {
    let spec = super::engine::HolderSpec {
        install_id: TeammateInstallId::new("install-1").unwrap(),
        image_id: IMAGE_ID.to_owned(),
        networks: vec![
            "macro-teammate-install-1".to_owned(),
            "macro-wolf_services".to_owned(),
        ],
    };
    let arguments: Vec<String> = super::engine::holder_arguments(&spec)
        .into_iter()
        .map(|argument| argument.into_string().unwrap())
        .collect();
    assert_eq!(
        arguments,
        [
            "run",
            "--detach",
            "--name",
            "macro-teammate-install-1-net",
            "--user",
            "1000:1000",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit",
            "16",
            "--memory",
            "64m",
            "--sysctl",
            "net.ipv4.ping_group_range=1000 1000",
            "--network",
            "macro-teammate-install-1",
            "--network",
            "macro-wolf_services",
            "--label",
            "macro.teammate.install=install-1",
            "--label",
            "macro.teammate.role=holder",
            "--restart",
            "no",
            "--entrypoint",
            "sleep",
            IMAGE_ID,
            "infinity",
        ]
    );
}

#[test]
fn the_guard_runs_with_exactly_the_specified_flags() {
    let arguments: Vec<String> = super::engine::guard_arguments("holder-1", IMAGE_ID, true)
        .into_iter()
        .map(|argument| argument.into_string().unwrap())
        .collect();
    // The holder's network namespace only (no --pid, --ipc or mounts), uid 0
    // with NET_ADMIN alone, the ruleset on stdin, removed when it exits.
    assert_eq!(
        arguments,
        [
            "run",
            "--rm",
            "--interactive",
            "--network",
            "container:holder-1",
            "--user",
            "0:0",
            "--read-only",
            "--cap-drop=ALL",
            "--cap-add=NET_ADMIN",
            "--security-opt=no-new-privileges",
            "--pids-limit",
            "16",
            "--label",
            "macro.teammate.role=guard",
            "--entrypoint",
            "sh",
            IMAGE_ID,
            "-c",
            "nft -f - && nft -j list table inet macro_teammate",
        ]
    );
}

#[test]
fn a_teammate_network_name_is_one_the_engine_reads_as_a_name() {
    assert!(TeammateNetwork::new("macro-wolf_services").is_ok());
    assert!(TeammateNetwork::new("macro.stack-1").is_ok());
    for bad in ["", "-x", "host;rm", "a b", "--privileged", &"a".repeat(129)] {
        assert!(TeammateNetwork::new(bad).is_err(), "{bad}");
    }
}

#[tokio::test]
async fn the_teammate_network_is_joined_by_the_holder() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    let network = TeammateNetwork::new("macro-wolf_services").unwrap();
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress {
            network: Some(network.clone()),
            allow: Vec::new(),
        },
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;

    teammates.handle(run_request(1));
    next_states(&mut statuses, 3).await;

    let Some(Call::RunHolder(spec)) = engine
        .calls()
        .into_iter()
        .rfind(|call| matches!(call, Call::RunHolder(_)))
    else {
        panic!("no holder");
    };
    assert_eq!(
        spec.networks,
        [
            "macro-teammate-install-1".to_owned(),
            network.as_str().to_owned()
        ]
    );
}

/// A new image replaced the settled one and runs, but not yet for its whole
/// trial, when a third arrives and crashes: the fallback is the image the
/// replaced container ran, not the older settled one.
#[tokio::test(start_paused = true)]
async fn a_crashing_image_falls_back_to_the_one_it_replaced() {
    let mut fixture = settled_fixture().await;
    fixture
        .engine
        .state()
        .registry
        .insert(OTHER_TAGGED.to_owned(), OTHER_IMAGE_ID.to_owned());
    fixture
        .engine
        .state()
        .registry
        .insert(THIRD_TAGGED.to_owned(), THIRD_IMAGE_ID.to_owned());
    fixture.teammates.handle(image_request(2, OTHER_IMAGE_ID));
    next_states(&mut fixture.statuses, 3).await;
    tokio::time::sleep(Duration::from_secs(56)).await;

    fixture.teammates.handle(image_request(3, THIRD_IMAGE_ID));
    next_states(&mut fixture.statuses, 3).await;
    fixture.exit.send(1).unwrap();

    assert_eq!(
        next_states(&mut fixture.statuses, 3).await,
        [
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::RolledBack {
                reason: TeammateRunFailure::CrashLoop
            }
        ]
    );
    assert_eq!(
        run_images_and_exits(&fixture.engine).last().unwrap().0,
        OTHER_IMAGE_ID
    );
}

#[test]
fn the_list_shows_the_image_the_container_runs_and_a_rollback() {
    let mut kept = stored(install(3));
    kept.image = image(THIRD_IMAGE_ID);
    let mut update = teammate_lifecycle::replacement::ImageUpdate::new(
        Some(image(OTHER_IMAGE_ID)),
        image(THIRD_IMAGE_ID),
    );
    update.fetched(teammate_lifecycle::replacement::Fetch::Unavailable);
    kept.lifecycle.update = Some(update);
    let running = Observed::Container(ContainerState {
        id: None,
        running: true,
        delivery: Some(Delivery::of(&install(3))),
        image_id: Some(OTHER_IMAGE_ID.to_owned()),
    });

    assert_eq!(
        list_row(&kept, &running),
        format!(
            "{:<40} {:>10}  {:<12}  running, rolled back (imageUnavailable)",
            "install-1", 3, "bbbbbbbbbbbb"
        )
    );
    assert_eq!(
        list_row(&stored(install(1)), &Observed::Absent),
        format!(
            "{:<40} {:>10}  {:<12}  absent",
            "install-1", 1, "aaaaaaaaaaaa"
        )
    );
}

#[tokio::test]
async fn the_agent_starts_only_after_its_holder_and_a_checked_guard() {
    let mut fixture = fixture().await;

    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    let calls = fixture.engine.calls();
    let position = |wanted: &dyn Fn(&Call) -> bool| calls.iter().position(wanted).unwrap();
    let network =
        position(&|call| *call == Call::CreateNetwork("macro-teammate-install-1".to_owned()));
    let holder = position(&|call| matches!(call, Call::RunHolder(_)));
    let guard = position(&|call| {
        *call
            == Call::Guard {
                holder_id: "holder-1".to_owned(),
                loaded: true,
            }
    });
    let run = position(&|call| matches!(call, Call::Run(_)));
    assert!(
        network < holder && holder < guard && guard < run,
        "{calls:?}"
    );
    let Call::Run(spec) = &calls[run] else {
        unreachable!()
    };
    assert_eq!(spec.holder_id, "holder-1");
}

#[tokio::test(start_paused = true)]
async fn a_guard_that_keeps_refusing_parks_the_agent_and_tries_again_for_good() {
    use super::supervisor::{ISOLATION_ATTEMPTS, PARKED_MAX_BACKOFF};

    let mut fixture = fixture().await;
    fixture.engine.state().guard = FakeGuard::Refuses;

    fixture.teammates.handle(run_request(1));

    // Never started open; tried again with backoff, then reported failed.
    let mut states = next_states(&mut fixture.statuses, 2).await;
    assert_eq!(
        states,
        [TeammateRunState::Downloading, TeammateRunState::Starting]
    );
    for attempt in 1..u32::from(ISOLATION_ATTEMPTS) {
        states = next_states(&mut fixture.statuses, 2).await;
        assert_eq!(
            states,
            [
                TeammateRunState::Restarting { attempt },
                TeammateRunState::Starting
            ]
        );
    }
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Failed {
            reason: TeammateRunFailure::NetworkIsolationUnavailable
        }]
    );

    // Still tried, further apart but never more than the cap, with the
    // failure standing.
    let guards = |engine: &FakeEngine| {
        engine
            .calls()
            .iter()
            .filter(|call| matches!(call, Call::Guard { loaded: true, .. }))
            .count()
    };
    for _ in 0..8 {
        let before = guards(&fixture.engine);
        tokio::time::sleep(PARKED_MAX_BACKOFF + Duration::from_secs(1)).await;
        assert!(guards(&fixture.engine) > before);
    }
    assert!(fixture.statuses.try_recv().is_err());
    assert_eq!(fixture.engine.runs(), 0);

    // The engine came back: the next try starts the agent.
    fixture.engine.state().guard = FakeGuard::Loads;
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Running]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_host_with_no_route_to_the_internet_reports_egress_blocked_and_waits_for_one() {
    use super::supervisor::{ISOLATION_ATTEMPTS, PARKED_MAX_BACKOFF};

    let mut fixture = fixture().await;
    fixture.engine.state().to_the_internet = false;

    fixture.teammates.handle(run_request(1));

    let states = next_states(
        &mut fixture.statuses,
        2 * usize::from(ISOLATION_ATTEMPTS) + 1,
    )
    .await;
    assert_eq!(
        states.last(),
        Some(&TeammateRunState::Failed {
            reason: TeammateRunFailure::EgressBlocked
        })
    );
    // Not started: it could reach nothing.
    assert_eq!(fixture.engine.runs(), 0);

    // The host's route came back (a VPN reconnected).
    fixture.engine.state().to_the_internet = true;
    tokio::time::sleep(PARKED_MAX_BACKOFF).await;
    assert_eq!(
        next_states(&mut fixture.statuses, 1).await,
        [TeammateRunState::Running]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_guard_that_fails_once_is_retried_and_the_agent_starts() {
    let mut fixture = fixture().await;
    fixture.engine.state().guard = FakeGuard::RefusesOnce;

    fixture.teammates.handle(run_request(1));

    assert_eq!(
        next_states(&mut fixture.statuses, 5).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Restarting { attempt: 1 },
            TeammateRunState::Starting,
            TeammateRunState::Running,
        ]
    );
    assert_eq!(fixture.engine.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_policy_that_reads_back_wrong_never_starts_the_agent() {
    let mut fixture = fixture().await;
    fixture.engine.state().guard = FakeGuard::ReadsBack(r#"{"nftables": []}"#.to_owned());

    fixture.teammates.handle(run_request(1));

    let states = next_states(
        &mut fixture.statuses,
        2 * usize::from(super::supervisor::ISOLATION_ATTEMPTS) + 1,
    )
    .await;
    assert_eq!(
        states.last(),
        Some(&TeammateRunState::Failed {
            reason: TeammateRunFailure::NetworkIsolationUnavailable
        })
    );
    assert_eq!(fixture.engine.runs(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_holder_that_exits_is_a_crash_and_the_next_start_rebuilds_it() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    // The holder ends; the agent has no network, so it is stopped.
    fixture.engine.holder_exits.notify_waiters();

    assert_eq!(next_states(&mut fixture.statuses, 3).await, restarted(1));
    let calls = fixture.engine.calls();
    let holders: Vec<&Call> = calls
        .iter()
        .filter(|call| matches!(call, Call::RunHolder(_)))
        .collect();
    assert_eq!(holders.len(), 2, "{calls:?}");
    let Some(Call::Run(spec)) = calls.iter().rfind(|call| matches!(call, Call::Run(_))) else {
        panic!("not run again");
    };
    assert_eq!(spec.holder_id, "holder-2");
    assert!(calls.contains(&Call::Guard {
        holder_id: "holder-2".to_owned(),
        loaded: true
    }));
}

#[tokio::test]
async fn a_stop_removes_the_holder_with_the_install() {
    let mut fixture = fixture().await;
    fixture.teammates.handle(run_request(1));
    next_states(&mut fixture.statuses, 3).await;

    fixture.teammates.handle(stop_request(1));
    next_states(&mut fixture.statuses, 1).await;

    assert!(fixture.engine.calls().contains(&Call::RemoveContainer(
        "macro-teammate-install-1-net".to_owned()
    )));
    assert!(
        !fixture
            .engine
            .state()
            .containers
            .contains_key("macro-teammate-install-1-net")
    );
}

#[tokio::test(start_paused = true)]
async fn an_adopted_teammate_without_a_holder_is_restarted_with_one() {
    // A container from before enforced egress: no holder, open network.
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    store.save(&stored(install(4)), &environment().0).unwrap();
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    engine.state().containers.insert(
        "macro-teammate-install-1".to_owned(),
        ContainerState {
            id: None,
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();

    teammates.detect().await;

    // Refused for want of a holder (never reported running), stopped,
    // rebuilt.
    assert_eq!(next_states(&mut statuses, 3).await, restarted(1));
    let calls = engine.calls();
    assert!(
        calls.iter().any(|call| matches!(call, Call::RunHolder(_))),
        "{calls:?}"
    );
    let Some(Call::Run(spec)) = calls.iter().rfind(|call| matches!(call, Call::Run(_))) else {
        panic!("not started again");
    };
    // holder-1 was the isolation probe's.
    assert_eq!(spec.holder_id, "holder-2");
}

#[test]
fn a_host_other_than_linux_cant_enforce_isolation_yet() {
    let macos = Platform {
        os: HostOs::Macos,
        arch: HostArch::Arm64,
    };
    assert_eq!(
        host_report(macos, Ok(docker_info()), None, Vec::new(), Vec::new()).problem,
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    );
}

#[test]
fn an_engine_that_cant_enforce_isolation_is_a_host_problem_before_the_sandbox() {
    use agent_runtime_protocol::domain::schema::v0::{
        EngineIsolation, InstalledEngine, IsolationProblem,
    };
    let docker = |isolation| InstalledEngine {
        kind: ContainerEngineKind::Docker,
        version: Some("29.5.1".to_owned()),
        rootless: false,
        isolation,
    };
    let refused = EngineIsolation::Unavailable {
        reason: IsolationProblem::GuardRefused,
    };
    assert_eq!(
        host_report(
            LINUX,
            Ok(docker_info()),
            Some(false),
            vec![docker(refused)],
            Vec::new()
        )
        .problem,
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    );
    assert_eq!(
        host_report(
            LINUX,
            Ok(docker_info()),
            Some(true),
            vec![docker(EngineIsolation::Enforced)],
            Vec::new()
        )
        .problem,
        None
    );
}

/// An engine with a kept install's image, and macrod restarting on it.
async fn restarted_on(engine: &FakeEngine) -> (Teammates<FakeEngine>, tempfile::TempDir) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let mut kept = stored(install(1));
    kept.lifecycle.policy.started(chrono::Utc::now());
    store.save(&kept, &environment().0).unwrap();
    engine
        .state()
        .images
        .insert(IMAGE_ID.to_owned(), IMAGE_ID.to_owned());
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress::default(),
    );
    (teammates, directory)
}

#[tokio::test]
async fn an_engine_whose_isolation_probe_fails_is_reported_and_hosts_nothing() {
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine.state().guard = FakeGuard::Refuses;
    let (teammates, _directory) = restarted_on(&engine).await;

    let report = teammates.detect().await;

    assert_eq!(
        report.problem,
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    );
    assert!(!can_host(&report));
    // The probe cleaned up after itself.
    assert!(engine.calls().contains(&Call::RemoveContainer(
        "macro-teammate-isolation-probe-net".to_owned()
    )));
    assert!(engine.calls().contains(&Call::RemoveNetwork(
        "macro-teammate-isolation-probe".to_owned()
    )));
}

#[tokio::test(start_paused = true)]
async fn a_probe_that_takes_too_long_keeps_the_last_finished_result() {
    // Under load the isolation probe times out: that is no verdict. The
    // machine keeps the last finished result, checks again every 30 s, and
    // only a probe that finished and failed reports isolation unavailable.
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    let (teammates, _directory) = restarted_on(&engine).await;
    assert_eq!(teammates.detect().await.problem, None);

    engine.state().guard = FakeGuard::Hangs;
    let report = teammates.detect().await;
    assert_eq!(report.problem, None);
    assert!(can_host(&report));

    let teammates = Arc::new(teammates);
    let (to_service, _sent) = mpsc::unbounded_channel();
    let mut link = Link::open(Arc::clone(&teammates), report, &to_service);
    engine.state().guard = FakeGuard::Refuses;
    let checked = tokio::time::timeout(Duration::from_secs(31), next_host_event(&mut link))
        .await
        .expect("an inconclusive check is made again at 30 s");
    let TeammateEvent::Send(
        agent_runtime_protocol::domain::schema::v0::ToServerMessage::TeammateHost { report },
    ) = checked
    else {
        panic!("expected a host report, got {checked:?}");
    };
    assert_eq!(
        report.problem,
        Some(TeammateHostProblem::NetworkIsolationUnavailable)
    );
    // A finished check: no more rechecks.
    assert!(
        tokio::time::timeout(Duration::from_secs(120), next_host_event(&mut link))
            .await
            .is_err()
    );
}

#[tokio::test(start_paused = true)]
async fn a_probe_that_takes_too_long_with_nothing_kept_reports_the_engine_unreachable() {
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine.state().guard = FakeGuard::Hangs;
    let (teammates, _directory) = restarted_on(&engine).await;

    let report = teammates.detect().await;
    assert_eq!(report.problem, Some(TeammateHostProblem::EngineUnreachable));

    let teammates = Arc::new(teammates);
    let (to_service, _sent) = mpsc::unbounded_channel();
    let mut link = Link::open(Arc::clone(&teammates), report, &to_service);
    engine.state().guard = FakeGuard::Loads;
    let checked = tokio::time::timeout(Duration::from_secs(31), next_host_event(&mut link))
        .await
        .expect("checked again at 30 s");
    assert!(matches!(checked, TeammateEvent::Redial), "{checked:?}");
}

/// The link's next event that isn't an install's state change (the kept
/// install's supervisor reports those meanwhile).
async fn next_host_event(link: &mut Link) -> TeammateEvent {
    loop {
        match link.next().await {
            TeammateEvent::Send(
                agent_runtime_protocol::domain::schema::v0::ToServerMessage::TeammateStatus {
                    ..
                },
            ) => {}
            event => return event,
        }
    }
}

#[tokio::test]
async fn auto_chooses_the_first_engine_whose_probe_passes_and_lists_both() {
    use agent_runtime_protocol::domain::schema::v0::{
        EngineIsolation, InstalledEngine, IsolationProblem,
    };
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine.state().guard = FakeGuard::Refuses;
    engine.state().podman_guard = Some(FakeGuard::Loads);
    let (teammates, _directory) = restarted_on(&engine).await;

    let report = teammates.detect().await;

    assert_eq!(report.problem, None);
    assert_eq!(report.engine.unwrap().kind, ContainerEngineKind::Podman);
    assert_eq!(
        report.engines,
        [
            InstalledEngine {
                kind: ContainerEngineKind::Docker,
                version: Some("29.5.1".to_owned()),
                rootless: false,
                isolation: EngineIsolation::Unavailable {
                    reason: IsolationProblem::GuardRefused
                },
            },
            InstalledEngine {
                kind: ContainerEngineKind::Podman,
                version: Some("29.5.1".to_owned()),
                rootless: false,
                isolation: EngineIsolation::Enforced,
            },
        ]
    );
    // The chosen engine is the current one afterwards.
    assert_eq!(engine.state().selected, ContainerEngineKind::Podman);
}

#[test]
fn the_engine_choice_names_which_engines_may_run_teammates() {
    use crate::config::EngineChoice;
    use agent_runtime_protocol::domain::schema::v0::ContainerEngineKind::{Docker, Podman};

    let docker_only = super::cli::CliEngine::with_choice(EngineChoice::Docker);
    assert!(docker_only.wanted(Docker) && !docker_only.wanted(Podman));
    let podman_only = super::cli::CliEngine::with_choice(EngineChoice::Podman);
    assert!(!podman_only.wanted(Docker) && podman_only.wanted(Podman));
    let auto = super::cli::CliEngine::with_choice(EngineChoice::Auto);
    assert!(auto.wanted(Docker) && auto.wanted(Podman));
}

#[tokio::test]
async fn a_local_stack_allows_only_the_services_the_agent_was_given() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-1"));
    let (engine, _exit) = FakeEngine::new(Ok(docker_info()));
    engine
        .state()
        .registry
        .insert(TAGGED.to_owned(), IMAGE_ID.to_owned());
    let services =
        [super::egress::Allow::new("172.30.0.8/32".parse().unwrap(), vec![8080]).unwrap()];
    engine.state().guard =
        FakeGuard::ReadsBack(super::egress::simulated_readback(&services, &fake_facts()));
    let teammates = Teammates::new(
        engine.clone(),
        store,
        LINUX,
        SECCOMP.into(),
        Egress {
            network: Some(TeammateNetwork::new("macro-wolf_services").unwrap()),
            allow: Vec::new(),
        },
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;

    teammates.handle(TeammateRequest::Run {
        install: install(1),
        image: image(IMAGE_ID),
        environment: AgentEnvironment(
            [
                (
                    "OVERRIDE_AGENT_HARNESS_SERVICE_URL".to_owned(),
                    "http://agent-harness-service:8080".to_owned(),
                ),
                // Doesn't resolve in the namespace: left out.
                (
                    "MACRO_GATEWAY".to_owned(),
                    "https://nowhere:27409".to_owned(),
                ),
            ]
            .into_iter()
            .collect(),
        ),
        traceparent: None,
    });

    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    let ruleset = engine.state().last_ruleset.clone().unwrap();
    let accepts: Vec<&str> = ruleset
        .lines()
        .map(str::trim)
        .filter(|line| line.contains("tcp dport {"))
        .collect();
    // One address and port, not the stack's subnet (other teammates share it).
    assert_eq!(
        accepts,
        ["ip daddr 172.30.0.8/32 tcp dport { 8080 } accept"]
    );
}

#[test]
fn the_list_header_names_every_engine_and_the_one_that_runs_teammates() {
    use agent_runtime_protocol::domain::schema::v0::{
        ContainerEngine, EngineIsolation, InstalledEngine, IsolationProblem,
    };
    let mut report = host_report(LINUX, Ok(docker_info()), Some(true), Vec::new(), Vec::new());
    report.engine = Some(ContainerEngine {
        kind: ContainerEngineKind::Podman,
        version: "5.2.0".to_owned(),
        rootless: true,
    });
    report.engines = vec![
        InstalledEngine {
            kind: ContainerEngineKind::Docker,
            version: Some("29.5.1".to_owned()),
            rootless: false,
            isolation: EngineIsolation::Unavailable {
                reason: IsolationProblem::GuardRefused,
            },
        },
        InstalledEngine {
            kind: ContainerEngineKind::Podman,
            version: Some("5.2.0".to_owned()),
            rootless: true,
            isolation: EngineIsolation::Enforced,
        },
    ];
    assert_eq!(
        super::command::engines_line(&report),
        "engines: docker 29.5.1: isolation unavailable (guardRefused) · podman 5.2.0 rootless: isolation ok (runs teammates)"
    );
}

/// The egress policy against a real engine: from inside a running teammate,
/// as uid 1000, the public internet answers and every private, metadata and
/// host destination is dropped, and the agent can't change the rules.
#[tokio::test]
#[ignore = "needs a container engine, the teammate image (teammate-runtime:latest), nginx:alpine and the internet"]
async fn the_real_engine_enforces_the_egress_policy() {
    let engine = real_engine();
    let info = engine.info().await.expect("a container engine answers");
    let program = if info.kind == ContainerEngineKind::Docker {
        "docker"
    } else {
        "podman"
    };
    // A peer on a public-looking address on another of the engine's
    // networks (rootless Podman routes between its networks inside its own
    // namespace, where the host's routes don't show them).
    let lan = format!("macro-teammate-test-lan-{}", std::process::id());
    let peer = format!("macro-teammate-test-peer-{}", std::process::id());
    let run = |arguments: &[&str]| {
        let output = std::process::Command::new(program)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{arguments:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["network", "create", "--subnet", "44.31.250.0/24", &lan]);
    run(&[
        "run",
        "--detach",
        "--name",
        &peer,
        "--network",
        &lan,
        "--ip",
        "44.31.250.10",
        "nginx:alpine",
    ]);
    let up_id = test_image(program, "egress-up", RUNS_UNTIL_STOPPED);

    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-test"));
    let install_id = TeammateInstallId::new(format!("egress-{}", std::process::id())).unwrap();
    let install = TeammateInstall {
        install_id: install_id.clone(),
        generation: 1,
        delivery: 1,
    };
    let seccomp = super::store::write_file(
        directory.path(),
        "teammate-seccomp.json",
        super::SECCOMP_PROFILE.as_bytes(),
    )
    .unwrap();
    // A listener on the host the teammate must not reach.
    let listener = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
    let host_port = listener.local_addr().unwrap().port();
    let teammates = Teammates::new(
        engine,
        store,
        Platform::current(),
        seccomp,
        Egress::default(),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;
    teammates.handle(TeammateRequest::Run {
        install: install.clone(),
        image: TeammateImage {
            repository: "localhost:1/macro-teammate-test".to_owned(),
            image_id: up_id,
        },
        environment: environment(),
        traceparent: None,
    });
    assert_eq!(
        next_states(&mut statuses, 3).await,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );

    let name = format!("macro-teammate-{}", install_id.as_str());
    let in_teammate = |script: &str| {
        std::process::Command::new(program)
            .args(["exec", &name, "bash", "-c", script])
            .output()
            .unwrap()
    };
    let connects = |address: &str, port: u16| {
        in_teammate(&format!(
            "timeout 4 bash -c 'echo > /dev/tcp/{address}/{port}'"
        ))
        .status
        .success()
    };
    assert_eq!(
        String::from_utf8_lossy(&in_teammate("id -u").stdout).trim(),
        "1000"
    );
    assert!(connects("1.1.1.1", 443), "the public internet is reachable");
    assert!(
        in_teammate("timeout 8 curl -sS -o /dev/null https://example.com")
            .status
            .success(),
        "a name resolves and its public address answers"
    );
    let gateway = inspect(
        program,
        "network",
        &name,
        "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
    );
    let host_addresses = super::netfacts::host_prefixes(&String::from_utf8_lossy(
        &std::process::Command::new("ip")
            .args(["-j", "address", "show"])
            .output()
            .unwrap()
            .stdout,
    ))
    .unwrap();
    let host_address = host_addresses
        .iter()
        .find(|net| net.prefix_len() == 32 && !net.addr().is_loopback())
        .map(|net| net.addr().to_string())
        .expect("the host has an IPv4 address");
    for (address, port) in [
        ("169.254.169.254", 80),
        (gateway.as_str(), host_port),
        (host_address.as_str(), host_port),
        ("10.0.0.1", 80),
        ("192.168.0.1", 80),
        ("100.100.100.100", 80),
        ("44.31.250.10", 80),
    ] {
        assert!(!connects(address, port), "{address}:{port} was reachable");
    }
    // The agent can't undo it.
    assert!(!in_teammate("nft flush ruleset").status.success());
    assert!(!in_teammate("nft add table inet escape").status.success());

    teammates.handle(TeammateRequest::Stop {
        install,
        traceparent: None,
    });
    while statuses.recv().await.unwrap().state != TeammateRunState::Stopped {}
    assert!(
        inspect(program, "container", &format!("{name}-net"), "{{.Id}}").is_empty(),
        "the holder is left"
    );
    let _ = std::process::Command::new(program)
        .args([
            "rmi",
            &format!("macro-teammate-test-egress-up:{}", std::process::id()),
        ])
        .output();
    let _ = std::process::Command::new(program)
        .args(["rm", "--force", &peer])
        .output();
    let _ = std::process::Command::new(program)
        .args(["network", "rm", &lan])
        .output();
    drop(listener);
}

/// A local stack against a real engine: the holder joins the stack's
/// network, the agent reaches the service its environment names, at that
/// port only, and nothing else on the shared network.
#[tokio::test]
#[ignore = "needs a container engine, the teammate image (teammate-runtime:latest, with getent) and nginx:alpine"]
async fn the_real_engine_allows_only_a_local_stacks_named_services() {
    let engine = real_engine();
    let info = engine.info().await.expect("a container engine answers");
    let program = if info.kind == ContainerEngineKind::Docker {
        "docker"
    } else {
        "podman"
    };
    let run = |arguments: &[&str]| {
        let output = std::process::Command::new(program)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{arguments:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    };
    let pid = std::process::id();
    let stack = format!("macro-teammate-test-stack-{pid}");
    let service = format!("macro-teammate-test-svc-{pid}");
    let other = format!("macro-teammate-test-other-{pid}");
    run(&["network", "create", &stack]);
    run(&[
        "run",
        "--detach",
        "--name",
        &service,
        "--network",
        &stack,
        "--network-alias",
        "svc",
        "nginx:alpine",
    ]);
    // Another container on the shared network (another teammate, say).
    run(&[
        "run",
        "--detach",
        "--name",
        &other,
        "--network",
        &stack,
        "nginx:alpine",
    ]);
    let other_address = inspect(
        program,
        "container",
        &other,
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    );
    let up_id = test_image(program, "stack-up", RUNS_UNTIL_STOPPED);

    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(directory.path().join("teammates/harness-test"));
    let install_id = TeammateInstallId::new(format!("stack-{pid}")).unwrap();
    let install = TeammateInstall {
        install_id: install_id.clone(),
        generation: 1,
        delivery: 1,
    };
    let seccomp = super::store::write_file(
        directory.path(),
        "teammate-seccomp.json",
        super::SECCOMP_PROFILE.as_bytes(),
    )
    .unwrap();
    let teammates = Teammates::new(
        engine,
        store,
        Platform::current(),
        seccomp,
        Egress {
            network: Some(TeammateNetwork::new(&stack).unwrap()),
            allow: Vec::new(),
        },
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;
    teammates.handle(TeammateRequest::Run {
        install: install.clone(),
        image: TeammateImage {
            repository: "localhost:1/macro-teammate-test".to_owned(),
            image_id: up_id,
        },
        environment: AgentEnvironment(
            [(
                "OVERRIDE_TEST_SERVICE_URL".to_owned(),
                "http://svc:80".to_owned(),
            )]
            .into_iter()
            .collect(),
        ),
        traceparent: None,
    });
    let states = next_states(&mut statuses, 3).await;

    let name = format!("macro-teammate-{}", install_id.as_str());
    let connects = |address: &str, port: u16| {
        std::process::Command::new(program)
            .args([
                "exec",
                &name,
                "bash",
                "-c",
                &format!("timeout 4 bash -c 'echo > /dev/tcp/{address}/{port}'"),
            ])
            .status()
            .unwrap()
            .success()
    };
    let reached_service = connects("svc", 80);
    let reached_other = connects(&other_address, 80);

    teammates.handle(TeammateRequest::Stop {
        install,
        traceparent: None,
    });
    while statuses.recv().await.unwrap().state != TeammateRunState::Stopped {}
    for container in [&service, &other] {
        let _ = std::process::Command::new(program)
            .args(["rm", "--force", container])
            .output();
    }
    let _ = std::process::Command::new(program)
        .args(["network", "rm", &stack])
        .output();
    let _ = std::process::Command::new(program)
        .args(["rmi", &format!("macro-teammate-test-stack-up:{pid}")])
        .output();

    assert_eq!(
        states,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running
        ]
    );
    assert!(reached_service, "the named service is reachable");
    assert!(
        !reached_other,
        "another container on the shared network was reachable"
    );
}

#[test]
fn sign_in_takes_the_only_install_or_asks_which() {
    use super::command::chosen_install;

    let one = stored(install(1));
    let mut other = stored(install(1));
    other.install.install_id = TeammateInstallId::new("install-2").unwrap();

    assert_eq!(
        chosen_install(vec![one.clone()], None).unwrap().install,
        install(1)
    );
    assert_eq!(
        chosen_install(
            vec![one.clone(), other.clone()],
            Some(&other.install.install_id)
        )
        .unwrap()
        .install
        .install_id,
        other.install.install_id
    );
    assert_eq!(
        chosen_install(vec![one.clone(), other.clone()], None).unwrap_err(),
        "this machine keeps 2 teammates; name one: macrod teammate sign-in <install>\n  install-1\n  install-2"
    );
    assert_eq!(
        chosen_install(Vec::new(), None).unwrap_err(),
        "no teammates on this machine"
    );
    assert_eq!(
        chosen_install(vec![one], Some(&other.install.install_id)).unwrap_err(),
        "no teammate install install-2 on this machine"
    );
}
