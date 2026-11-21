use std::sync::Mutex;

use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngine, ContainerEngineKind, HostArch, HostOs,
};
use hosted_runtimes::domain::agent::{AgentEnv, AgentEnvKey};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use team_agents::domain::self_hosting::Checkpoint;

use super::*;

const LAPTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d01));
const DESKTOP: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x0d02));
const INSTALL: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_01a1);

fn install_id(id: Uuid) -> TeammateInstallId {
    TeammateInstallId::new(id.to_string()).unwrap()
}

fn row(generation: u64, delivery: u64) -> TeammateInstallRecord {
    TeammateInstallRecord {
        install_id: INSTALL,
        agent: MacroUserIdStr::parse_from_str("macro|sam-rivera-abc123@agents.macro.invalid")
            .unwrap()
            .into_owned(),
        team_id: Uuid::from_u128(0xaa),
        harness_id: LAPTOP,
        generation,
        run_state: InstallRunState::Running,
        failure: None,
        delivery,
        applied: None,
        checkpoint: None,
        image_id: Some(CURRENT_IMAGE.to_owned()),
    }
}

const CURRENT_IMAGE: &str =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// The runtime image this replica has for every architecture.
fn current_image(_: HostArch) -> Option<TeammateImage> {
    Some(TeammateImage {
        repository: "ghcr.io/macro-inc/teammate-runtime".to_owned(),
        image_id: CURRENT_IMAGE.to_owned(),
    })
}

#[derive(Default)]
struct FakeStore {
    rows: Mutex<Vec<TeammateInstallRecord>>,
    reports: Mutex<Vec<HarnessId>>,
    statuses: Mutex<Vec<(Uuid, (u64, u64), InstallRunState)>>,
}

impl InstallStore for FakeStore {
    fn installs_on(
        &self,
        harness: HarnessId,
    ) -> BoxFuture<'_, Result<Vec<TeammateInstallRecord>, TeamAgentError>> {
        let rows = self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|row| row.harness_id == harness)
            .cloned()
            .collect();
        Box::pin(async move { Ok(rows) })
    }

    fn save_host_report(
        &self,
        harness: HarnessId,
        _: TeammateHostReport,
    ) -> BoxFuture<'_, Result<(), TeamAgentError>> {
        self.reports.lock().unwrap().push(harness);
        Box::pin(async { Ok(()) })
    }

    fn new_image_generation(
        &self,
        install_id: Uuid,
        generation: u64,
        image_id: &str,
    ) -> BoxFuture<'_, Result<Option<TeammateInstallRecord>, TeamAgentError>> {
        let mut rows = self.rows.lock().unwrap();
        let bumped = rows
            .iter_mut()
            .find(|row| {
                row.install_id == install_id
                    && row.generation == generation
                    && row.checkpoint.is_none()
                    && row
                        .image_id
                        .as_deref()
                        .is_some_and(|delivered| delivered != image_id)
            })
            .map(|row| {
                row.generation += 1;
                row.delivery = 0;
                row.clone()
            });
        Box::pin(async move { Ok(bumped) })
    }

    fn record_status(
        &self,
        install_id: Uuid,
        delivery: (u64, u64),
        run_state: InstallRunState,
        _: Option<InstallFailure>,
    ) -> BoxFuture<'_, Result<bool, TeamAgentError>> {
        self.statuses
            .lock()
            .unwrap()
            .push((install_id, delivery, run_state));
        Box::pin(async { Ok(true) })
    }
}

/// Counts deliveries the way the row does: the next delivery of the row's
/// generation whenever the runtime is behind.
#[derive(Default)]
struct FakeIssuer {
    store: Arc<FakeStore>,
    issued: Mutex<Vec<Option<(u64, u64)>>>,
    checkpointed: Mutex<Vec<Uuid>>,
    /// Signalled on each finished checkpoint.
    checkpoint_finished: tokio::sync::Notify,
    /// When set, each issue waits for it: a slow authentication service.
    hold: Mutex<Option<Arc<tokio::sync::Notify>>>,
}

impl InstallIssuer for FakeIssuer {
    fn issue(
        &self,
        _: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> BoxFuture<'_, Result<Option<IssuedInstall>, AgentEnrollmentError>> {
        self.issued.lock().unwrap().push(reported);
        let mut rows = self.store.rows.lock().unwrap();
        let issued = rows
            .iter_mut()
            .find(|row| row.install_id == install_id && row.checkpoint.is_none())
            .filter(|row| (row.generation, row.delivery) > reported.unwrap_or((0, 0)))
            .map(|row| {
                row.delivery += 1;
                row.image_id = Some(CURRENT_IMAGE.to_owned());
                IssuedInstall {
                    generation: row.generation,
                    delivery: row.delivery,
                    image: current_image(HostArch::Amd64).unwrap(),
                    env: AgentEnv::new(
                        [(
                            AgentEnvKey::new("MACRO_API_KEY").unwrap(),
                            "mak_fresh".to_owned(),
                        )]
                        .into(),
                    )
                    .unwrap(),
                }
            });
        let hold = self.hold.lock().unwrap().clone();
        Box::pin(async move {
            if let Some(hold) = hold {
                hold.notified().await;
            }
            Ok(issued)
        })
    }

    fn checkpointed(&self, install_id: Uuid) -> BoxFuture<'_, Result<(), CheckpointUnfinished>> {
        self.checkpointed.lock().unwrap().push(install_id);
        self.checkpoint_finished.notify_one();
        Box::pin(async { Ok(()) })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Sent {
    Run(TeammateInstall),
    Stop(TeammateInstall),
}

struct FakeSockets {
    dial: Mutex<Option<(RuntimeConnectionId, bool)>>,
    sent: Arc<Mutex<Vec<Sent>>>,
    runs_fail: Mutex<bool>,
}

impl FakeSockets {
    fn connected(hosts_teammates: bool) -> Self {
        Self {
            dial: Mutex::new(Some((RuntimeConnectionId::generate(), hosts_teammates))),
            sent: Arc::default(),
            runs_fail: Mutex::new(false),
        }
    }

    fn connection(&self) -> RuntimeConnectionId {
        self.dial.lock().unwrap().unwrap().0
    }

    fn sent(&self) -> Vec<Sent> {
        self.sent.lock().unwrap().clone()
    }
}

impl TeammateSockets for FakeSockets {
    fn dial(&self, _: HarnessId) -> Option<(RuntimeConnectionId, bool)> {
        *self.dial.lock().unwrap()
    }

    fn run(
        &self,
        _: HarnessId,
        _: RuntimeConnectionId,
        install: TeammateInstall,
        _: TeammateImage,
        _: AgentEnvironment,
        _: Option<String>,
    ) -> BoxFuture<'_, bool> {
        let failed = *self.runs_fail.lock().unwrap();
        if !failed {
            self.sent.lock().unwrap().push(Sent::Run(install));
        }
        Box::pin(async move { !failed })
    }

    fn stop(
        &self,
        _: HarnessId,
        _: RuntimeConnectionId,
        install: TeammateInstall,
        _: Option<String>,
    ) -> BoxFuture<'_, bool> {
        self.sent.lock().unwrap().push(Sent::Stop(install));
        Box::pin(async { true })
    }
}

struct Machine {
    delivery: Arc<TeammateDelivery>,
    store: Arc<FakeStore>,
    issuer: Arc<FakeIssuer>,
    sockets: Arc<FakeSockets>,
}

fn machine(rows: Vec<TeammateInstallRecord>, hosts_teammates: bool) -> Machine {
    let store = Arc::new(FakeStore::default());
    store.rows.lock().unwrap().extend(rows);
    let issuer = Arc::new(FakeIssuer {
        store: Arc::clone(&store),
        ..FakeIssuer::default()
    });
    let sockets = Arc::new(FakeSockets::connected(hosts_teammates));
    let delivery = TeammateDelivery::new(
        Arc::clone(&store) as Arc<dyn InstallStore>,
        Arc::clone(&issuer) as Arc<dyn InstallIssuer>,
        Arc::clone(&sockets) as Arc<dyn TeammateSockets>,
        current_image,
    );
    Machine {
        delivery,
        store,
        issuer,
        sockets,
    }
}

fn host_report(installs: Vec<TeammateInstall>) -> TeammateHostReport {
    TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: ContainerEngineKind::Docker,
            version: "29.0.1".to_owned(),
            rootless: false,
        }),
        engines: Vec::new(),
        os: HostOs::Linux,
        arch: HostArch::Amd64,
        cpus: 8,
        memory_mib: 32 * 1024,
        disk_free_mib: Some(200 * 1024),
        problem: None,
        installs,
    }
}

fn running(id: Uuid, generation: u64, delivery: u64) -> TeammateInstall {
    TeammateInstall {
        install_id: install_id(id),
        generation,
        delivery,
    }
}

impl Machine {
    async fn connects_with(&self, installs: Vec<TeammateInstall>) {
        self.delivery
            .on_report(TeammateReport {
                harness: LAPTOP,
                connection: self.sockets.connection(),
                event: TeammateEvent::Message(ToServerMessage::TeammateHost {
                    report: host_report(installs),
                }),
            })
            .await;
    }

    async fn reports(&self, install: TeammateInstall, state: TeammateRunState) {
        self.delivery
            .on_report(TeammateReport {
                harness: LAPTOP,
                connection: self.sockets.connection(),
                event: TeammateEvent::Message(ToServerMessage::TeammateStatus { install, state }),
            })
            .await;
    }
}

#[tokio::test]
async fn a_reconnect_running_the_latest_delivery_sends_and_mints_nothing() {
    let machine = machine(vec![row(1, 2)], true);

    machine.connects_with(vec![running(INSTALL, 1, 2)]).await;
    machine.delivery.installs_changed(LAPTOP).await;

    assert!(machine.sockets.sent().is_empty());
    assert!(machine.issuer.issued.lock().unwrap().is_empty());
    assert_eq!(*machine.store.reports.lock().unwrap(), vec![LAPTOP]);
}

#[tokio::test]
async fn a_runtime_behind_its_row_gets_the_next_delivery_once() {
    let machine = machine(vec![row(1, 0)], true);

    machine.connects_with(vec![]).await;
    // Another replica's change, or a repeated nudge: already sent.
    machine.delivery.installs_changed(LAPTOP).await;

    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 1, 1))]
    );
    assert_eq!(*machine.issuer.issued.lock().unwrap(), vec![None]);
}

/// Wait until `done`, a little at a time; fail after a second.
async fn eventually(done: impl Fn() -> bool) {
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while !done() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("never happened");
}

#[tokio::test]
async fn a_slow_delivery_to_one_machine_never_holds_up_another() {
    let machine = machine(vec![row(1, 0)], true);
    let release = Arc::new(tokio::sync::Notify::new());
    *machine.issuer.hold.lock().unwrap() = Some(Arc::clone(&release));
    let (reports, queued) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(Arc::clone(&machine.delivery).run(queued));
    let connection = machine.sockets.connection();
    let other = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_02a2);

    reports
        .send(TeammateReport {
            harness: LAPTOP,
            connection,
            event: TeammateEvent::Message(ToServerMessage::TeammateHost {
                report: host_report(vec![]),
            }),
        })
        .unwrap();
    eventually(|| !machine.issuer.issued.lock().unwrap().is_empty()).await;
    reports
        .send(TeammateReport {
            harness: DESKTOP,
            connection,
            event: TeammateEvent::Message(ToServerMessage::TeammateStatus {
                install: running(other, 1, 1),
                state: TeammateRunState::Running,
            }),
        })
        .unwrap();

    // The desktop's report is handled while the laptop's delivery waits.
    eventually(|| !machine.store.statuses.lock().unwrap().is_empty()).await;
    assert!(machine.sockets.sent().is_empty());
    release.notify_one();
    eventually(|| !machine.sockets.sent().is_empty()).await;
    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 1, 1))]
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_configuration_is_redelivered_with_a_new_key_at_most_every_five_minutes() {
    let machine = machine(vec![row(1, 1)], true);
    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;
    let refused = TeammateRunState::Failed {
        reason: TeammateRunFailure::BadConfiguration,
    };

    // Its key may be revoked: a new delivery is a new key.
    machine
        .reports(running(INSTALL, 1, 1), refused.clone())
        .await;
    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 1, 2))]
    );

    // Refused again at once: no new key until five minutes have passed.
    machine
        .reports(running(INSTALL, 1, 2), refused.clone())
        .await;
    assert_eq!(machine.sockets.sent().len(), 1);
    tokio::time::advance(BAD_CONFIGURATION_REDELIVERY).await;
    machine.reports(running(INSTALL, 1, 2), refused).await;
    assert_eq!(
        machine.sockets.sent(),
        vec![
            Sent::Run(running(INSTALL, 1, 2)),
            Sent::Run(running(INSTALL, 1, 3)),
        ]
    );
}

#[tokio::test]
async fn a_refused_configuration_of_an_older_delivery_mints_nothing_more() {
    let machine = machine(vec![row(1, 2)], true);
    machine.connects_with(vec![running(INSTALL, 1, 2)]).await;

    // A late failure of delivery 1: the runtime already runs delivery 2.
    machine
        .reports(
            running(INSTALL, 1, 1),
            TeammateRunState::Failed {
                reason: TeammateRunFailure::BadConfiguration,
            },
        )
        .await;

    assert!(machine.sockets.sent().is_empty());
    assert!(machine.issuer.issued.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_new_runtime_image_is_a_new_generation_delivered_on_connect() {
    let machine = machine(
        vec![TeammateInstallRecord {
            image_id: Some(format!("sha256:{}", "b".repeat(64))),
            ..row(1, 1)
        }],
        true,
    );

    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    // New keys with the new image; once it runs, nothing more.
    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 2, 1))]
    );
    machine.connects_with(vec![running(INSTALL, 2, 1)]).await;
    assert_eq!(machine.sockets.sent().len(), 1);
}

#[tokio::test]
async fn an_install_never_delivered_gets_its_first_delivery_not_a_new_generation() {
    let machine = machine(
        vec![TeammateInstallRecord {
            image_id: None,
            ..row(1, 0)
        }],
        true,
    );

    machine.connects_with(vec![]).await;

    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 1, 1))]
    );
}

#[tokio::test]
async fn an_incompatible_runtime_is_not_redelivered() {
    let machine = machine(vec![row(1, 1)], true);
    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    // Only a newer image helps; new keys for the same one wouldn't.
    machine
        .reports(
            running(INSTALL, 1, 1),
            TeammateRunState::Failed {
                reason: TeammateRunFailure::IncompatibleRuntime,
            },
        )
        .await;

    assert!(machine.sockets.sent().is_empty());
    assert!(machine.issuer.issued.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_lost_send_is_delivered_again_as_the_next_delivery_on_reconnect() {
    let machine = machine(vec![row(1, 0)], true);
    *machine.sockets.runs_fail.lock().unwrap() = true;
    machine.connects_with(vec![]).await;
    assert!(machine.sockets.sent().is_empty());

    *machine.sockets.runs_fail.lock().unwrap() = false;
    machine.connects_with(vec![]).await;

    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Run(running(INSTALL, 1, 2))]
    );
}

#[tokio::test]
async fn an_install_that_is_not_this_machines_any_more_is_stopped() {
    let stale = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0bad);
    let machine = machine(vec![row(1, 1)], true);

    machine
        .connects_with(vec![running(INSTALL, 1, 1), running(stale, 3, 1)])
        .await;
    // Asked again before it reported stopped: not sent twice.
    machine.delivery.installs_changed(LAPTOP).await;

    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Stop(running(stale, 3, 1))]
    );
}

#[tokio::test]
async fn a_move_stops_the_install_and_finishes_once_the_runtime_reports_it_stopped() {
    let moving = TeammateInstallRecord {
        checkpoint: Some((
            Checkpoint::Moving {
                to: HarnessId::new_from_uuid(Uuid::from_u128(0x0d02)),
            },
            chrono::Utc::now(),
        )),
        ..row(1, 1)
    };
    let machine = machine(vec![moving], true);

    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    assert_eq!(
        machine.sockets.sent(),
        vec![Sent::Stop(running(INSTALL, 1, 1))]
    );
    assert!(machine.issuer.checkpointed.lock().unwrap().is_empty());

    machine
        .reports(running(INSTALL, 1, 1), TeammateRunState::Stopped)
        .await;

    assert_eq!(*machine.issuer.checkpointed.lock().unwrap(), vec![INSTALL]);
    assert!(machine.issuer.issued.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_move_whose_stop_never_comes_finishes_after_the_timeout() {
    let removing = TeammateInstallRecord {
        checkpoint: Some((Checkpoint::Removing, chrono::Utc::now())),
        ..row(1, 1)
    };
    let machine = machine(vec![removing], true);
    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    assert!(machine.issuer.checkpointed.lock().unwrap().is_empty());
    let started = tokio::time::Instant::now();

    // Paused time runs forward to the timer.
    machine.issuer.checkpoint_finished.notified().await;

    assert!(started.elapsed() >= CHECKPOINT_TIMEOUT);
    assert_eq!(*machine.issuer.checkpointed.lock().unwrap(), vec![INSTALL]);
}

#[tokio::test]
async fn a_checkpoint_of_an_install_the_runtime_does_not_run_finishes_at_once() {
    let removing = TeammateInstallRecord {
        checkpoint: Some((Checkpoint::Removing, chrono::Utc::now())),
        ..row(1, 1)
    };
    let machine = machine(vec![removing], true);

    machine.connects_with(vec![]).await;

    assert!(machine.sockets.sent().is_empty());
    assert_eq!(*machine.issuer.checkpointed.lock().unwrap(), vec![INSTALL]);
}

#[tokio::test]
async fn a_status_report_is_recorded_for_its_delivery() {
    let machine = machine(vec![row(1, 1)], true);
    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    machine
        .reports(running(INSTALL, 1, 1), TeammateRunState::Running)
        .await;

    assert_eq!(
        *machine.store.statuses.lock().unwrap(),
        vec![(INSTALL, (1, 1), InstallRunState::Running)]
    );
}

#[tokio::test]
async fn a_runtime_that_hosts_no_teammates_is_sent_none() {
    let machine = machine(vec![row(1, 0)], false);

    machine.delivery.installs_changed(LAPTOP).await;

    assert!(machine.sockets.sent().is_empty());
    assert!(machine.issuer.issued.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_closed_dial_forgets_its_machine_unless_a_newer_one_replaced_it() {
    let machine = machine(vec![row(1, 1)], true);
    machine.connects_with(vec![running(INSTALL, 1, 1)]).await;

    // An older dial's close changes nothing.
    machine
        .delivery
        .on_report(TeammateReport {
            harness: LAPTOP,
            connection: RuntimeConnectionId::generate(),
            event: TeammateEvent::Closed,
        })
        .await;
    assert!(machine.delivery.views.lock().unwrap().contains_key(&LAPTOP));

    machine
        .delivery
        .on_report(TeammateReport {
            harness: LAPTOP,
            connection: machine.sockets.connection(),
            event: TeammateEvent::Closed,
        })
        .await;
    assert!(machine.delivery.views.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn redeliveries_older_than_the_window_are_forgotten() {
    let machine = machine(vec![], true);
    let first = install_id(INSTALL);
    let second = install_id(Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_02a3));
    assert!(machine.delivery.may_redeliver(&first));

    tokio::time::advance(BAD_CONFIGURATION_REDELIVERY).await;
    assert!(machine.delivery.may_redeliver(&second));

    let redelivered = machine.delivery.redelivered.lock().unwrap();
    assert_eq!(redelivered.len(), 1);
    assert!(redelivered.contains_key(&second));
}
