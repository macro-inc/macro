//! A complete team-agent daemon built from `agent_brain` parts.
//!
//! - `daemon` (or `daemon run`): listen to messages, judge relevance, queue
//!   relevant ones per channel, wake `claude -p` to answer, and run a
//!   heartbeat every 30 minutes.
//! - `daemon post <channel_id> <text|->`, `daemon reply <channel_id> <root_id>
//!   <text|->`, `daemon context <channel_id>`: the commands the woken agent
//!   uses to talk in Macro as itself.
//!
//! Environment: `MACRO_API_KEY` (required), `MACRO_GATEWAY` (the gateway
//! origin from your setup) or `MACRO_ENV` (`prod`/`dev`/`local`),
//! `BRAIN_HOME` (state directory; defaults to the current one), `RUST_LOG`
//! (e.g. `info`).

use std::io::Read as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_brain::client::ChannelCache;
use agent_brain::events::MESSAGE_POSTED;
use agent_brain::memory::{PruneOptions, append_jsonl, prune};
use agent_brain::{
    CancellationToken, Candidate, CommandWaker, ConversationQueue, Error, EventFilter, EventKind,
    EventStream, History, Job, MacroClient, MessageRecord, Relevance, RelevanceConfig, Result,
    StateDir, StreamItem, Trigger, Turn, TurnPrompt, TypingGuard, Waker,
};
use futures::StreamExt as _;
use tracing_subscriber::EnvFilter;

/// The model `claude -p` runs with.
const MODEL: &str = "opus";
/// Messages kept per channel history file.
const HISTORY_LINES: usize = 200;
/// Recent messages shown to the relevance check.
const RELEVANCE_CONTEXT: usize = 6;
/// Recent messages shown to the agent when it wakes.
const PROMPT_HISTORY: usize = 20;
const HEARTBEAT: Duration = Duration::from_secs(30 * 60);

const DEFAULT_RESPOND: &str = "You are a team agent in Macro. The messages below were judged relevant to you.
For each: decide whether to reply (skip if it isn't for you, was already answered, or a reply adds nothing).
Find facts before answering. In a direct message (`dm: true`) post top level; elsewhere reply in the thread
of the message's `root`. Pipe your reply text on stdin to the commands under \"How to talk in Macro\".
Then grade the relevance check: append one JSON line per message to log/jev-review.jsonl
{\"message_id\", \"jev_said_relevant\": true, \"actually_relevant\": true|false, \"why\"}. If it was wrong,
or log/decisions.jsonl shows a pattern, edit prompts/relevance.json (questions, threshold, wakeIf).
Keep working notes in state/notes.md.";

const DEFAULT_HEARTBEAT: &str = "You are a team agent in Macro, waking on your heartbeat.
Read state/notes.md, follow up on anything due, and do proactive work that fits your job.
Keep notes current. Do nothing if nothing needs doing.";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let client = MacroClient::from_env()?;
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or_else(usage);
    match args.first().map(String::as_str) {
        None | Some("run") => run(client).await,
        Some("post") => {
            let message = client.post(arg(1)?, text(arg(2)?)?).await?;
            println!("{}", message.id);
            Ok(())
        }
        Some("reply") => {
            let message = client.reply(arg(1)?, arg(2)?, text(arg(3)?)?).await?;
            println!("{}", message.id);
            Ok(())
        }
        Some("context") => {
            for listed in client.recent_messages(arg(1)?, 20).await? {
                let line =
                    serde_json::to_string(&listed).map_err(|e| Error::Config(e.to_string()))?;
                println!("{line}");
            }
            Ok(())
        }
        Some(_) => Err(usage()),
    }
}

fn usage() -> Error {
    Error::Config("usage: daemon [run] | post <channel> <text|-> | reply <channel> <root> <text|-> | context <channel>".to_owned())
}

/// The message text, read from stdin when the argument is `-`.
fn text(arg: &str) -> Result<String> {
    if arg != "-" {
        return Ok(arg.to_owned());
    }
    let mut buffer = String::new();
    std::io::stdin()
        .read_to_string(&mut buffer)
        .map_err(|e| Error::Config(format!("could not read stdin: {e}")))?;
    let trimmed = buffer.trim();
    if trimmed.is_empty() {
        return Err(Error::Config("empty message".to_owned()));
    }
    Ok(trimmed.to_owned())
}

async fn run(client: MacroClient) -> Result<()> {
    let home = std::env::var_os("BRAIN_HOME").map_or_else(|| PathBuf::from("."), PathBuf::from);
    let state = StateDir::new(home);
    state.ensure().await?;
    let me = client.me().await?;
    write_defaults(&client, &state).await?;
    tracing::info!(user_id = %me.user_id, "starting");

    let cancel = CancellationToken::new();
    tokio::spawn(stop_on_signal(cancel.clone()));

    let waker: Arc<dyn Waker> =
        Arc::new(CommandWaker::claude(MODEL, state.root(), state.log_dir()));

    // One worker per channel; a burst in one channel becomes one turn.
    let queue = {
        let (client, state, waker) = (client.clone(), state.clone(), Arc::clone(&waker));
        ConversationQueue::new(
            state.queue_dir(),
            cancel.clone(),
            move |channel_id, batch| {
                respond(
                    client.clone(),
                    state.clone(),
                    Arc::clone(&waker),
                    channel_id,
                    batch,
                )
            },
        )
    };
    queue.resume().await?;

    {
        let (state, waker) = (state.clone(), Arc::clone(&waker));
        Job::new("heartbeat", Trigger::every(HEARTBEAT)).spawn(cancel.clone(), move || {
            heartbeat(state.clone(), Arc::clone(&waker))
        });
    }

    let relevance =
        Relevance::new(client.clone(), state.relevance_path()).log_to(state.decisions_log());
    let channels = ChannelCache::new();
    let filters = vec![EventFilter::events([MESSAGE_POSTED])];
    let mut events = Box::pin(EventStream::new(client.clone(), filters).stream(cancel.clone())?);
    while let Some(item) = events.next().await {
        match item {
            StreamItem::Reconnected { disconnected_at } => {
                // Events while disconnected are lost. Catch up here if it
                // matters to you, e.g. with `client.channel_messages` and
                // `TimelineQuery { activity_after: Some(disconnected_at), .. }`.
                tracing::warn!(%disconnected_at, "reconnected; events in between were missed");
            }
            StreamItem::Event(event) => {
                let EventKind::MessagePosted(posted) = event.kind else {
                    continue;
                };
                let Some(channel_id) = posted.channel_id() else {
                    continue;
                };
                let channel = match channels.get(&client, channel_id).await {
                    Ok(channel) => channel,
                    Err(e) => {
                        tracing::warn!(error = %e, channel_id, "could not read the channel");
                        continue;
                    }
                };
                let record = MessageRecord::from_posted(&posted, &channel, &me.user_id);
                let own = posted.sender.as_str() == me.user_id || posted.sender.is_bot();
                if let Err(e) = consider(&state, &relevance, &queue, record, own).await {
                    tracing::warn!(error = %e, message_id = %posted.message_id, "could not handle a message");
                }
            }
        }
    }

    tracing::info!("stopping; waiting for running turns");
    queue.shutdown().await;
    Ok(())
}

/// Record the message in history, then queue it if it deserves a wake-up.
async fn consider(
    state: &StateDir,
    relevance: &Relevance,
    queue: &ConversationQueue<MessageRecord>,
    mut record: MessageRecord,
    own: bool,
) -> Result<()> {
    let history = History::new(state.history_path(&record.channel_id), HISTORY_LINES);
    let recent: Vec<MessageRecord> = history.recent(RELEVANCE_CONTEXT).await?;
    history.append(&record).await?;
    if own {
        return Ok(());
    }
    let decision = relevance
        .judge(&Candidate::from_record(&record, &recent))
        .await?;
    if !decision.relevant {
        return Ok(());
    }
    record.probabilities = decision.probabilities;
    queue.push(&record.channel_id, &record).await
}

/// Wake the agent on one channel's batch, typing while it works.
async fn respond(
    client: MacroClient,
    state: StateDir,
    waker: Arc<dyn Waker>,
    channel_id: String,
    batch: Vec<MessageRecord>,
) -> Result<()> {
    let Some(last) = batch.last() else {
        return Ok(());
    };
    let thread = (!last.dm).then(|| last.root.clone());
    let typing = TypingGuard::start(client, channel_id.clone(), thread);
    let history: Vec<MessageRecord> = History::new(state.history_path(&channel_id), HISTORY_LINES)
        .recent(PROMPT_HISTORY)
        .await?;
    let prompt = TurnPrompt::from_file(&state.respond_prompt_path())
        .await?
        .section("## How to talk in Macro", talk_commands())
        .messages(&batch)?
        .history(&history)?
        .build();
    let outcome = waker
        .wake(Turn::new("respond", prompt).in_conversation(&channel_id))
        .await;
    typing.stop().await;
    let outcome = outcome?;
    tracing::info!(success = outcome.success, detail = %outcome.detail, "respond turn finished");
    for item in &batch {
        append_jsonl(&state.handled_log(), item).await?;
    }
    Ok(())
}

async fn heartbeat(state: StateDir, waker: Arc<dyn Waker>) {
    let result = async {
        prune(&state, PruneOptions::default()).await?;
        let prompt = TurnPrompt::from_file(&state.heartbeat_prompt_path())
            .await?
            .section("## How to talk in Macro", talk_commands())
            .section("## Now", chrono::Utc::now().to_rfc3339())
            .build();
        waker.wake(Turn::new("heartbeat", prompt)).await
    }
    .await;
    match result {
        Ok(outcome) => {
            tracing::info!(success = outcome.success, detail = %outcome.detail, "heartbeat finished")
        }
        Err(e) => tracing::warn!(error = %e, "heartbeat failed"),
    }
}

/// How the woken agent posts as itself: through this same binary.
fn talk_commands() -> String {
    let exe =
        std::env::current_exe().map_or_else(|_| "daemon".to_owned(), |p| p.display().to_string());
    format!(
        "- Top level: `{exe} post <channel_id> -` (text on stdin)\n\
         - In a thread: `{exe} reply <channel_id> <root> -`\n\
         - Recent messages: `{exe} context <channel_id>`"
    )
}

/// First boot: seed the files the agent owns and tunes.
async fn write_defaults(client: &MacroClient, state: &StateDir) -> Result<()> {
    if !state.relevance_path().exists() {
        let (name, job) = match client.team_agent_profile().await {
            Ok(profile) => (profile.name, profile.job_description.unwrap_or_default()),
            Err(e) => {
                tracing::warn!(error = %e, "no team agent profile; using a generic relevance file");
                ("the agent".to_owned(), "its assigned work".to_owned())
            }
        };
        RelevanceConfig::starter(&name, &job)
            .save(&state.relevance_path())
            .await?;
    }
    for (path, text) in [
        (state.respond_prompt_path(), DEFAULT_RESPOND),
        (state.heartbeat_prompt_path(), DEFAULT_HEARTBEAT),
    ] {
        if !path.exists() {
            tokio::fs::write(&path, text)
                .await
                .map_err(|e| Error::Config(format!("could not write {}: {e}", path.display())))?;
        }
    }
    Ok(())
}

async fn stop_on_signal(cancel: CancellationToken) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {}
                    _ = term.recv() => {}
                }
            }
            Err(_) => {
                tokio::signal::ctrl_c().await.ok();
            }
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await.ok();
    cancel.cancel();
}
