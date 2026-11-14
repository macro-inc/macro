//! Runs every real-machine source and the join against this machine, prints
//! the agent count and a few rows, then optionally stays idle so its system
//! calls can be counted (`strace -c -f -p <pid>`): an idle run must show no
//! periodic `stat` storm, only the 30 s reconcile.
//!
//! `cargo run -p agent_monitor --example sources_dump -- --home ~ [--run-dir DIR]... [--idle 30]`

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use agent_monitor::domain::join::{Facts, build_agents};
use agent_monitor::domain::model::{Cost, SourceKind, SourceState, Status};
use agent_monitor::domain::observation::Change;
use agent_monitor::outbound::local::LocalSources;
use chrono::Utc;
use clap::Parser;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// How long startup may take before the dump prints what it has.
const STARTUP_LIMIT: Duration = Duration::from_secs(120);

#[derive(Parser)]
struct Args {
    /// The user's home directory.
    #[arg(long)]
    home: PathBuf,
    /// macrod's home; defaults to `<home>/.macrod`.
    #[arg(long)]
    macrod: Option<PathBuf>,
    /// A directory of work-run records (repeatable).
    #[arg(long = "run-dir")]
    run_dirs: Vec<PathBuf>,
    /// An hc label that carries a work-run id (repeatable).
    #[arg(long = "run-label")]
    run_labels: Vec<String>,
    /// Hours of transcripts to index.
    #[arg(long, default_value_t = 24)]
    history_hours: u64,
    /// After the dump, stay running this many seconds, applying changes.
    #[arg(long, default_value_t = 0)]
    idle: u64,
    /// Rows to print.
    #[arg(long, default_value_t = 15)]
    rows: usize,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let macrod = args
        .macrod
        .clone()
        .unwrap_or_else(|| args.home.join(".macrod"));
    let mut local = LocalSources::in_home(
        args.home.clone(),
        macrod,
        Duration::from_secs(args.history_hours * 3600),
    );
    local.run_record_dirs = args.run_dirs.clone();
    local.hc_labels.run_id = args.run_labels.clone();

    let (out, mut observations) = mpsc::channel(4096);
    let cancel = CancellationToken::new();
    let makers = local.makers();
    let mut pending: Vec<SourceKind> = Vec::new();
    for make in makers {
        let source = make();
        pending.push(source.kind());
        let out = out.clone();
        let cancel = cancel.clone();
        tokio::spawn(async move {
            let kind = source.kind();
            if let Err(error) = source.run(out, cancel).await {
                eprintln!("{} failed: {error}", kind.name());
            }
        });
    }
    drop(out);

    let started = std::time::Instant::now();
    let mut facts = Facts::default();
    let mut observed = 0_u64;
    let deadline = tokio::time::sleep(STARTUP_LIMIT);
    tokio::pin!(deadline);
    while !pending.is_empty() {
        tokio::select! {
            () = &mut deadline => break,
            observation = observations.recv() => {
                let Some(observation) = observation else { break };
                observed += 1;
                if let Change::Health(health) = &observation.change {
                    let ready = matches!(health.state, SourceState::Absent)
                        || (health.state == SourceState::Healthy && health.indexing.is_none());
                    if ready {
                        pending.retain(|kind| *kind != health.source);
                    }
                    println!(
                        "source {:<18} {:?} items={} indexing={:?} {}",
                        health.source.name(),
                        health.state,
                        health.items,
                        health.indexing.map(|p| format!("{}/{}", p.done, p.total)),
                        health.detail.clone().unwrap_or_default(),
                    );
                }
                facts.apply(observation, Utc::now());
            }
        }
    }
    println!(
        "startup: {observed} observations in {:.1}s, still pending: {:?}",
        started.elapsed().as_secs_f64(),
        pending.iter().map(|kind| kind.name()).collect::<Vec<_>>()
    );

    print_agents(&facts, args.rows);

    if args.idle > 0 {
        println!("idle for {} s (pid {})", args.idle, std::process::id());
        let mut changes = 0_u64;
        let idle = tokio::time::sleep(Duration::from_secs(args.idle));
        tokio::pin!(idle);
        loop {
            tokio::select! {
                () = &mut idle => break,
                observation = observations.recv() => {
                    let Some(observation) = observation else { break };
                    changes += 1;
                    facts.apply(observation, Utc::now());
                }
            }
        }
        println!("{changes} observations while idle");
        print_agents(&facts, args.rows);
    }
    cancel.cancel();
}

fn print_agents(facts: &Facts, rows: usize) {
    let built = build_agents(facts, Utc::now());
    let agents: Vec<_> = built.agents.values().collect();

    let mut by_status: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
    for agent in &agents {
        *by_status.entry(format!("{:?}", agent.status)).or_default() += 1;
        *by_kind.entry(agent.kind.label()).or_default() += 1;
    }
    let live = agents
        .iter()
        .filter(|agent| !agent.status.is_final())
        .count();
    let live_terminals = agents
        .iter()
        .filter(|agent| agent.terminal.is_some() && !agent.status.is_final())
        .count();
    let live_without_terminal = agents
        .iter()
        .filter(|agent| agent.terminal.is_none() && agent.pid.is_some() && !agent.status.is_final())
        .count();
    let priced: f64 = agents.iter().filter_map(|agent| agent.cost.usd()).sum();
    let unpriced = agents
        .iter()
        .filter(|agent| agent.cost.usd().is_none() && agent.tokens.total() > 0)
        .count();

    println!(
        "agents: {} total, {live} not ended ({live_terminals} live terminals + {live_without_terminal} terminal-less running processes)",
        agents.len()
    );
    println!("by status: {by_status:?}");
    println!("by kind: {by_kind:?}");
    println!("cost on rows: ${priced:.2}; {unpriced} agents with usage but unpriced");

    let mut shown: Vec<_> = agents
        .iter()
        .filter(|agent| !agent.status.is_final())
        .collect();
    shown.sort_by_key(|agent| (agent.status, std::cmp::Reverse(agent.last_activity)));
    println!(
        "{:<10} {:<8} {:<9} {:<26} {:>5} {:>6} {:>4} {:>10}  DOING",
        "KIND", "STATUS", "TERM", "NAME", "TURNS", "TOOLS", "ERR", "COST"
    );
    for agent in shown.into_iter().take(rows) {
        let cost = match agent.cost {
            Cost::Known(usd) => format!("${usd:.2}"),
            Cost::Estimated(usd) => format!("~${usd:.2}"),
            Cost::Unpriced => "—".to_owned(),
        };
        let name: String = agent.name.chars().take(26).collect();
        let status = match agent.status {
            Status::Working => "working",
            Status::Blocked => "blocked",
            Status::Waiting => "waiting",
            Status::Idle => "idle",
            Status::Done => "done",
            Status::Failed => "failed",
            Status::Stopped => "stopped",
        };
        println!(
            "{:<10} {:<8} {:<9} {:<26} {:>5} {:>6} {:>4} {:>10}  {}",
            agent.kind.label(),
            status,
            agent.terminal.clone().unwrap_or_default(),
            name,
            agent.turns,
            agent.tool_calls,
            agent.tool_errors,
            cost,
            agent.doing.clone().unwrap_or_default(),
        );
    }
}
