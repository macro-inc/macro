//! The agent monitor inside macrod (Unix only): the `macrod monitor`
//! subcommands, and the collector the panel and `macrod service` host.
//!
//! One collector serves the machine on `<macrod home>/monitor/monitor.sock`,
//! in a directory of its own that the monitor creates 0700 (macrod's home
//! itself may be 0755). The
//! first process to claim the socket hosts it: the panel or `macrod service`
//! when `[monitor] enabled`, or a `macrod monitor serve` (started by hand, or
//! detached by the viewer when nothing answers). Everyone else finds the live
//! socket and skips hosting. The model, store, sources and gRPC server live
//! in `agent_monitor`; the viewer in `agent_monitor_tui`.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use agent_monitor::client::{ClientEvent, MonitorClient, watch as watch_collector};
use agent_monitor::domain::clock::SystemClock;
use agent_monitor::domain::model::AgentId;
use agent_monitor::domain::source::AgentSource;
use agent_monitor::domain::store::{Store, StoreConfig};
use agent_monitor::domain::supervisor::spawn_source;
use agent_monitor::inbound::grpc::{self, BindError, BoundSocket, MonitorService, ServeError};
use agent_monitor::outbound::demo::DemoConfig;
use agent_monitor::outbound::local::LocalSources;
use agent_monitor::outbound::transcript_feed::LocalTranscripts;
use futures::StreamExt as _;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::{self, MonitorSettings};
use crate::profiles::{ConfigSelection, MacrodHome, ProfileName};

mod daemon_source;
#[cfg(test)]
mod test;

pub use daemon_source::{DaemonLink, DaemonState, report_daemon};

/// The collector's socket, in macrod's home.
/// The collector's directory in macrod's home, private to the user.
const SOCKET_DIRECTORY: &str = "monitor";
/// The collector's socket in that directory.
const SOCKET_FILE: &str = "monitor.sock";
/// The auto-started collector's log in that directory.
const COLLECTOR_LOG: &str = "collector.log";

/// How long an auto-started collector keeps running with no viewer.
const IDLE_EXIT: Duration = Duration::from_secs(10 * 60);

/// How often an auto-started collector checks for viewers.
const IDLE_CHECK: Duration = Duration::from_secs(30);

/// How long the viewer waits for a collector it started to answer before it
/// opens anyway (it then shows the reconnecting state until it does).
const START_WAIT: Duration = Duration::from_secs(5);

/// How often a macrod that should host tries to claim the socket while
/// another process holds it.
const CLAIM_RETRY: Duration = Duration::from_secs(60);

/// The step between socket probes while waiting for a started collector.
const START_PROBE: Duration = Duration::from_millis(50);

/// `macrod monitor`: the live agent monitor.
#[derive(clap::Args)]
pub struct MonitorArgs {
    #[command(subcommand)]
    command: Option<MonitorCommand>,
    /// Show the scripted demo fleet from this process, with no collector.
    #[arg(long)]
    demo: bool,
    /// The collector's socket; defaults to `~/.macrod/monitor/monitor.sock`.
    #[arg(long, global = true)]
    socket: Option<PathBuf>,
    /// The config whose `[monitor]` table applies; defaults to
    /// `~/.macrod/macrod.toml`, as for `macrod service`. Only that table is
    /// read.
    #[arg(long, global = true, conflicts_with = "profile")]
    config: Option<PathBuf>,
    /// Read `[monitor]` from the named profile,
    /// `~/.macrod/profiles/<name>.toml`, instead.
    #[arg(long, global = true)]
    profile: Option<ProfileName>,
}

#[derive(clap::Subcommand)]
enum MonitorCommand {
    /// Run the machine's collector alone: no pairing, no config lock, no
    /// harness. Refuses to start when another collector answers the socket.
    Serve {
        /// Exit after ten minutes with no viewer (how the viewer starts it).
        #[arg(long, hide = true)]
        exit_when_idle: bool,
    },
    /// Print the snapshot, then every update, as JSON lines on stdout.
    Dump {
        /// Exit after this many updates (or transcript items).
        #[arg(long)]
        count: Option<usize>,
        /// Print this agent's transcript instead: its last items, then each
        /// new one, as `{"item": ...}` lines.
        #[arg(long, value_name = "AGENT_ID")]
        transcript: Option<String>,
    },
}

/// Runs a `macrod monitor` command.
pub async fn run(args: MonitorArgs) -> ExitCode {
    let config = MonitorConfig {
        config: args.config,
        profile: args.profile,
    };
    let result = match args.command {
        Some(MonitorCommand::Serve { exit_when_idle }) => {
            let _telemetry = crate::telemetry::install();
            serve(args.socket, &config, exit_when_idle).await
        }
        Some(MonitorCommand::Dump {
            count,
            transcript: None,
        }) => dump(args.socket, count).await,
        Some(MonitorCommand::Dump {
            count,
            transcript: Some(agent),
        }) => dump_transcript(args.socket, agent, count).await,
        None => view(args.socket, &config, args.demo).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("macrod monitor: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `<macrod home>/monitor/monitor.sock`, or the `--socket` override.
fn socket_path(socket: Option<PathBuf>) -> rootcause::Result<PathBuf> {
    match socket {
        Some(socket) => Ok(socket),
        None => Ok(MacrodHome::locate()?
            .directory()
            .join(SOCKET_DIRECTORY)
            .join(SOCKET_FILE)),
    }
}

/// Which config's `[monitor]` table the standalone commands read:
/// `--config` or `--profile`, resolved as `macrod service` resolves them.
struct MonitorConfig {
    config: Option<PathBuf>,
    profile: Option<ProfileName>,
}

impl MonitorConfig {
    /// The `[monitor]` table; its defaults when the file or table is missing.
    fn settings(&self) -> rootcause::Result<MonitorSettings> {
        let selection = ConfigSelection::resolve(self.config.clone(), self.profile.clone())?;
        Ok(MonitorSettings::read(&selection.path)?)
    }

    /// The same choice as arguments, for a collector started from here.
    fn arguments(&self) -> Vec<std::ffi::OsString> {
        let mut arguments = Vec::new();
        if let Some(config) = &self.config {
            arguments.push("--config".into());
            arguments.push(config.into());
        }
        if let Some(profile) = &self.profile {
            arguments.push("--profile".into());
            arguments.push(profile.to_string().into());
        }
        arguments
    }
}

/// `path` with a leading `~` replaced by `home`; other paths unchanged.
fn expand_home(path: &Path, home: &Path) -> PathBuf {
    match path.strip_prefix("~") {
        Ok(rest) => home.join(rest),
        Err(_) => path.to_owned(),
    }
}

/// Whether a collector answers on `socket`.
fn answers(socket: &Path) -> bool {
    std::os::unix::net::UnixStream::connect(socket).is_ok()
}

/// What claiming the socket found.
pub enum Claim {
    /// This process now owns the socket.
    Bound(BoundSocket),
    /// Another collector serves it.
    Served,
}

/// Claims the collector socket. A socket that answers belongs to a live
/// collector and is left alone; only after a failed connect does `bind`
/// replace what is left at the path, under the socket's lock (directory
/// 0700, socket 0600).
pub fn claim(socket: &Path) -> Result<Claim, BindError> {
    if answers(socket) {
        return Ok(Claim::Served);
    }
    match grpc::bind(socket) {
        Ok(bound) => Ok(Claim::Bound(bound)),
        Err(BindError::AlreadyServed(_)) => Ok(Claim::Served),
        Err(error) => Err(error),
    }
}

/// A running collector: the store, every local source, and the server.
pub struct Collector {
    cancel: CancellationToken,
    tracker: TaskTracker,
    store: Store,
    server: JoinHandle<Result<(), ServeError>>,
}

impl Collector {
    /// Starts the store and every source of this machine on `socket`, plus
    /// the `daemon` source when a macrod's serving core reports into `daemon`.
    pub fn start(
        socket: BoundSocket,
        settings: &MonitorSettings,
        daemon: Option<watch::Receiver<DaemonState>>,
    ) -> rootcause::Result<Self> {
        let home = config::home_directory()
            .ok_or_else(|| rootcause::report!("no home directory: set HOME"))?;
        let macrod_home = MacrodHome::locate()?;
        let history = Duration::from_secs(u64::from(settings.history_hours) * 3600);
        let run_record_dirs = settings
            .run_record_dirs
            .iter()
            .map(|directory| expand_home(directory, &home))
            .collect();
        let mut local = LocalSources::in_home(home, macrod_home.directory().to_owned(), history);
        local.run_record_dirs = run_record_dirs;
        local.hc_labels.run_id = settings.run_id_labels.clone();
        local.pr_poll = Some(Duration::from_secs(u64::from(settings.pr_poll_secs)));

        let tracker = TaskTracker::new();
        let cancel = CancellationToken::new();
        let store = Store::start(
            StoreConfig {
                history: chrono::TimeDelta::hours(i64::from(settings.history_hours)),
                ..StoreConfig::default()
            },
            Arc::new(SystemClock),
            &tracker,
            cancel.clone(),
        );
        let github = local.github(store.pr_interest());
        for make in local.makers().into_iter().chain(github) {
            spawn_source(&store, make, &tracker, cancel.clone());
        }
        if let Some(daemon) = daemon {
            spawn_source(
                &store,
                move || {
                    Box::new(daemon_source::DaemonSource::new(daemon.clone()))
                        as Box<dyn AgentSource>
                },
                &tracker,
                cancel.clone(),
            );
        }

        let service = MonitorService::new(
            store.clone(),
            Arc::new(LocalTranscripts),
            crate::update::VERSION.to_owned(),
            tracker.clone(),
            cancel.clone(),
        );
        let server = tracker.spawn(grpc::serve(socket, service, cancel.clone()));
        Ok(Self {
            cancel,
            tracker,
            store,
            server,
        })
    }

    /// Stops the server and every source, and waits for them.
    pub async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

/// The collector a panel or `macrod service` hosts while `[monitor]
/// enabled`, and the link its serving core reports through.
pub struct Host {
    link: DaemonLink,
    hosting: Option<Hosting>,
}

/// The task that claims the socket (again and again while another process
/// holds it) and serves the collector once it has it.
struct Hosting {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl Host {
    /// A host with nothing running yet.
    pub fn new() -> Self {
        Self {
            link: DaemonLink::new(),
            hosting: None,
        }
    }

    /// Where the serving core reports its state.
    pub fn link(&self) -> DaemonLink {
        self.link.clone()
    }

    /// Starts or stops hosting to match `settings.enabled`. While another
    /// process holds the socket, the claim is retried every [`CLAIM_RETRY`],
    /// so this macrod takes over when that one exits. Failures are logged,
    /// never fatal: the monitor is an extra.
    pub async fn apply(&mut self, settings: &MonitorSettings) {
        if !settings.enabled {
            self.stop().await;
            return;
        }
        if self.hosting.is_some() {
            return;
        }
        let socket = match socket_path(None) {
            Ok(socket) => socket,
            Err(error) => {
                tracing::warn!(error = ?error, "could not host the agent monitor");
                return;
            }
        };

        let cancel = CancellationToken::new();
        let settings = settings.clone();
        let daemon = self.link.subscribe();
        let serving = cancel.clone();
        let task = tokio::spawn(hold_socket(
            socket,
            cancel.clone(),
            CLAIM_RETRY,
            move |bound| {
                let settings = settings.clone();
                let daemon = daemon.clone();
                let serving = serving.clone();
                async move {
                    match Collector::start(bound, &settings, Some(daemon)) {
                        Ok(collector) => {
                            tracing::info!("hosting the agent monitor");
                            serving.cancelled().await;
                            collector.stop().await;
                            tracing::info!("stopped hosting the agent monitor");
                        }
                        Err(error) => {
                            tracing::warn!(error = ?error, "could not host the agent monitor")
                        }
                    }
                }
            },
        ));
        self.hosting = Some(Hosting { cancel, task });
    }

    /// Stops hosting, or trying to.
    pub async fn stop(&mut self) {
        if let Some(hosting) = self.hosting.take() {
            hosting.cancel.cancel();
            let _ = hosting.task.await;
        }
    }
}

/// Claims `socket` and runs `serve` while holding it; while another process
/// holds it (or claiming fails), tries again every `retry`. Ends when
/// `cancel` fires, after `serve` returns.
async fn hold_socket<F, Serve>(
    socket: PathBuf,
    cancel: CancellationToken,
    retry: Duration,
    mut serve: F,
) where
    F: FnMut(BoundSocket) -> Serve,
    Serve: Future<Output = ()>,
{
    let mut said_served = false;
    loop {
        match claim(&socket) {
            Ok(Claim::Bound(bound)) => {
                serve(bound).await;
                if cancel.is_cancelled() {
                    return;
                }
            }
            Ok(Claim::Served) if !said_served => {
                tracing::info!(
                    "another process hosts the agent monitor; taking over when it exits"
                );
                said_served = true;
            }
            Ok(Claim::Served) => {}
            Err(error) => {
                tracing::warn!(error = %error, "could not claim the agent monitor socket")
            }
        }
        tokio::select! {
            () = cancel.cancelled() => return,
            () = tokio::time::sleep(retry) => {}
        }
    }
}

/// `macrod monitor serve`: the collector alone, until a signal (or, when
/// auto-started, ten minutes without a viewer).
async fn serve(
    socket: Option<PathBuf>,
    config: &MonitorConfig,
    exit_when_idle: bool,
) -> rootcause::Result<()> {
    let socket = socket_path(socket)?;
    let settings = config.settings()?;
    let bound = match claim(&socket)? {
        Claim::Bound(bound) => bound,
        Claim::Served => {
            rootcause::bail!("another collector already serves {}", socket.display())
        }
    };
    let mut collector = Collector::start(bound, &settings, None)?;
    tracing::info!(socket = %socket.display(), "serving the agent monitor");

    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|error| rootcause::report!("cannot watch for SIGTERM: {error}"))?;
    let idle = exit_after_idle(collector.store.clone(), exit_when_idle);
    let outcome = tokio::select! {
        served = &mut collector.server => match served {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(rootcause::report!("{error}")),
            Err(error) => Err(rootcause::report!("the monitor server task failed: {error}")),
        },
        _ = tokio::signal::ctrl_c() => Ok(()),
        _ = terminate.recv() => Ok(()),
        () = idle => {
            tracing::info!("no viewer for ten minutes; exiting");
            Ok(())
        }
    };
    collector.stop().await;
    outcome
}

/// Resolves once the store has had no subscriber for [`IDLE_EXIT`]; never
/// when `enabled` is false.
async fn exit_after_idle(store: Store, enabled: bool) {
    if !enabled {
        return std::future::pending().await;
    }
    let mut checks = tokio::time::interval(IDLE_CHECK);
    let mut idle_since = tokio::time::Instant::now();
    loop {
        checks.tick().await;
        if store.subscribers() > 0 {
            idle_since = tokio::time::Instant::now();
        } else if idle_since.elapsed() >= IDLE_EXIT {
            return;
        }
    }
}

/// `macrod monitor dump`: one JSON object per line: `{"connected": status}`,
/// `{"update": update}`, `{"reconnecting": {...}}`.
async fn dump(socket: Option<PathBuf>, count: Option<usize>) -> rootcause::Result<()> {
    use std::io::Write as _;

    let socket = socket_path(socket)?;
    let cancel = CancellationToken::new();
    let events = watch_collector(socket, cancel.clone());
    tokio::pin!(events);
    let mut updates = 0;
    let mut stdout = std::io::stdout().lock();

    while let Some(event) = events.next().await {
        let line = match event {
            ClientEvent::Connected(status) => serde_json::json!({ "connected": status }),
            ClientEvent::Update(update) => {
                updates += 1;
                serde_json::json!({ "update": update })
            }
            ClientEvent::Reconnecting { retry_in, reason } => serde_json::json!({
                "reconnecting": {
                    "retry_in_ms": u64::try_from(retry_in.as_millis()).unwrap_or(u64::MAX),
                    "reason": reason,
                }
            }),
            ClientEvent::Incompatible { protocol } => {
                rootcause::bail!("the collector speaks protocol {protocol}; update macrod")
            }
        };
        writeln!(stdout, "{line}")
            .and_then(|()| stdout.flush())
            .map_err(|error| rootcause::report!("cannot write to stdout: {error}"))?;
        if count.is_some_and(|count| updates >= count) {
            cancel.cancel();
            break;
        }
    }
    Ok(())
}

/// `macrod monitor dump --transcript <agent>`: the agent's transcript tail,
/// then each new item, one `{"item": ...}` JSON line each.
async fn dump_transcript(
    socket: Option<PathBuf>,
    agent: String,
    count: Option<usize>,
) -> rootcause::Result<()> {
    use std::io::Write as _;

    let socket = socket_path(socket)?;
    let mut client = MonitorClient::connect(&socket)
        .await
        .map_err(|error| rootcause::report!("{error}"))?;
    let items = client
        .follow_transcript(&AgentId::from_wire(agent), 0)
        .await
        .map_err(|error| rootcause::report!("{error}"))?;
    tokio::pin!(items);
    let mut stdout = std::io::stdout().lock();
    let mut printed = 0;

    while let Some(item) = items.next().await {
        let item = item.map_err(|error| rootcause::report!("{error}"))?;
        writeln!(stdout, "{}", serde_json::json!({ "item": item }))
            .and_then(|()| stdout.flush())
            .map_err(|error| rootcause::report!("cannot write to stdout: {error}"))?;
        printed += 1;
        if count.is_some_and(|count| printed >= count) {
            break;
        }
    }
    Ok(())
}

/// `macrod monitor`: the viewer, on the demo fleet or on the machine's
/// collector, starting a detached one when nothing answers.
async fn view(
    socket: Option<PathBuf>,
    config: &MonitorConfig,
    demo: bool,
) -> rootcause::Result<()> {
    let settings = config.settings()?;
    let feed = if demo {
        agent_monitor_tui::FeedChoice::Demo {
            seed: DemoConfig::default().seed,
        }
    } else {
        let socket = socket_path(socket)?;
        if !answers(&socket) {
            start_collector(&socket, config)?;
            wait_until_answering(&socket).await;
        }
        agent_monitor_tui::FeedChoice::Socket(socket)
    };
    agent_monitor_tui::run(agent_monitor_tui::Options {
        feed,
        fps: settings.fps,
    })
    .await
    .map_err(|error| rootcause::report!("{error}"))
}

/// Starts `macrod monitor serve --exit-when-idle` detached from this
/// terminal (its own process group, no stdin or stdout), logging to
/// `collector.log` beside the socket.
fn start_collector(socket: &Path, config: &MonitorConfig) -> rootcause::Result<()> {
    use std::os::unix::process::CommandExt as _;

    let program = std::env::current_exe()
        .map_err(|error| rootcause::report!("cannot find this macrod's binary: {error}"))?;
    let log = collector_log(socket)?;
    std::process::Command::new(program)
        .args(["monitor", "serve", "--exit-when-idle", "--socket"])
        .arg(socket)
        .args(config.arguments())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log)
        .process_group(0)
        .spawn()
        .map_err(|error| rootcause::report!("cannot start the monitor collector: {error}"))?;
    Ok(())
}

/// The auto-started collector's log, `collector.log` beside the socket,
/// private to the user and appended to. Creates the socket's directory 0700
/// when it is missing, as binding would.
fn collector_log(socket: &Path) -> rootcause::Result<std::fs::File> {
    use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _};

    let directory = socket
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(directory)
        .map_err(|error| rootcause::report!("cannot create {}: {error}", directory.display()))?;
    let path = directory.join(COLLECTOR_LOG);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| rootcause::report!("cannot open {}: {error}", path.display()))
}

/// Waits up to [`START_WAIT`] for a just-started collector to answer. The
/// child is another process, so there is nothing to await but the socket.
async fn wait_until_answering(socket: &Path) {
    let deadline = tokio::time::Instant::now() + START_WAIT;
    while !answers(socket) && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(START_PROBE).await;
    }
}
