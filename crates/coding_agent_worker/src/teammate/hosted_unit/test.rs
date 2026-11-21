use super::*;

#[test]
fn macrod_runs_exactly_these_systemctl_commands() {
    assert_eq!(
        SystemctlCommand::StartAndWait(Unit::Agent).arguments(),
        ["start", "--wait", "macro-agent.service"]
    );
    assert_eq!(
        SystemctlCommand::Start(Unit::Apply).arguments(),
        ["start", "macro-agent-apply.service"]
    );
    assert_eq!(
        SystemctlCommand::Stop(Unit::Agent).arguments(),
        ["stop", "macro-agent.service"]
    );
    assert_eq!(
        SystemctlCommand::Show(Unit::Agent).arguments(),
        [
            "show",
            "--property=ActiveState,Restart,ExecMainCode,ExecMainStatus",
            "macro-agent.service"
        ]
    );
}

#[test]
fn the_unit_state_reads_the_exit_and_whether_it_is_controlled() {
    assert_eq!(
        UnitState::parse("ActiveState=inactive\nRestart=no\nExecMainCode=1\nExecMainStatus=78\n"),
        UnitState {
            active: false,
            controlled: true,
            last_exit: Some(78)
        }
    );
    // Killed by SIGKILL: 128 + 9.
    assert_eq!(
        UnitState::parse("ActiveState=failed\nRestart=no\nExecMainCode=2\nExecMainStatus=9\n")
            .last_exit,
        Some(137)
    );
    // Never ran; an older image's unit restarts itself.
    assert_eq!(
        UnitState::parse("ActiveState=active\nRestart=always\nExecMainCode=0\nExecMainStatus=0\n"),
        UnitState {
            active: true,
            controlled: false,
            last_exit: None
        }
    );
}

/// A unit in memory. Each `StartAndWait` reports the previous-exit file it
/// started with and waits for the exit the test sends; `Stop` ends it with
/// `SIGTERM`'s 143.
#[derive(Clone)]
struct FakeSystemctl {
    state: std::sync::Arc<std::sync::Mutex<FakeUnit>>,
    exits_sender: mpsc::UnboundedSender<u8>,
    exits: std::sync::Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<u8>>>,
    starts: mpsc::UnboundedSender<Option<String>>,
    /// Every command, as it is run.
    commands: mpsc::UnboundedSender<SystemctlCommand>,
    previous_exit: PathBuf,
}

struct FakeUnit {
    unit: UnitState,
    calls: Vec<SystemctlCommand>,
}

impl Systemctl for FakeSystemctl {
    async fn run(&self, command: SystemctlCommand) -> Result<String, SystemctlError> {
        let show = {
            let mut state = self.state.lock().unwrap();
            state.calls.push(command);
            let _ = self.commands.send(command);
            let unit = state.unit;
            format!(
                "ActiveState={}\nRestart={}\nExecMainCode={}\nExecMainStatus={}\n",
                if unit.active { "active" } else { "inactive" },
                if unit.controlled { "no" } else { "always" },
                if unit.last_exit.is_some() { 1 } else { 0 },
                unit.last_exit.unwrap_or(0),
            )
        };
        match command {
            SystemctlCommand::Show(_) => Ok(show),
            SystemctlCommand::StartAndWait(_) => {
                self.state.lock().unwrap().unit.active = true;
                let _ = self
                    .starts
                    .send(std::fs::read_to_string(&self.previous_exit).ok());
                let code = self.exits.lock().await.recv().await.unwrap_or(0);
                let mut state = self.state.lock().unwrap();
                state.unit.active = false;
                state.unit.last_exit = Some(code);
                Ok(String::new())
            }
            SystemctlCommand::Stop(_) => {
                let _ = self.exits_sender.send(143);
                Ok(String::new())
            }
            SystemctlCommand::Start(_) => Ok(String::new()),
        }
    }
}

struct Fixture {
    systemctl: FakeSystemctl,
    exits: mpsc::UnboundedSender<u8>,
    starts: mpsc::UnboundedReceiver<Option<String>>,
    commands: mpsc::UnboundedReceiver<SystemctlCommand>,
    paths: HostedPaths,
    _directory: tempfile::TempDir,
}

fn fixture(unit: UnitState) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let paths = HostedPaths {
        policy: directory.path().join("hosted-agent.json"),
        previous_exit: directory.path().join("previous-exit"),
    };
    let (exits_sender, exits) = mpsc::unbounded_channel();
    let (starts_sender, starts) = mpsc::unbounded_channel();
    let (commands_sender, commands) = mpsc::unbounded_channel();
    let systemctl = FakeSystemctl {
        state: std::sync::Arc::new(std::sync::Mutex::new(FakeUnit {
            unit,
            calls: Vec::new(),
        })),
        exits_sender: exits_sender.clone(),
        exits: std::sync::Arc::new(tokio::sync::Mutex::new(exits)),
        starts: starts_sender,
        commands: commands_sender,
        previous_exit: paths.previous_exit.clone(),
    };
    Fixture {
        systemctl,
        exits: exits_sender,
        starts,
        commands,
        paths,
        _directory: directory,
    }
}

const FRESH: UnitState = UnitState {
    active: false,
    controlled: true,
    last_exit: None,
};

fn previous(value: &str) -> Option<String> {
    Some(format!("TEAMMATE_PREVIOUS_EXIT={value}\n"))
}

#[tokio::test]
async fn an_older_images_unit_is_left_alone() {
    let fixture = fixture(UnitState {
        active: true,
        controlled: false,
        last_exit: None,
    });
    let (_deliveries, received) = mpsc::unbounded_channel();

    control(fixture.systemctl.clone(), fixture.paths.clone(), received).await;

    assert_eq!(
        fixture.systemctl.state.lock().unwrap().calls,
        [SystemctlCommand::Show(Unit::Agent)]
    );
}

#[tokio::test(start_paused = true)]
async fn the_unit_is_started_with_its_previous_exit_and_restarted_after_a_land() {
    let mut fixture = fixture(FRESH);
    let agent = HostedAgent::start(fixture.systemctl.clone(), fixture.paths.clone());

    assert_eq!(fixture.starts.recv().await.unwrap(), previous("unknown"));
    fixture.exits.send(75).unwrap();
    assert_eq!(fixture.starts.recv().await.unwrap(), previous("75"));
    fixture.exits.send(1).unwrap();
    assert_eq!(fixture.starts.recv().await.unwrap(), previous("1"));
    drop(agent);
}

#[tokio::test(start_paused = true)]
async fn a_terminal_exit_waits_for_a_delivery_which_installs_and_starts_it() {
    let mut fixture = fixture(FRESH);
    let agent = HostedAgent::start(fixture.systemctl.clone(), fixture.paths.clone());
    fixture.starts.recv().await.unwrap();

    fixture.exits.send(79).unwrap();
    // The exit is read (Show after the wait) before the delivery comes.
    let mut shows = 0;
    while shows < 2 {
        if fixture.commands.recv().await.unwrap() == SystemctlCommand::Show(Unit::Agent) {
            shows += 1;
        }
    }
    agent.delivered();

    assert_eq!(fixture.starts.recv().await.unwrap(), previous("79"));
    let calls = fixture.systemctl.state.lock().unwrap().calls.clone();
    let apply = calls
        .iter()
        .position(|call| *call == SystemctlCommand::Start(Unit::Apply))
        .expect("the delivery was installed");
    let second_start = calls
        .iter()
        .rposition(|call| *call == SystemctlCommand::StartAndWait(Unit::Agent))
        .unwrap();
    assert!(apply < second_start, "{calls:?}");
}

#[tokio::test(start_paused = true)]
async fn a_delivery_while_running_installs_then_stops_the_agent_as_asked() {
    let mut fixture = fixture(FRESH);
    let agent = HostedAgent::start(fixture.systemctl.clone(), fixture.paths.clone());
    fixture.starts.recv().await.unwrap();

    agent.delivered();

    // Stopped as asked: the next boot sees a clean stop.
    assert_eq!(fixture.starts.recv().await.unwrap(), previous("0"));
    let calls = fixture.systemctl.state.lock().unwrap().calls.clone();
    let apply = calls
        .iter()
        .position(|call| *call == SystemctlCommand::Start(Unit::Apply))
        .unwrap();
    let stop = calls
        .iter()
        .position(|call| *call == SystemctlCommand::Stop(Unit::Agent))
        .unwrap();
    assert!(apply < stop, "{calls:?}");
}

#[tokio::test(start_paused = true)]
async fn a_restarted_macrod_adopts_the_active_unit_and_passes_its_exit_on() {
    let mut fixture = fixture(FRESH);
    // The last macrod started it, then crashed.
    let mut kept = PolicyState::default();
    kept.started(chrono::Utc::now());
    std::fs::write(&fixture.paths.policy, serde_json::to_vec(&kept).unwrap()).unwrap();
    fixture.systemctl.state.lock().unwrap().unit.active = true;

    let agent = HostedAgent::start(fixture.systemctl.clone(), fixture.paths.clone());

    // Adopted: waited on, never started, so no previous exit was written.
    assert_eq!(fixture.starts.recv().await.unwrap(), None);
    fixture.exits.send(1).unwrap();
    assert_eq!(fixture.starts.recv().await.unwrap(), previous("1"));
    drop(agent);
}

#[tokio::test(start_paused = true)]
async fn the_backoff_is_kept_for_the_next_macrod() {
    let mut fixture = fixture(FRESH);
    let agent = HostedAgent::start(fixture.systemctl.clone(), fixture.paths.clone());
    fixture.starts.recv().await.unwrap();
    fixture.exits.send(1).unwrap();
    fixture.starts.recv().await.unwrap();
    drop(agent);

    let kept: PolicyState =
        serde_json::from_slice(&std::fs::read(&fixture.paths.policy).unwrap()).unwrap();
    assert!(matches!(
        kept.phase(),
        teammate_lifecycle::supervisor::Phase::Running { .. }
    ));
    let serialized = serde_json::to_string(&kept).unwrap();
    assert!(serialized.contains("recentFailures"), "{serialized}");
}
