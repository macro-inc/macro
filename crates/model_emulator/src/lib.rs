//! A scripted stand-in for the model behind Macro's assistant.
//!
//! [`ModelEmulator::start`] listens on a `127.0.0.1` port and serves:
//!
//! - the Gemini GenerateContent API under [`ModelEmulator::base_url`]
//!   (`POST /v1beta/models/<model>:streamGenerateContent` as server-sent
//!   events, and `:generateContent`), which is what the agent's model router
//!   calls for the model a new account's conversations run on;
//! - a control API under `/_emulator/`, mirrored by the methods of
//!   [`ModelEmulator`]: set and remove scripts, and read back the requests
//!   that were received.
//!
//! No model runs. A request whose last user message carries
//! `[[script:<name>]]` is answered the next [`Reply`] of that [`Script`]:
//! text, tool calls, or both. Every other request, and every request that
//! offers no tools, is answered [`DEFAULT_REPLY`].
//!
//! A running service reaches it through the
//! `OVERRIDE_GOOGLE_GENERATIVE_AI_API_URL` service URL override. Nothing here
//! talks to a model provider.

#![deny(missing_docs)]

mod routes;
mod script;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

pub use script::{DEFAULT_REPLY, Reply, Script, ScriptError, ScriptName, ToolCall};

use crate::script::StoredScript;

/// How many received requests are kept; older ones are forgotten.
const KEPT_REQUESTS: usize = 500;

/// The emulator could not listen on its address.
#[derive(Debug, thiserror::Error)]
#[error("the model emulator could not listen: {0}")]
pub struct StartError(#[from] std::io::Error);

/// A request the emulator answered.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReceivedRequest {
    /// The model the request's path names.
    pub model: String,
    /// The script the request named, when it named one and offered tools.
    pub script: Option<ScriptName>,
    /// Which of the script's replies answered it, counted from zero.
    pub reply: Option<usize>,
    /// The request's JSON body.
    pub body: Value,
}

#[derive(Default)]
struct State {
    scripts: BTreeMap<ScriptName, StoredScript>,
    requests: VecDeque<ReceivedRequest>,
}

struct Inner {
    state: Mutex<State>,
    base_url: String,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

/// A running emulator. Clones share it.
#[derive(Clone)]
pub struct ModelEmulator {
    inner: Arc<Inner>,
}

impl ModelEmulator {
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
                tracing::error!(error = ?error, "model emulator server stopped");
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

    /// The emulator's origin, `http://127.0.0.1:<port>`: what the Gemini
    /// client takes as its base URL.
    pub fn base_url(&self) -> String {
        self.inner.base_url.clone()
    }

    /// Sets the script requests naming `name` are answered from, replacing
    /// one of the same name.
    pub fn set_script(&self, name: ScriptName, script: Script) -> Result<(), ScriptError> {
        let stored = StoredScript::try_from(script)?;
        self.state().scripts.insert(name, stored);
        Ok(())
    }

    /// Forgets the script; requests naming it are answered
    /// [`DEFAULT_REPLY`] again.
    pub fn remove_script(&self, name: &ScriptName) {
        self.state().scripts.remove(name);
    }

    /// The requests received, oldest first; with `script`, only those that
    /// named it.
    pub fn requests(&self, script: Option<&ScriptName>) -> Vec<ReceivedRequest> {
        self.state()
            .requests
            .iter()
            .filter(|request| script.is_none() || request.script.as_ref() == script)
            .cloned()
            .collect()
    }

    /// Forgets the requests received so far.
    pub fn clear_requests(&self) {
        self.state().requests.clear();
    }

    /// Records the request and answers what the model says to it.
    fn answer(&self, model: String, body: Value) -> Reply {
        let place = script::place(&body);
        let mut state = self.state();
        let reply = place
            .as_ref()
            .and_then(|place| state.scripts.get(&place.script)?.reply(place.reply, &body));

        if state.requests.len() == KEPT_REQUESTS {
            state.requests.pop_front();
        }
        state.requests.push_back(ReceivedRequest {
            model,
            script: place.as_ref().map(|place| place.script.clone()),
            reply: reply.as_ref().and(place.map(|place| place.reply)),
            body,
        });

        reply.unwrap_or_else(|| Reply {
            text: Some(DEFAULT_REPLY.to_owned()),
            calls: Vec::new(),
        })
    }

    /// The state; a handler that panicked holding it changed nothing halfway.
    fn state(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}
