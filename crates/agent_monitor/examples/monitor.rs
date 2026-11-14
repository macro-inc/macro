//! Runs the collector or reads one, before the `macrod monitor` subcommands
//! exist:
//!
//! ```sh
//! cargo run -p agent_monitor --example monitor -- serve --demo --socket /tmp/monitor.sock
//! cargo run -p agent_monitor --example monitor -- dump --socket /tmp/monitor.sock --count 50
//! ```

#[cfg(not(unix))]
fn main() {
    eprintln!("the agent monitor needs Unix sockets");
}

#[cfg(unix)]
fn main() -> Result<(), rootcause::Report> {
    unix::main()
}

#[cfg(unix)]
mod unix {
    use std::path::PathBuf;
    use std::sync::Arc;

    use agent_monitor::client::{ClientEvent, watch};
    use agent_monitor::domain::clock::SystemClock;
    use agent_monitor::domain::model::{Update, UpdateKind};
    use agent_monitor::domain::source::AgentSource;
    use agent_monitor::domain::store::{Store, StoreConfig};
    use agent_monitor::domain::supervisor::spawn_source;
    use agent_monitor::inbound::grpc::{MonitorService, bind, serve};
    use agent_monitor::outbound::demo::{DemoConfig, DemoSource, DemoTranscripts};
    use clap::{Parser, Subcommand};
    use futures::StreamExt as _;
    use tokio_util::sync::CancellationToken;
    use tokio_util::task::TaskTracker;

    #[derive(Parser)]
    struct Cli {
        #[command(subcommand)]
        command: Command,
    }

    #[derive(Subcommand)]
    enum Command {
        /// Serve the collector until Ctrl-C.
        Serve {
            /// Feed it the scripted demo fleet. Without it the collector has no sources.
            #[arg(long)]
            demo: bool,
            /// The socket to serve on.
            #[arg(long)]
            socket: PathBuf,
        },
        /// Print the snapshot and then every update, one line each.
        Dump {
            /// The collector's socket.
            #[arg(long)]
            socket: PathBuf,
            /// Exit after this many updates.
            #[arg(long)]
            count: Option<usize>,
        },
    }

    #[tokio::main]
    pub async fn main() -> Result<(), rootcause::Report> {
        tracing_subscriber::fmt()
            .with_writer(std::io::stderr)
            .init();
        match Cli::parse().command {
            Command::Serve { demo, socket } => run_serve(demo, socket).await,
            Command::Dump { socket, count } => {
                run_dump(socket, count).await;
                Ok(())
            }
        }
    }

    async fn run_serve(demo: bool, socket: PathBuf) -> Result<(), rootcause::Report> {
        let tracker = TaskTracker::new();
        let cancel = CancellationToken::new();
        let clock = Arc::new(SystemClock);
        let store = Store::start(
            StoreConfig::default(),
            clock.clone(),
            &tracker,
            cancel.clone(),
        );
        let transcripts = DemoTranscripts::default();

        if demo {
            let feed = transcripts.clone();
            spawn_source(
                &store,
                move || {
                    Box::new(DemoSource::new(
                        DemoConfig::default(),
                        clock.clone(),
                        feed.clone(),
                    )) as Box<dyn AgentSource>
                },
                &tracker,
                cancel.clone(),
            );
        }

        let listener = bind(&socket)?;
        let service = MonitorService::new(
            store,
            Arc::new(transcripts),
            env!("CARGO_PKG_VERSION").to_owned(),
            tracker.clone(),
            cancel.clone(),
        );
        eprintln!("serving on {}", socket.display());

        let server = serve(listener, service, cancel.clone());
        tokio::select! {
            result = server => result?,
            _ = tokio::signal::ctrl_c() => cancel.cancel(),
        }
        tracker.close();
        tracker.wait().await;
        let _ = std::fs::remove_file(&socket);
        Ok(())
    }

    async fn run_dump(socket: PathBuf, count: Option<usize>) {
        let cancel = CancellationToken::new();
        let events = watch(socket, cancel.clone());
        tokio::pin!(events);
        let mut updates = 0;

        while let Some(event) = events.next().await {
            match event {
                ClientEvent::Connected(status) => println!(
                    "connected protocol={} version={} sources={}",
                    status.protocol,
                    status.version,
                    status.sources.len()
                ),
                ClientEvent::Update(update) => {
                    println!("{}", describe(&update));
                    updates += 1;
                }
                ClientEvent::Reconnecting { retry_in, reason } => {
                    println!("reconnecting in {retry_in:?}: {reason}");
                }
                ClientEvent::Incompatible { protocol } => {
                    println!("the collector speaks protocol {protocol}; update this viewer");
                }
            }
            if count.is_some_and(|count| updates >= count) {
                cancel.cancel();
                break;
            }
        }
    }

    fn describe(update: &Update) -> String {
        let seq = update.seq;
        match &update.kind {
            UpdateKind::Snapshot(snapshot) => format!(
                "{seq} snapshot agents={} tape={} sources={} prs={}",
                snapshot.agents.len(),
                snapshot.tape.len(),
                snapshot.sources.len(),
                snapshot.prs.len()
            ),
            UpdateKind::PrUpsert(pr) => format!(
                "{seq} pr {} {:?} ci={:?} agents={}",
                pr.id,
                pr.state,
                pr.ci,
                pr.agents.len()
            ),
            UpdateKind::PrRemoved(id) => format!("{seq} pr removed {id}"),
            UpdateKind::Upsert(agent) => format!(
                "{seq} upsert {} {} {:?} turns={} tools={} errors={} cost={:?} doing={}",
                agent.id,
                agent.kind.label(),
                agent.status,
                agent.turns,
                agent.tool_calls,
                agent.tool_errors,
                agent.cost,
                agent.doing.as_deref().unwrap_or("-")
            ),
            UpdateKind::Removed(id) => format!("{seq} removed {id}"),
            UpdateKind::Event(event) => format!(
                "{seq} event {} {:?} {:?} {}",
                event.agent, event.kind, event.severity, event.text
            ),
            UpdateKind::Totals(totals) => format!(
                "{seq} totals working={} waiting={} blocked={} turns_24h={} tools_24h={} errors_24h={} today={:?}",
                totals.working,
                totals.waiting,
                totals.blocked,
                totals.turns_24h,
                totals.tools_24h,
                totals.errors_24h,
                totals.cost_today
            ),
            UpdateKind::Source(health) => format!(
                "{seq} source {} {:?} items={} restarts={}",
                health.source.name(),
                health.state,
                health.items,
                health.restarts
            ),
            UpdateKind::Heartbeat(at) => format!("{seq} heartbeat {at}"),
        }
    }
}
