//! The agent monitor inside macrod (Unix only): the `macrod monitor`
//! subcommands, and the collector the panel and `macrod service` host.
//!
//! One collector serves the machine on `<macrod home>/monitor.sock`. The
//! first process to claim the socket hosts it: the panel or `macrod service`
//! when `[monitor] enabled`, or a `macrod monitor serve` (started by hand, or
//! detached by the viewer when nothing answers). Everyone else finds the live
//! socket and skips hosting. The model, store, sources and gRPC server live
//! in `agent_monitor`; the viewer in `agent_monitor_tui`.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use agent_monitor::client::{ClientEvent, watch as watch_collector};
use agent_monitor::domain::clock::SystemClock;
use agent_monitor::domain::model::Agent;
use agent_monitor::domain::source::{
    AgentSource, TranscriptError, TranscriptFeed, TranscriptStream,
};
use agent_monitor::domain::store::{Store, StoreConfig};
use agent_monitor::domain::supervisor::spawn_source;
use agent_monitor::inbound::grpc::{self, BindError, BoundSocket, MonitorService, ServeError};
use agent_monitor::outbound::demo::DemoConfig;
use agent_monitor::outbound::local::LocalSources;
use futures::StreamExt as _;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::{self, MonitorSettings};
use crate::profiles::MacrodHome;

mod daemon_source;
#[cfg(test)]
mod test;

pub use daemon_source::{DaemonLink, DaemonState, report_daemon};

/// The collector's socket, in macrod's home.
const SOCKET_FILE: &str = "monitor.sock";

/// How long an auto-started collector keeps running with no viewer.
const IDLE_EXIT: Duration = Duration::from_secs(10 * 60);

/// How often an auto-started collector checks for viewers.
const IDLE_CHECK: Duration = Duration::from_secs(30);

/// How long the viewer waits for a collector it started to answer before it
/// opens anyway (it then shows the reconnecting state until it does).
const START_WAIT: Duration = Duration::from_secs(5);

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
    /// The collector's socket; defaults to `~/.macrod/monitor.sock`.
    #[arg(long, global = true)]
    socket: Option<PathBuf>,
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
        /// Exit after this many updates.
        #[arg(long)]
        count: Option<usize>,
    },
}

/// Runs a `macrod monitor` command.
pub async fn run(args: MonitorArgs) -> ExitCode {
    let result = match args.command {
        Some(MonitorCommand::Serve { exit_when_idle }) => {
            let _telemetry = crate::telemetry::install();
            serve(args.socket, exit_when_idle).await
        }
        Some(MonitorCommand::Dump { count }) => dump(args.socket, count).await,
        None => view(args.socket, args.demo).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("macrod monitor: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `<macrod home>/monitor.sock`, or the `--socket` override.
fn socket_path(socket: Option<PathBuf>) -> rootcause::Result<PathBuf> {
    match socket {
        Some(socket) => Ok(socket),
        None => Ok(MacrodHome::locate()?.directory().join(SOCKET_FILE)),
    }
}

/// The `[monitor]` table of the default config; its defaults when there is
/// no home, no config, or no table.
fn settings() -> rootcause::Result<MonitorSettings> {
    let Ok(home) = MacrodHome::locate() else {
        return Ok(MonitorSettings::default());
    };
    Ok(MonitorSettings::read(&home.default_config())?)
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
        let mut local = LocalSources::in_home(home, macrod_home.directory().to_owned(), history);
        local.run_record_dirs = settings.run_record_dirs.clone();

        let tracker = TaskTracker::new();
        let cancel = CancellationToken::new();
        let store = Store::start(
            StoreConfig::default(),
            Arc::new(SystemClock),
            &tracker,
            cancel.clone(),
        );
        for make in local.makers() {
            spawn_source(&store, make, &tracker, cancel.clone());
        }
        if let Some(daemon) = daemon {
            spawn_source(
                &store,
                move || Box::new(daemon_source::DaemonSource::new(daemon.clone())) as Box<dyn AgentSource>,
                &tracker,
                cancel.clone(),
            );
        }

        let service = MonitorService::new(
            store.clone(),
            Arc::new(NoTranscripts),
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

/// The drill-in transcript reader until the transcript sources provide one:
/// every agent reads as having no readable transcript.
struct NoTranscripts;

#[async_trait::async_trait]
impl TranscriptFeed for NoTranscripts {
    async fn follow(
        &self,
        _agent: &Agent,
        _tail: usize,
    ) -> Result<TranscriptStream, TranscriptError> {
        Err(TranscriptError::Unavailable)
    }
}

/// The collector a panel or `macrod service` hosts while `[monitor]
/// enabled`, and the link its serving core reports through.
pub struct Host {
    link: DaemonLink,
    collector: Option<Collector>,
}

impl Host {
    /// A host with nothing running yet.
    pub fn new() -> Self {
        Self {
            link: DaemonLink::new(),
            collector: None,
        }
    }

    /// Where the serving core reports its state.
    pub fn link(&self) -> DaemonLink {
        self.link.clone()
    }

    /// Starts or stops hosting to match `settings.enabled`. Hosting is
    /// skipped when another process serves the machine, and a failure is
    /// logged, never fatal: the monitor is an extra.
    pub async fn apply(&mut self, settings: &MonitorSettings) {
        if !settings.enabled {
            if let Some(collector) = self.collector.take() {
                collector.stop().await;
                tracing::info!("stopped hosting the agent monitor");
            }
            return;
        }
        if self.collector.is_some() {
            return;
        }
        match self.start(settings) {
            Ok(Some(collector)) => {
                tracing::info!("hosting the agent monitor");
                self.collector = Some(collector);
            }
            Ok(None) => tracing::info!("another process already hosts the agent monitor"),
            Err(error) => tracing::warn!(error = ?error, "could not host the agent monitor"),
        }
    }

    fn start(&self, settings: &MonitorSettings) -> rootcause::Result<Option<Collector>> {
        let socket = socket_path(None)?;
        match claim(&socket)? {
            Claim::Bound(bound) => Ok(Some(Collector::start(
                bound,
                settings,
                Some(self.link.subscribe()),
            )?)),
            Claim::Served => Ok(None),
        }
    }

    /// Stops hosting.
    pub async fn stop(&mut self) {
        if let Some(collector) = self.collector.take() {
            collector.stop().await;
        }
    }
}

/// `macrod monitor serve`: the collector alone, until a signal (or, when
/// auto-started, ten minutes without a viewer).
async fn serve(socket: Option<PathBuf>, exit_when_idle: bool) -> rootcause::Result<()> {
    let socket = socket_path(socket)?;
    let settings = settings()?;
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

/// `macrod monitor`: the viewer, on the demo fleet or on the machine's
/// collector, starting a detached one when nothing answers.
async fn view(socket: Option<PathBuf>, demo: bool) -> rootcause::Result<()> {
    let settings = settings()?;
    let feed = if demo {
        agent_monitor_tui::FeedChoice::Demo {
            seed: DemoConfig::default().seed,
        }
    } else {
        let socket = socket_path(socket)?;
        if !answers(&socket) {
            start_collector(&socket)?;
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
/// `<socket directory>/logs/monitor.log`.
fn start_collector(socket: &Path) -> rootcause::Result<()> {
    use std::os::unix::process::CommandExt as _;

    let program = std::env::current_exe()
        .map_err(|error| rootcause::report!("cannot find this macrod's binary: {error}"))?;
    let log = collector_log(socket)?;
    std::process::Command::new(program)
        .args(["monitor", "serve", "--exit-when-idle", "--socket"])
        .arg(socket)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log)
        .process_group(0)
        .spawn()
        .map_err(|error| rootcause::report!("cannot start the monitor collector: {error}"))?;
    Ok(())
}

/// The auto-started collector's log, `logs/monitor.log` beside the socket,
/// private to the user and appended to.
fn collector_log(socket: &Path) -> rootcause::Result<std::fs::File> {
    use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _};

    let directory = socket
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .join("logs");
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)
        .map_err(|error| rootcause::report!("cannot create {}: {error}", directory.display()))?;
    let path = directory.join("monitor.log");
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
