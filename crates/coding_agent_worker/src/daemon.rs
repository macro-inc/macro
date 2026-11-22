//! The serving core, packaged so it can be started, stopped, and restarted.
//!
//! The control panel owns exactly one of these, restarting it when the
//! credential changes (a re-pair) and stopping it when the harness is
//! removed - which is what makes the TUI and the daemon one process.

use std::path::Path;
use std::time::Duration;

use tokio::sync::{Notify, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::AbortOnDropHandle;

use crate::config::{Config, HarnessCredentials};
use crate::dispatch::Dispatcher;
use crate::harness::{HandoffSender, Handoffs};
use crate::outbound::acp_process::RunningAgent;
use crate::outbound::agent_session::HarnessApi;
use crate::outbound::stream::{EventStreamClient, StreamNext};
use crate::retry_delay::RetryDelays;
use crate::runtime::Runtime;
use crate::trigger::{TriggerEvent, handle_event, trigger_filters};
use crate::turns::ActiveTurns;

mod health;
mod position;
#[cfg(test)]
mod test;

pub use health::TriggerStreamHealth;
use position::StreamPosition;

/// How often the bound-agent set is re-read without being told it changed.
/// The service says when it binds an agent on connect
/// (`ToRuntimeMessage::AgentsChanged`); this catches every other binding and
/// services too old to say. A trigger sent before the stream covers a new
/// agent is replayed from the cursor once it does, so this bounds how long
/// such a trigger waits, not whether it arrives.
const BOUND_AGENT_REFRESH: Duration = Duration::from_secs(10);

/// How often a held runtime connection is compared with what the service says.
const PRESENCE_CHECK_EVERY: Duration = Duration::from_secs(60);

/// A running serving core: SSE listener, harness bridge.
pub struct Daemon {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<rootcause::Result<()>>,
    turns: ActiveTurns,
    #[cfg_attr(
        not(unix),
        expect(dead_code, reason = "agents are handed off only on Unix")
    )]
    handoff: HandoffSender,
    runtime_connected: watch::Receiver<bool>,
    trigger_stream: watch::Receiver<TriggerStreamHealth>,
    _presence_watch: AbortOnDropHandle<()>,
}

/// The agent a previous macrod process image handed over, ready to relay.
#[cfg(unix)]
pub type InheritedAgent = crate::handoff::HandedOffAgent;
#[cfg(not(unix))]
pub type InheritedAgent = std::convert::Infallible;

/// How long a handoff may take before macrod gives up on keeping the agent.
#[cfg(unix)]
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(30);

/// How soon a failed hosting setup is tried again, doubling to
/// [`MAX_HOSTING_RETRY`].
const FIRST_HOSTING_RETRY: Duration = Duration::from_secs(1);

/// The longest wait between hosting setup attempts.
const MAX_HOSTING_RETRY: Duration = Duration::from_secs(300);

/// Set up hosting teammates into `hosting`. A failed setup is retried in
/// the background with backoff, for good, so a macrod that failed once (a
/// transient file error at start) hosts once it succeeds instead of never
/// until a restart; the task is aborted when the handle is dropped.
fn set_up_hosting<SetUp>(
    hosting: &crate::harness::Hosting,
    mut set_up: SetUp,
) -> Option<AbortOnDropHandle<()>>
where
    SetUp: FnMut() -> rootcause::Result<Option<crate::harness::HostTeammates>> + Send + 'static,
{
    match set_up() {
        Ok(Some(teammates)) => {
            hosting.set(std::sync::Arc::new(teammates));
            None
        }
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(error = ?error, "could not set up hosting teammates; trying again");
            Some(AbortOnDropHandle::new(tokio::spawn(retry_hosting(
                hosting.clone(),
                set_up,
            ))))
        }
    }
}

/// Try setting up hosting again until it succeeds (or there is nothing to
/// host here).
async fn retry_hosting<SetUp>(hosting: crate::harness::Hosting, mut set_up: SetUp)
where
    SetUp: FnMut() -> rootcause::Result<Option<crate::harness::HostTeammates>> + Send + 'static,
{
    let mut delays = RetryDelays::new(FIRST_HOSTING_RETRY, MAX_HOSTING_RETRY);
    for attempt in 2u32.. {
        tokio::time::sleep(delays.next_delay()).await;
        let span = tracing::info_span!("teammate.hosting_setup", attempt);
        let _entered = span.enter();
        match set_up() {
            Ok(Some(teammates)) => {
                tracing::info!("set up hosting teammates");
                hosting.set(std::sync::Arc::new(teammates));
                return;
            }
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(error = ?error, "could not set up hosting teammates; trying again");
            }
        }
    }
}

/// The teammates this macrod hosts in containers (docs/design/
/// teammate-runtime.md). Without them macrod still serves sessions; it just
/// doesn't list the capability. Tests never touch the real engine or the
/// home directory's store.
fn host_teammates(
    macro_api: &crate::config::MacroApi,
    teammates: &crate::config::TeammatesSettings,
    credentials: &HarnessCredentials,
) -> rootcause::Result<Option<crate::harness::HostTeammates>> {
    #[cfg(all(unix, not(test)))]
    return crate::teammate::host(
        credentials.harness_id,
        crate::teammate::ingest::IngestTarget {
            url: format!(
                "{}/teammates/telemetry",
                macro_api.api_url.trim_end_matches('/')
            ),
            token: credentials.token.clone(),
        },
        macro_api.teammate_network.as_deref(),
        teammates,
    )
    .map(Some);
    #[cfg(any(not(unix), test))]
    {
        let _ = (macro_api, teammates, credentials);
        Ok(None)
    }
}

impl Daemon {
    /// Connect the runtime and listen for agent triggers in background tasks.
    ///
    /// Returns once the client is built; the serving itself runs until
    /// [`Daemon::stop`] or the task fails.
    pub async fn start(
        mut config: Config,
        credentials: HarnessCredentials,
        _config_path: &Path,
        inherited: Option<InheritedAgent>,
    ) -> rootcause::Result<Self> {
        let cancel = CancellationToken::new();
        let client = EventStreamClient::new(&config.macro_api, &credentials);
        let api = HarnessApi::new(&config.macro_api, &credentials);

        #[cfg(unix)]
        let herdr = start_herdr(&mut config, &credentials);
        #[cfg(unix)]
        let tap = herdr
            .as_ref()
            .map(|hub| std::sync::Arc::new(hub.tap()) as crate::harness::LineTap);
        #[cfg(not(unix))]
        let tap = None;

        #[cfg(unix)]
        let workspaces = if crate::herdr::drives_herdr(&config.harness) {
            let root = crate::herdr::instance_directory(credentials.harness_id)?;
            crate::herdr::HerdrSession::detect()?
                .ok_or_else(|| rootcause::report!("start macrod inside a Herdr pane"))?;
            crate::herdr::configure_launch(&mut config.harness, &config.herdr, &root);
            Some(crate::herdr::repositories::Workspaces::new(
                config.workspace.path.clone(),
                config.herdr.storage_path.clone().unwrap_or(root),
            ))
        } else {
            None
        };

        let turns = ActiveTurns::default();
        let adopted = adopt(inherited, &turns);
        let (handoffs, handoff) = Handoffs::channel();
        let computer = crate::computer::is_macro_computer().then(|| {
            std::sync::Arc::new(crate::computer::Computer::new(
                &config.macro_api,
                &config.workspace.path,
            ))
        });
        // Taken before the runtime dials: connecting can bind an agent and
        // let someone ask it for a session, and the stream must replay that
        // request however late it opens. This floor is this machine's clock,
        // compared with the service's event ids: a clock ahead of the
        // service's by more than the seconds between starting and the first
        // request would skip that request, and one behind by as much would
        // replay events from just before the start that a previous macrod
        // may have handled. Every later open resumes from a service id, and
        // `StreamPosition` drops repeats within this process.
        let mut position = StreamPosition::new(std::time::SystemTime::now());
        let hosting = crate::harness::Hosting::default();
        let set_up = {
            let macro_api = config.macro_api.clone();
            let settings = config.teammates.clone();
            let credentials = credentials.clone();
            move || host_teammates(&macro_api, &settings, &credentials)
        };
        // Set up now, so the first dial can list teammates; a failure (say,
        // another macrod writing the same file) is retried in the background.
        let hosting_retry = set_up_hosting(&hosting, set_up);
        let runtime = Runtime::start(
            &config.macro_api,
            &credentials,
            config.harness.clone(),
            &config.workspace.path,
            tap,
            turns.clone(),
            adopted,
            handoffs,
            computer,
            hosting.clone(),
        );
        let runtime_connected = runtime.connection_state();
        let agents_changed = runtime.agents_changed();
        let presence_watch = AbortOnDropHandle::new(tokio::spawn(watch_presence(
            EventStreamClient::new(&config.macro_api, &credentials),
            runtime_connected.clone(),
        )));
        let executor = Dispatcher::new(api, runtime, config.workspace.clone());
        #[cfg(unix)]
        let executor = executor.with_workspaces(workspaces);
        #[cfg(unix)]
        let executor = match herdr {
            Some(hub) => executor.with_herdr(hub),
            None => executor,
        };

        tracing::info!(
            api = %config.macro_api.api_url,
            storage = %config.macro_api.storage_url,
            harness_id = %credentials.harness_id,
            harness = %config.harness.command,
            workspace = %config.workspace.path.display(),
            "daemon listening for agent triggers over SSE"
        );

        let shutdown = cancel.clone();
        let (health, trigger_stream) = watch::channel(TriggerStreamHealth::Connecting);
        let task = tokio::spawn(async move {
            // Retried for as long as the daemon serves.
            let _hosting_retry = hosting_retry;
            let mut delays = reconnect_delays();
            let mut attempt: u32 = 0;
            loop {
                if shutdown.is_cancelled() {
                    return Ok(());
                }
                match serve_once(
                    &client,
                    &executor,
                    &shutdown,
                    &agents_changed,
                    &mut position,
                    &health,
                    &hosting,
                )
                .await
                {
                    ServeOutcome::Stopped => return Ok(()),
                    ServeOutcome::Idle => {
                        delays.reset();
                        attempt = 0;
                        health.send_if_modified(TriggerStreamHealth::reopening);
                    }
                    ServeOutcome::Ended { error, lasted } => {
                        if error
                            .downcast_current_context::<crate::outbound::stream::CredentialsRefused>()
                            .is_some_and(crate::outbound::stream::CredentialsRefused::revoked)
                        {
                            crate::harness::credentials_refused(
                                hosting.current().as_ref(),
                                crate::harness::CredentialPath::Stream,
                            );
                        }
                        tracing::warn!(error = ?error, "event stream ended; reconnecting");
                        let delay = reconnect_delay(lasted, &mut delays, &mut attempt);
                        health.send_replace(TriggerStreamHealth::Reconnecting {
                            attempt,
                            last_error: error.to_string(),
                        });
                        tokio::select! {
                            () = shutdown.cancelled() => return Ok(()),
                            () = tokio::time::sleep(delay) => {}
                        }
                    }
                }
            }
        });

        Ok(Self {
            cancel,
            task,
            turns,
            handoff,
            runtime_connected,
            trigger_stream,
            _presence_watch: presence_watch,
        })
    }

    /// What the agent-trigger stream is doing, updated as it changes.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the control panel's health display reads it next")
    )]
    pub fn trigger_stream_health(&self) -> watch::Receiver<TriggerStreamHealth> {
        self.trigger_stream.clone()
    }

    /// Whether this daemon currently holds a runtime connection.
    pub fn runtime_connected(&self) -> bool {
        *self.runtime_connected.borrow()
    }

    /// Whether the serving task is still alive.
    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    /// Whether no agent turn is running.
    pub fn is_idle(&self) -> bool {
        self.turns.is_idle()
    }

    /// Stop serving but keep the agent process running, handing it back so
    /// the next process image can relay it. `None` when no agent is running
    /// or it could not be detached in time; the agent is then stopped.
    #[cfg(unix)]
    pub async fn hand_off(self) -> Option<InheritedAgent> {
        let (reply, handed) = tokio::sync::oneshot::channel();
        let asked = self.handoff.sender.send(reply).await.is_ok();
        let agent = if asked {
            tokio::time::timeout(HANDOFF_TIMEOUT, handed)
                .await
                .ok()
                .and_then(Result::ok)
                .flatten()
        } else {
            None
        };
        self.stop().await;
        agent
    }

    /// Stop serving without waiting for an in-flight network request or trigger.
    ///
    /// Dropping the dispatcher also stops its runtime supervisor, WebSocket,
    /// and harness process, including when the daemon is restarted to re-pair.
    pub async fn stop(self) {
        self.cancel.cancel();
        self.task.abort();
        let _ = self.task.await;
        tracing::info!("daemon stopped");
    }
}

/// Compare a held runtime connection with what the service reports.
///
/// The service reading this harness as offline makes the app treat its agents as
/// unavailable, and nothing else on this machine would notice: the socket is
/// healthy. Warns once per disagreement; the check itself lets the service log
/// each one for its monitor.
async fn watch_presence(client: EventStreamClient, mut runtime: watch::Receiver<bool>) {
    let mut ticker = tokio::time::interval(PRESENCE_CHECK_EVERY);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut disagreeing = false;
    loop {
        ticker.tick().await;

        if !runtime_held_since_last_look(&mut runtime) {
            disagreeing = false;
            continue;
        }

        match client.service_reports_connected().await {
            Ok(false) if !disagreeing => {
                disagreeing = true;
                tracing::warn!("macrod holds a runtime connection the service reports as offline");
            }
            Ok(true) if disagreeing => {
                disagreeing = false;
                tracing::info!("the service reports this harness connected again");
            }
            Ok(_) => {}
            Err(error) => tracing::debug!(error = %error, "could not check harness presence"),
        }
    }
}

/// Whether the runtime has stayed connected since this was last asked. A fresh
/// dial does not count yet: the service's record of it may still be landing.
fn runtime_held_since_last_look(runtime: &mut watch::Receiver<bool>) -> bool {
    let redialed = runtime.has_changed().unwrap_or(true);
    let connected = *runtime.borrow_and_update();
    connected && !redialed
}

/// Relay an inherited agent instead of spawning one, continuing its turns.
#[cfg(unix)]
fn adopt(inherited: Option<InheritedAgent>, turns: &ActiveTurns) -> Option<RunningAgent> {
    let agent = inherited?;
    match RunningAgent::adopt(agent, turns) {
        Ok(agent) => Some(agent),
        Err(error) => {
            tracing::warn!(error = %error, "could not relay the inherited agent; starting a new one");
            None
        }
    }
}

#[cfg(not(unix))]
fn adopt(inherited: Option<InheritedAgent>, _turns: &ActiveTurns) -> Option<RunningAgent> {
    inherited.map(|never| match never {})
}

/// Inside herdr, the directory macrod was started from is the repository
/// every session works in, and each session gets a herdr window.
#[cfg(unix)]
fn start_herdr(config: &mut Config, credentials: &HarnessCredentials) -> Option<crate::herdr::Hub> {
    use crate::herdr::HcBinMissing;
    let herdr = crate::herdr::HerdrSession::detect();
    let drives_herdr = crate::herdr::drives_herdr(&config.harness);
    // A herdr-core terminal without `HC_BIN` is still inside herdr: only its
    // windows are lost.
    if !drives_herdr && !matches!(herdr, Ok(None)) {
        match std::env::current_dir() {
            Ok(cwd) => config.workspace.path = cwd,
            Err(error) => tracing::warn!(error = %error, "could not read the working directory"),
        }
    }
    let herdr = match herdr {
        Ok(herdr) => herdr?,
        // A `macrod herdr-acp` harness fails startup with this error itself.
        Err(HcBinMissing) if drives_herdr => return None,
        Err(error) => {
            tracing::error!(error = %error, "herdr-core detected but its windows cannot open");
            return None;
        }
    };
    if drives_herdr {
        tracing::info!("herdr detected; the harness opens a herdr window per session");
        return None;
    }
    let api = HarnessApi::new(&config.macro_api, credentials);
    match crate::herdr::Hub::start(
        &herdr,
        api,
        &config.workspace.path,
        &config.macro_api.web_url,
    ) {
        Ok(hub) => Some(hub),
        Err(error) => {
            tracing::warn!(error = %error, "herdr detected but its window socket could not start");
            None
        }
    }
}

/// The event stream's reconnect delays: 250 ms, doubling to 30 s.
fn reconnect_delays() -> RetryDelays {
    RetryDelays::new(Duration::from_millis(250), Duration::from_secs(30))
}

/// A stream open this long was healthy: it reopens at the first delay, so a
/// stall reopens within the service's two-minute replay retention. One that
/// ends sooner (the service closing it at once, say on a failed access
/// check) keeps backing off.
const HEALTHY_STREAM: Duration = Duration::from_secs(10);

/// The delay before reopening a stream that was open for `lasted` (`None`
/// when it never opened), counting `attempt` from 1 since the last healthy
/// stream.
fn reconnect_delay(
    lasted: Option<Duration>,
    delays: &mut RetryDelays,
    attempt: &mut u32,
) -> Duration {
    if lasted.is_some_and(|lasted| lasted >= HEALTHY_STREAM) {
        delays.reset();
        *attempt = 0;
    }
    *attempt = attempt.saturating_add(1);
    delays.next_delay()
}

enum ServeOutcome {
    Stopped,
    Idle,
    Ended {
        error: rootcause::Report,
        /// How long the stream was open, `None` when it never opened.
        lasted: Option<Duration>,
    },
}

/// Open the stream (or wait for bound agents) until it ends or is cancelled.
///
/// The stream resumes after `position`'s cursor, which advances past every
/// event it delivers, so reopening it for a changed agent set or after an
/// error replays what was published in between; `position` drops repeats.
/// A stream from a service that heartbeats ends as stalled after missed
/// heartbeats (`EventStream::next_event`), and reopens the same way.
async fn serve_once<Executor: crate::trigger::WorkExecutor>(
    client: &EventStreamClient,
    executor: &Executor,
    cancel: &CancellationToken,
    agents_changed: &Notify,
    position: &mut StreamPosition,
    health: &watch::Sender<TriggerStreamHealth>,
    hosting: &crate::harness::Hosting,
) -> ServeOutcome {
    let read_at = std::time::SystemTime::now();
    let bots = match client.bound_agents().await {
        Ok(agents) => {
            // Any accepted harness call ends a refusal and runs again what
            // it stopped, whether or not the runtime connection redials.
            crate::harness::credentials_accepted(
                hosting.current().as_ref(),
                crate::harness::CredentialPath::Stream,
            );
            position.agents_read(&agents.bot_ids, agents.read_by.unwrap_or(read_at));
            agents.bot_ids
        }
        Err(error) => {
            return ServeOutcome::Ended {
                error,
                lasted: None,
            };
        }
    };
    if bots.is_empty() {
        health.send_replace(TriggerStreamHealth::NoAgentsBound);
        tracing::info!("no agents are bound; waiting for one before opening the event stream");
        tokio::select! {
            () = cancel.cancelled() => return ServeOutcome::Stopped,
            () = agents_changed.notified() => return ServeOutcome::Idle,
            () = tokio::time::sleep(BOUND_AGENT_REFRESH) => return ServeOutcome::Idle,
        }
    }

    health.send_if_modified(TriggerStreamHealth::agents_bound);
    let filters = trigger_filters(bots.iter());
    let resume = position.resume_cursor();
    let mut stream = match client
        .connect::<TriggerEvent>(&filters, Some(resume.as_str()))
        .await
    {
        Ok(stream) => stream,
        Err(error) => {
            return ServeOutcome::Ended {
                error,
                lasted: None,
            };
        }
    };
    let opened = tokio::time::Instant::now();
    let ended = |error| ServeOutcome::Ended {
        error,
        lasted: Some(opened.elapsed()),
    };
    position.opened();
    let verified = stream.heartbeat_interval().is_some();
    health.send_replace(TriggerStreamHealth::Live {
        verified,
        last_signal: tokio::time::Instant::now(),
    });
    tracing::info!(
        bound_agents = bots.len(),
        heartbeats = verified,
        "connected to the agent-trigger event stream"
    );

    // An interval, not a sleep made afresh each turn: a busy stream would
    // otherwise push the refresh back forever, and it is how a removed
    // machine learns its credentials are refused.
    let mut refresh = tokio::time::interval_at(
        tokio::time::Instant::now() + BOUND_AGENT_REFRESH,
        BOUND_AGENT_REFRESH,
    );
    refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = cancel.cancelled() => return ServeOutcome::Stopped,
            () = agents_changed.notified() => {
                match bound_agents_changed(client, &bots, position, hosting).await {
                    Ok(false) => {}
                    Ok(true) => return ServeOutcome::Idle,
                    Err(error) => return ended(error),
                }
            }
            _ = refresh.tick() => {
                match bound_agents_changed(client, &bots, position, hosting).await {
                    Ok(false) => {}
                    Ok(true) => return ServeOutcome::Idle,
                    Err(error) => return ended(error),
                }
            }
            next = stream.next_event() => {
                if let Some(id) = stream.last_event_id() {
                    position.delivered(id);
                }
                if let Ok(Some(_)) = next {
                    health.send_replace(TriggerStreamHealth::Live {
                        verified,
                        last_signal: tokio::time::Instant::now(),
                    });
                }
                match next {
                    Ok(Some(StreamNext::Event(event))) => {
                        if position.admits(&event) {
                            let _ = handle_event(event, executor).await;
                        }
                    }
                    Ok(Some(StreamNext::Heartbeat)) => {}
                    Ok(None) => return ended(rootcause::report!("the server closed the stream")),
                    Err(error) => return ended(error),
                }
            }
        }
    }
}

/// Re-read the bound agents: `Ok(true)` when they are no longer `bots`, so
/// the stream reopens for the new set, and `Err` when the service refuses the
/// credentials. When they cannot be read otherwise, the stream is kept.
async fn bound_agents_changed(
    client: &EventStreamClient,
    bots: &[String],
    position: &mut StreamPosition,
    hosting: &crate::harness::Hosting,
) -> Result<bool, rootcause::Report> {
    let read_at = std::time::SystemTime::now();
    let latest = client.bound_agents().await;
    if latest.is_ok() {
        crate::harness::credentials_accepted(
            hosting.current().as_ref(),
            crate::harness::CredentialPath::Stream,
        );
    }
    match latest {
        Ok(latest) if latest.bot_ids == bots => {
            position.agents_read(&latest.bot_ids, latest.read_by.unwrap_or(read_at));
            Ok(false)
        }
        Ok(_) => {
            tracing::info!("bound-agent set changed; reconnecting the event stream");
            Ok(true)
        }
        // The harness was removed or its token revoked: the service checks
        // credentials only when a stream opens, so stop reading this one.
        Err(error)
            if error
                .downcast_current_context::<crate::outbound::stream::CredentialsRefused>()
                .is_some() =>
        {
            Err(error)
        }
        // The stream itself is fine: keep reading it and look again on the
        // next refresh.
        Err(error) => {
            tracing::warn!(error = ?error, "could not re-read the bound agents; keeping the event stream");
            Ok(false)
        }
    }
}
