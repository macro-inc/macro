//! The serving core, packaged so it can be started, stopped, and restarted.
//!
//! The control panel owns exactly one of these, restarting it when the
//! credential changes (a re-pair) and stopping it when the harness is
//! removed - which is what makes the TUI and the daemon one process.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use rootcause::prelude::ResultExt as _;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::dispatch::Dispatcher;
use crate::outbound::agent_session::HarnessApi;
use crate::outbound::credentials::HarnessCredentials;
use crate::outbound::registration::FeedReconciler;
use crate::runtime::Runtime;
use crate::webhook::{WebhookState, webhook_router};

/// How often the bound-agent set is re-read and the feed reconciled to it, so
/// a newly bound agent starts triggering without a restart. Short on purpose:
/// a mention sent before the feed covers the new agent is dropped for good,
/// so this interval is the worst-case window where a brand-new agent is deaf.
const FEED_RECONCILE_INTERVAL: Duration = Duration::from_secs(10);

/// A running serving core: webhook receiver, feed reconciler, harness bridge.
pub struct Daemon {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<rootcause::Result<()>>,
}

impl Daemon {
    /// Bind the webhook server and start serving in background tasks.
    ///
    /// Returns once the listener is bound (so a failed bind is an immediate
    /// error, not a background log line); the serving itself runs until
    /// [`Daemon::stop`] or the task fails.
    pub async fn start(
        config: Config,
        credentials: HarnessCredentials,
        config_path: &Path,
    ) -> rootcause::Result<Self> {
        // The ACP launch config carries command, args, and env but no working
        // directory, and every session this daemon serves runs in the one
        // configured workspace - so the daemon's own cwd is the harness's cwd.
        std::env::set_current_dir(&config.workspace.path).context(format!(
            "failed to enter the workspace directory {}",
            config.workspace.path.display()
        ))?;

        let cancel = CancellationToken::new();

        // The feed: make sure one exists, points here, covers the bound
        // agents, and we hold its secret. An explicit config secret skips
        // registration entirely (manual setups).
        let reconciler = Arc::new(FeedReconciler::new(
            &config.macro_api,
            &config.server,
            credentials.clone(),
            config_path,
        ));
        let signing_secret = Arc::new(std::sync::RwLock::new(String::new()));
        match &config.server.signing_secret {
            Some(secret) => {
                *signing_secret.write().expect("signing secret lock") = secret.clone();
            }
            None => {
                // `None` is a daemon with nothing bound yet: it serves anyway,
                // and the reconcile loop registers the feed the moment an
                // agent is bound in the app.
                let initial = reconciler
                    .ensure_feed()
                    .await
                    .context("failed to register this harness's trigger feed")?;
                if let Some(feed) = &initial {
                    *signing_secret.write().expect("signing secret lock") =
                        feed.signing_secret.clone();
                }
                // Validation probes the endpoint, so it can only pass once we
                // serve; request it from the side once the listener is up,
                // and keep the feed covering the bound-agent set from then on.
                let reconciler = Arc::clone(&reconciler);
                let signing_secret = Arc::clone(&signing_secret);
                let cancel = cancel.clone();
                tokio::spawn(async move {
                    let mut current = None;
                    if let Some(feed) = initial {
                        if !feed.is_valid {
                            reconciler.request_validation(&feed.webhook_id).await;
                        }
                        current = Some(feed.webhook_id);
                    }
                    tokio::select! {
                        () = reconcile_forever(reconciler, signing_secret, current) => {}
                        () = cancel.cancelled() => {}
                    }
                });
            }
        }

        let api = HarnessApi::new(&config.macro_api, &credentials);
        let runtime = Runtime::new(&config.macro_api, &credentials, config.harness.clone());
        let app = webhook_router(WebhookState {
            executor: Dispatcher::new(api, runtime, config.workspace.clone()),
            signing_secret: Arc::clone(&signing_secret),
        });

        let port = config.server.port;
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
            .await
            .context(format!(
                "failed to bind the webhook server to port {port} - is another macrod \
                 (a separate `macrod` serve, or another tui) already running?"
            ))?;
        tracing::info!(
            port,
            pid = std::process::id(),
            api = %config.macro_api.api_url,
            harness_id = %credentials.harness_id,
            harness = %config.harness.command,
            workspace = %config.workspace.path.display(),
            "daemon listening for agent triggers"
        );

        let shutdown = cancel.clone();
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move { shutdown.cancelled().await })
                .await
                .context("the webhook server stopped")?;
            Ok(())
        });

        Ok(Self { cancel, task })
    }

    /// Whether the serving task is still alive.
    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    /// Stop serving: unbind the webhook port and end the reconcile loop.
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

/// Keep the feed covering the bound-agent set: registered once anything is
/// bound, replaced (along with the secret the receiver verifies with) when
/// the set or endpoint changes, and dropped when nothing is bound any more.
async fn reconcile_forever(
    reconciler: Arc<FeedReconciler>,
    signing_secret: Arc<std::sync::RwLock<String>>,
    mut current_webhook_id: Option<String>,
) {
    loop {
        tokio::time::sleep(FEED_RECONCILE_INTERVAL).await;
        match reconciler.ensure_feed().await {
            Ok(Some(feed)) => {
                if current_webhook_id.as_deref() != Some(feed.webhook_id.as_str()) {
                    tracing::info!(webhook_id = %feed.webhook_id, "trigger feed registered");
                    *signing_secret.write().expect("signing secret lock") =
                        feed.signing_secret.clone();
                    if !feed.is_valid {
                        reconciler.request_validation(&feed.webhook_id).await;
                    }
                    current_webhook_id = Some(feed.webhook_id);
                }
            }
            Ok(None) => {
                if current_webhook_id.take().is_some() {
                    // Drop the secret with the feed: retaining it would keep
                    // verifying deliveries signed for a webhook the server has
                    // already deleted. Empty fails closed (see
                    // `webhook_signature::verify`), which is correct while
                    // nothing is bound to serve.
                    signing_secret.write().expect("signing secret lock").clear();
                    tracing::info!("trigger feed removed; no agents are bound any more");
                }
            }
            Err(error) => {
                tracing::warn!(error = ?error, "trigger feed reconciliation failed; will retry");
            }
        }
    }
}
