//! A scripted stand-in for CapSolver's task API.
//!
//! [`CapsolverEmulator::start`] listens on a `127.0.0.1` port and serves:
//!
//! - `POST /createTask` and `POST /getTaskResult` in CapSolver's shapes, for
//!   the token task types the agent harness's CAPTCHA gateway sends;
//! - a control API under `/_emulator/`, mirrored by the methods of
//!   [`CapsolverEmulator`]: script a site key's [`Outcome`] and read back the
//!   tasks that were created.
//!
//! No CAPTCHA is solved. A task is answered the [`Outcome`] scripted for its
//! `websiteKey`, [`Outcome::Ready`] when none is.
//!
//! A running service reaches it through the `OVERRIDE_CAPSOLVER_API_URL`
//! service URL override. Nothing here talks to CapSolver.

#![deny(missing_docs)]

mod routes;
#[cfg(test)]
mod test;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// How many created tasks are kept; older ones are forgotten.
const KEPT_TASKS: usize = 500;

/// The emulator could not listen on its address.
#[derive(Debug, thiserror::Error)]
#[error("the CapSolver emulator could not listen: {0}")]
pub struct StartError(#[from] std::io::Error);

/// What the emulator answers for a site key's tasks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum Outcome {
    /// The first `getTaskResult` is `ready` with a token.
    #[default]
    Ready,
    /// `processing` for `polls` results, then `ready`.
    ProcessingThenReady {
        /// How many results say `processing` first.
        polls: u32,
    },
    /// `processing` forever.
    Processing,
    /// `getTaskResult` fails with `ERROR_CAPTCHA_UNSOLVABLE`.
    Unsolvable,
    /// `getTaskResult` fails with `ERROR_TASK_TIMEOUT`.
    Timeout,
    /// `createTask` fails with `ERROR_RATE_LIMIT`.
    RateLimited,
    /// `createTask` fails with `ERROR_ZERO_BALANCE`.
    ZeroBalance,
}

/// A `createTask` request the emulator received.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTask {
    /// Whether it carried a non-empty `clientKey`. The key itself is never
    /// kept: it may be a real CapSolver key.
    pub client_key_sent: bool,
    /// Its `task` object, as sent.
    pub task: Value,
    /// The id it was given; `None` when `createTask` failed.
    pub task_id: Option<String>,
}

/// A task `getTaskResult` can be asked about.
struct Task {
    solution: Value,
    outcome: Outcome,
    polls: u32,
}

#[derive(Default)]
struct State {
    outcomes: BTreeMap<String, Outcome>,
    tasks: BTreeMap<String, Task>,
    created: Vec<CreatedTask>,
}

struct Inner {
    state: Mutex<State>,
    base_url: String,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

/// A running emulator. Clones share it.
#[derive(Clone)]
pub struct CapsolverEmulator {
    inner: Arc<Inner>,
}

impl CapsolverEmulator {
    /// Starts an emulator on a free `127.0.0.1` port.
    pub async fn start() -> Result<Self, StartError> {
        Self::start_on(SocketAddr::from(([127, 0, 0, 1], 0))).await
    }

    /// Starts an emulator on `address`.
    pub async fn start_on(address: SocketAddr) -> Result<Self, StartError> {
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        let emulator = Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State::default()),
                base_url: format!("http://{address}"),
                cancel: CancellationToken::new(),
                tracker: TaskTracker::new(),
            }),
        };

        let app = routes::router().with_state(emulator.clone());
        let cancel = emulator.inner.cancel.clone();
        emulator.inner.tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { cancel.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "CapSolver emulator server stopped");
            }
        });

        Ok(emulator)
    }

    /// Stops the server and waits for it.
    pub async fn shutdown(self) {
        self.inner.cancel.cancel();
        self.inner.tracker.close();
        self.inner.tracker.wait().await;
    }

    /// The emulator's origin, `http://127.0.0.1:<port>`: what a CapSolver
    /// client takes as its base URL.
    pub fn base_url(&self) -> String {
        self.inner.base_url.clone()
    }

    /// Answers tasks for `site_key` with `outcome` from now on.
    pub fn set_outcome(&self, site_key: &str, outcome: Outcome) {
        self.state().outcomes.insert(site_key.to_owned(), outcome);
    }

    /// The `createTask` requests received, oldest first.
    pub fn created_tasks(&self) -> Vec<CreatedTask> {
        self.state().created.clone()
    }

    /// How many times `getTaskResult` was asked about `task_id`.
    pub fn polls(&self, task_id: &str) -> Option<u32> {
        self.state().tasks.get(task_id).map(|task| task.polls)
    }

    /// The state; a handler that panicked holding it changed nothing halfway.
    fn state(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}
