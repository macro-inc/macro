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
use super::engine::{
    ContainerState, Delivery, Engine, EngineError, EngineInfo, EngineUnavailable, RunSpec,
    TeammateNetwork, run_arguments,
};
use super::host::{Platform, can_host, host_report};
use super::store::{Lifecycle, Store, StoredInstall};
use super::{Status, TeammateRequest, Teammates};
use teammate_lifecycle::exit::PreviousExit;

const SECCOMP: &str = "/home/ada/.macrod/teammates/teammate-seccomp.json";

const IMAGE_ID: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_IMAGE_ID: &str =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REPOSITORY: &str = "ghcr.io/macro-inc/teammate-runtime";
const OTHER_TAGGED: &str = "ghcr.io/macro-inc/teammate-runtime:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
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
}

/// An engine in memory. Containers exit with the codes the test sends.
#[derive(Clone)]
pub(crate) struct FakeEngine {
    state: Arc<Mutex<FakeState>>,
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
            })),
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
    let teammates = Teammates::new(engine.clone(), store.clone(), LINUX, SECCOMP.into(), None);
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
        host_report(platform, engine, user_namespaces, Vec::new()).problem
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
    assert_eq!(problem(macos, Ok(docker_info()), None), None);
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
            None,
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
        extra_network: None,
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
            "macro-teammate-install-1",
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
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(engine.clone(), store, LINUX, SECCOMP.into(), None);
    let mut statuses = teammates.subscribe();

    let report = teammates.detect().await;

    assert_eq!(report.installs, [install(4)]);
    assert_eq!(
        next_states(&mut statuses, 1).await,
        [TeammateRunState::Running]
    );
    assert!(engine.calls().is_empty(), "{:?}", engine.calls());

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
            running: false,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(engine.clone(), store, LINUX, SECCOMP.into(), None);
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
        calls[stop + 1..stop + 5],
        [
            Call::RemoveContainer("macro-teammate-install-1".to_owned()),
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
    let teammates = Teammates::new(engine.clone(), store.clone(), LINUX, SECCOMP.into(), None);
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
#[ignore = "needs a container engine and the busybox image"]
async fn the_real_engine_runs_the_container_confined_and_deletes_it_on_stop() {
    use super::cli::CliEngine;

    let engine = CliEngine::new();
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
    let teammates = Teammates::new(engine, store.clone(), Platform::current(), seccomp, None);
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
    assert_eq!(host_config["CapDrop"], serde_json::json!(["ALL"]));
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
    assert_eq!(host_config["NetworkMode"], name.as_str());
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
        None,
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
        None,
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
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(engine.clone(), store, LINUX, SECCOMP.into(), None);
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
    let teammates = Teammates::new(engine.clone(), store, LINUX, SECCOMP.into(), None);
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

/// Build a throwaway image from busybox with `command`; its id. Each test
/// uses its own `role`: the tests run at once, and each removes its tags.
fn test_image(program: &str, role: &str, command: &str) -> String {
    use std::io::Write as _;

    let tag = format!("macro-teammate-test-{role}:{}", std::process::id());
    let mut build = std::process::Command::new(program)
        .args(["build", "--quiet", "--tag", &tag, "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    write!(
        build.stdin.take().unwrap(),
        "FROM busybox:latest\nCMD {command}\n"
    )
    .unwrap();
    let output = build.wait_with_output().unwrap();
    assert!(output.status.success(), "could not build {tag}");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
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
#[ignore = "needs a container engine and the busybox image; takes over two minutes"]
async fn the_real_engine_swaps_images_rolls_back_and_keeps_the_volume() {
    use super::cli::CliEngine;

    let engine = CliEngine::new();
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
    let teammates = Teammates::new(engine, store.clone(), Platform::current(), seccomp, None);
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
    assert_eq!(inspect(program, "container", &name, "{{.Image}}"), up_id);

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
    assert_eq!(inspect(program, "container", &name, "{{.Image}}"), up_id);
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
        None,
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
            running: true,
            delivery: Some(Delivery::of(&install(4))),
            image_id: Some(IMAGE_ID.to_owned()),
        },
    );
    let teammates = Teammates::new(engine.clone(), store, LINUX, SECCOMP.into(), None);
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
        None,
    ));
    let report = teammates.detect().await;
    ((teammates, report), engine, exit, directory)
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
            extra_network: None,
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
fn a_local_stack_network_is_a_second_network_on_the_run() {
    let spec = RunSpec {
        install_id: TeammateInstallId::new("install-1").unwrap(),
        delivery: Delivery {
            generation: 1,
            delivery: 1,
        },
        image_id: IMAGE_ID.to_owned(),
        credentials_file: "/home/ada/.macrod/teammates/h/install-1/agent.env".into(),
        seccomp_profile: SECCOMP.into(),
        previous_exit: PreviousExit::Unknown,
        extra_network: Some(TeammateNetwork::new("macro-wolf_services").unwrap()),
    };

    let arguments: Vec<String> = run_arguments(&spec)
        .unwrap()
        .into_iter()
        .map(|argument| argument.into_string().unwrap())
        .collect();

    let networks: Vec<&str> = arguments
        .windows(2)
        .filter(|pair| pair[0] == "--network")
        .map(|pair| pair[1].as_str())
        .collect();
    // The install's own network stays; the stack's is added.
    assert_eq!(
        networks,
        ["macro-teammate-install-1", "macro-wolf_services"]
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
async fn the_teammate_network_reaches_every_run() {
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
        Some(network.clone()),
    );
    let mut statuses = teammates.subscribe();
    teammates.detect().await;

    teammates.handle(run_request(1));
    next_states(&mut statuses, 3).await;

    let Some(Call::Run(spec)) = engine
        .calls()
        .into_iter()
        .rfind(|call| matches!(call, Call::Run(_)))
    else {
        panic!("not run");
    };
    assert_eq!(spec.extra_network, Some(network));
}
