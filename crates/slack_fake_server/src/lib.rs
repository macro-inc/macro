//! An in-process fake Slack for tests: the Web API, the sign-in endpoints,
//! the edge API's user cache, file upload and download, and the web client's
//! websocket, all on one `127.0.0.1` port.
//!
//! [`FakeSlack::start`] serves every Slack host at [`FakeSlack::base_url`]:
//! point `slack_client`'s endpoints and workspace URL there and its websocket
//! at [`FakeSlack::websocket_url`]. Seed workspaces, users, sessions and
//! conversations with plain JSON (the fake stores Slack's own shapes), then
//! drive it: messages sent through the API are pushed to members' sockets,
//! [`FakeSlack::push_event`] sends anything, and [`FakeSlack::end_session`]
//! revokes a token. Nothing here talks to Slack.

#![deny(missing_docs)]

mod login;
mod routes;
mod state;
mod web_api;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

pub use state::{LoginAccount, LoginCaptcha, LoginMagic, LoginWorkspace, RecordedCall};

use crate::state::{Conversation, Injected, Session, SocketCommand, State};

/// State shared by the HTTP handlers and the test.
pub(crate) struct Shared {
    state: Mutex<State>,
    /// Bumped on every change, so tests can wait for conditions.
    generation: watch::Sender<u64>,
    pub(crate) tasks: TaskTracker,
    pub(crate) cancel: CancellationToken,
}

impl Shared {
    pub(crate) fn lock(&self) -> MutexGuard<'_, State> {
        // Mutations are a few map operations; a panic in one leaves the maps
        // usable.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn changed(&self) {
        self.generation.send_modify(|generation| *generation += 1);
    }
}

/// A running fake Slack. Stops when dropped.
pub struct FakeSlack {
    shared: Arc<Shared>,
    base_url: String,
}

impl Drop for FakeSlack {
    fn drop(&mut self) {
        self.shared.cancel.cancel();
    }
}

impl FakeSlack {
    /// Starts the fake on a free local port.
    pub async fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let base_url = format!("http://{address}/");
        let (generation, _) = watch::channel(0);
        let shared = Arc::new(Shared {
            state: Mutex::new(State::new(base_url.clone())),
            generation,
            tasks: TaskTracker::new(),
            cancel: CancellationToken::new(),
        });
        let router = routes::router(shared.clone());
        let cancel = shared.cancel.clone();
        shared.tasks.spawn(async move {
            let served = axum::serve(listener, router)
                .with_graceful_shutdown(async move { cancel.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::warn!(error = %error, "fake slack stopped serving");
            }
        });
        Ok(Self { shared, base_url })
    }

    /// `http://127.0.0.1:<port>/`: every Slack host and the workspace URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// `ws://127.0.0.1:<port>/websocket/`.
    pub fn websocket_url(&self) -> String {
        format!(
            "{}websocket/",
            self.base_url.replacen("http://", "ws://", 1)
        )
    }

    /// Adds a workspace (`team.info` shape; needs `id`).
    pub fn add_team(&self, team: Value) {
        let Some(id) = team.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        self.shared.lock().teams.insert(id, team);
        self.shared.changed();
    }

    /// Adds a user (`users.info` shape; needs `id` and `team_id`).
    pub fn add_user(&self, user: Value) {
        let Some(id) = user.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        self.shared.lock().users.insert(id, user);
        self.shared.changed();
    }

    /// Adds a signed-in session for `user_id`: its `xoxc-` token and the
    /// decoded `d` cookie every request must carry.
    pub fn add_session(&self, user_id: &str, token: &str, cookie: &str) {
        let mut state = self.shared.lock();
        let team_id = state.user_team(user_id).unwrap_or_default();
        state.sessions.insert(
            token.to_owned(),
            Session {
                user_id: user_id.to_owned(),
                team_id,
                cookie: cookie.to_owned(),
                ended: None,
            },
        );
        drop(state);
        self.shared.changed();
    }

    /// Adds a conversation (`conversations.info` shape; needs `id`) with its
    /// members.
    pub fn add_conversation(&self, info: Value, members: &[&str]) {
        let Some(id) = info.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        self.shared.lock().conversations.insert(
            id,
            Conversation {
                info,
                members: members.iter().map(|member| (*member).to_owned()).collect(),
                messages: Vec::new(),
                last_read: Default::default(),
            },
        );
        self.shared.changed();
    }

    /// Adds a custom emoji.
    pub fn add_emoji(&self, name: &str, value: &str) {
        self.shared
            .lock()
            .emoji
            .insert(name.to_owned(), value.to_owned());
        self.shared.changed();
    }

    /// Adds a sign-in account.
    pub fn add_login_account(&self, account: LoginAccount) {
        self.shared.lock().login_accounts.push(account);
        self.shared.changed();
    }

    /// Stores a message from someone else (a `message` object; `ts` is
    /// assigned when missing), and pushes it to members' sockets. Returns its
    /// `ts`.
    pub fn receive_message(&self, channel: &str, mut message: Value) -> String {
        let mut state = self.shared.lock();
        let ts = match message.get("ts").and_then(Value::as_str) {
            Some(ts) => ts.to_owned(),
            None => state.next_ts(),
        };
        if let Some(object) = message.as_object_mut() {
            object.insert("type".to_owned(), Value::from("message"));
            object.insert("ts".to_owned(), Value::from(ts.clone()));
        }
        web_api::add_message(&mut state, channel, message);
        drop(state);
        self.shared.changed();
        ts
    }

    /// Sends a raw event to every socket of `user_id`.
    pub fn push_event(&self, user_id: &str, event: Value) {
        self.shared.lock().push_to_user(user_id, &event);
        self.shared.changed();
    }

    /// Ends a session: every call with `token` answers `code` (for example
    /// `token_revoked`), and its sockets close and can't reconnect.
    pub fn end_session(&self, token: &str, code: &str) {
        let mut state = self.shared.lock();
        let Some(session) = state.sessions.get_mut(token) else {
            return;
        };
        session.ended = Some(code.to_owned());
        let user_id = session.user_id.clone();
        state.sockets.retain(|socket| {
            if socket.user_id == user_id {
                let _ = socket.commands.send(SocketCommand::Close);
                false
            } else {
                true
            }
        });
        drop(state);
        self.shared.changed();
    }

    /// Makes the next call of `method` answer `ok: false` with `code`.
    pub fn fail_next(&self, method: &str, code: &str) {
        self.shared
            .lock()
            .injected
            .insert(method.to_owned(), Injected::Error(code.to_owned()));
    }

    /// Makes the next call of `method` answer HTTP 429 with `Retry-After`.
    pub fn rate_limit_next(&self, method: &str, retry_after: Duration) {
        self.shared.lock().injected.insert(
            method.to_owned(),
            Injected::RateLimited {
                retry_after_seconds: retry_after.as_secs(),
            },
        );
    }

    /// Sends `goodbye` on every socket (Slack's "reconnect now").
    pub fn goodbye(&self) {
        let mut state = self.shared.lock();
        state
            .sockets
            .retain(|socket| socket.commands.send(SocketCommand::Goodbye).is_ok());
    }

    /// Drops every socket without a goodbye.
    pub fn drop_sockets(&self) {
        let mut state = self.shared.lock();
        for socket in state.sockets.drain(..) {
            let _ = socket.commands.send(SocketCommand::Close);
        }
    }

    /// Answers websocket handshakes with HTTP 401 while `reject` is true.
    pub fn reject_sockets(&self, reject: bool) {
        self.shared.lock().reject_sockets = reject;
    }

    /// Web API calls received so far, oldest first.
    pub fn calls(&self) -> Vec<RecordedCall> {
        self.shared.lock().calls.clone()
    }

    /// Calls of one method.
    pub fn calls_of(&self, method: &str) -> Vec<RecordedCall> {
        self.calls()
            .into_iter()
            .filter(|call| call.method == method)
            .collect()
    }

    /// A conversation's stored messages, oldest first (replies included).
    pub fn messages(&self, channel: &str) -> Vec<Value> {
        self.shared
            .lock()
            .conversations
            .get(channel)
            .map(|conversation| conversation.messages.clone())
            .unwrap_or_default()
    }

    /// An uploaded file's bytes.
    pub fn file_bytes(&self, file_id: &str) -> Option<Vec<u8>> {
        self.shared
            .lock()
            .files
            .get(file_id)
            .map(|file| file.bytes.clone())
    }

    /// Websocket connections accepted so far.
    pub fn socket_connections(&self) -> u64 {
        self.shared.lock().socket_connections
    }

    /// Waits until at least `count` websocket connections were accepted
    /// (connected and greeted with `hello`), or `timeout` passes.
    pub async fn wait_for_socket_connections(&self, count: u64, timeout: Duration) -> bool {
        self.wait_for(timeout, |state| state.socket_connections >= count)
            .await
    }

    /// Waits until `method` was called at least `count` times.
    pub async fn wait_for_calls(&self, method: &str, count: usize, timeout: Duration) -> bool {
        self.wait_for(timeout, |state| {
            state
                .calls
                .iter()
                .filter(|call| call.method == method)
                .count()
                >= count
        })
        .await
    }

    async fn wait_for(&self, timeout: Duration, check: impl Fn(&State) -> bool) -> bool {
        let mut generation = self.shared.generation.subscribe();
        let waited = tokio::time::timeout(timeout, async {
            loop {
                if check(&self.shared.lock()) {
                    return;
                }
                if generation.changed().await.is_err() {
                    return;
                }
            }
        })
        .await;
        waited.is_ok() && check(&self.shared.lock())
    }
}
