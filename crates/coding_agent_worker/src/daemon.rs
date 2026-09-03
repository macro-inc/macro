//! The serving core, packaged so it can be started, stopped, and restarted.
//!
//! The control panel owns exactly one of these, restarting it when the
//! credential changes (a re-pair) and stopping it when the harness is
//! removed - which is what makes the TUI and the daemon one process.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rootcause::prelude::ResultExt as _;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::dispatch::Dispatcher;
use crate::outbound::agent_session::HarnessApi;
use crate::outbound::credentials::HarnessCredentials;
use crate::outbound::stream::EventStreamClient;
use crate::runtime::Runtime;
use crate::trigger::{TriggerEvent, handle_event, trigger_filters};

/// How often the bound-agent set is re-read so a newly bound agent starts
/// triggering without a restart. Short on purpose: a mention sent before the
/// stream covers the new agent is dropped for good, so this interval is the
/// worst-case window where a brand-new agent is deaf.
const BOUND_AGENT_REFRESH: Duration = Duration::from_secs(10);

/// A running serving core: SSE listener, harness bridge.
pub struct Daemon {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<rootcause::Result<()>>,
}

impl Daemon {
    /// Start listening for agent triggers in a background task.
    ///
    /// Returns once the client is built; the serving itself runs until
    /// [`Daemon::stop`] or the task fails.
    pub async fn start(
        config: Config,
        credentials: HarnessCredentials,
        _config_path: &Path,
    ) -> rootcause::Result<Self> {
        // The ACP launch config carries command, args, and env but no working
        // directory, and every session this daemon serves runs in the one
        // configured workspace - so the daemon's own cwd is the harness's cwd.
        std::env::set_current_dir(&config.workspace.path).context(format!(
            "failed to enter the workspace directory {}",
            config.workspace.path.display()
        ))?;

        let cancel = CancellationToken::new();
        let client = EventStreamClient::new(&config.macro_api, &credentials);
        let api = HarnessApi::new(&config.macro_api, &credentials);
        let runtime = Runtime::new(&config.macro_api, &credentials, config.harness.clone());
        let executor = Dispatcher::new(api, runtime, config.workspace.clone());

        tracing::info!(
            api = %config.macro_api.api_url,
            storage = %config.macro_api.storage_url,
            harness_id = %credentials.harness_id,
            harness = %config.harness.command,
            workspace = %config.workspace.path.display(),
            "daemon listening for agent triggers over SSE"
        );

        let shutdown = cancel.clone();
        let task = tokio::spawn(async move {
            let mut failures = 0u32;
            loop {
                if shutdown.is_cancelled() {
                    return Ok(());
                }
                match serve_once(&client, &executor, &shutdown).await {
                    ServeOutcome::Stopped => return Ok(()),
                    ServeOutcome::Idle => {
                        failures = 0;
                    }
                    ServeOutcome::Ended(error) => {
                        tracing::warn!(error = ?error, "event stream ended; reconnecting");
                        failures = failures.saturating_add(1);
                        let delay = reconnect_delay(failures);
                        tokio::select! {
                            () = shutdown.cancelled() => return Ok(()),
                            () = tokio::time::sleep(delay) => {}
                        }
                    }
                }
            }
        });

        Ok(Self { cancel, task })
    }

    /// Whether the serving task is still alive.
    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    /// Stop serving: drop the stream and end the reconnect loop.
    ///
    /// A live harness bridge (the WebSocket + spawned harness process) is not
    /// torn down here; it dies with the process, and a restarted daemon's
    /// fresh dial displaces it at the gateway.
    pub async fn stop(self) {
        self.cancel.cancel();
        let _ = self.task.await;
        tracing::info!("daemon stopped");
    }
}

/// Absolute form of the config path, so a `chdir` into the workspace never
/// re-points relative reads and writes of the config and its state files.
pub fn absolute_config_path(config_path: &Path) -> PathBuf {
    std::path::absolute(config_path).unwrap_or_else(|_| config_path.to_owned())
}

fn reconnect_delay(failures: u32) -> Duration {
    let secs = 1u64.checked_shl(failures.min(5)).unwrap_or(30).min(30);
    Duration::from_secs(secs)
}

enum ServeOutcome {
    Stopped,
    Idle,
    Ended(rootcause::Report),
}

/// Open the stream (or wait for bound agents) until it ends or is cancelled.
async fn serve_once<Executor: crate::trigger::WorkExecutor>(
    client: &EventStreamClient,
    executor: &Executor,
    cancel: &CancellationToken,
) -> ServeOutcome {
    let bots = match client.bound_bot_ids().await {
        Ok(bots) => bots,
        Err(error) => return ServeOutcome::Ended(error),
    };
    if bots.is_empty() {
        tracing::info!("no agents are bound; waiting before opening the event stream");
        tokio::select! {
            () = cancel.cancelled() => return ServeOutcome::Stopped,
            () = tokio::time::sleep(BOUND_AGENT_REFRESH) => return ServeOutcome::Idle,
        }
    }

    let filters = trigger_filters(bots.iter());
    let mut stream = match client.connect::<TriggerEvent>(&filters).await {
        Ok(stream) => stream,
        Err(error) => return ServeOutcome::Ended(error),
    };
    tracing::info!(
        bound_agents = bots.len(),
        "connected to the agent-trigger event stream"
    );

    loop {
        tokio::select! {
            () = cancel.cancelled() => return ServeOutcome::Stopped,
            () = tokio::time::sleep(BOUND_AGENT_REFRESH) => {
                match client.bound_bot_ids().await {
                    Ok(latest) if latest == bots => {}
                    Ok(_) => {
                        tracing::info!("bound-agent set changed; reconnecting the event stream");
                        return ServeOutcome::Idle;
                    }
                    Err(error) => return ServeOutcome::Ended(error),
                }
            }
            next = stream.next_event() => {
                match next {
                    Ok(Some(event)) => {
                        let _ = handle_event(event, executor).await;
                    }
                    Ok(None) => {
                        return ServeOutcome::Ended(rootcause::report!(
                            "the server closed the stream"
                        ));
                    }
                    Err(error) => return ServeOutcome::Ended(error),
                }
            }
        }
    }
}
