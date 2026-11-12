//! The fake's world: workspaces, users, sessions, conversations, messages,
//! files, sockets, login accounts, and what tests injected or observe.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use tokio::sync::mpsc;

/// First message timestamp the fake hands out; each new one is a second later.
const FIRST_TS_SECONDS: u64 = 1_700_000_000;

/// A signed-in session.
pub(crate) struct Session {
    pub(crate) user_id: String,
    pub(crate) team_id: String,
    pub(crate) cookie: String,
    /// Set when the session ended; every call answers this error.
    pub(crate) ended: Option<String>,
}

/// A conversation and its messages, oldest first.
pub(crate) struct Conversation {
    pub(crate) info: Value,
    pub(crate) members: Vec<String>,
    pub(crate) messages: Vec<Value>,
    pub(crate) last_read: BTreeMap<String, String>,
}

/// An uploaded file.
pub(crate) struct StoredFile {
    pub(crate) info: Value,
    pub(crate) bytes: Vec<u8>,
}

/// What a connected socket is told to do.
pub(crate) enum SocketCommand {
    Send(Value),
    Goodbye,
    Close,
}

pub(crate) struct Socket {
    pub(crate) user_id: String,
    pub(crate) commands: mpsc::UnboundedSender<SocketCommand>,
}

/// A failure injected for the next call of a method.
pub(crate) enum Injected {
    Error(String),
    RateLimited { retry_after_seconds: u64 },
}

/// A Web API call the fake received, without the token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedCall {
    /// The method (`chat.postMessage`).
    pub method: String,
    /// Form fields, minus `token`.
    pub fields: BTreeMap<String, String>,
}

/// A login account: an email, its code, and its workspaces.
#[derive(Clone, Debug)]
pub struct LoginAccount {
    /// The email address.
    pub email: String,
    /// The emailed code (six characters, no dash).
    pub code: String,
    /// When set, `signup.checkEmail` demands a CAPTCHA with this site key,
    /// and `signup.confirmEmail` accepts only `captcha_solution`.
    pub captcha: Option<LoginCaptcha>,
    /// Workspaces `signin.findWorkspaces` lists.
    pub workspaces: Vec<LoginWorkspace>,
}

/// The CAPTCHA a login account demands.
#[derive(Clone, Debug)]
pub struct LoginCaptcha {
    /// Site key `auth.captcha` returns.
    pub site_key: String,
    /// The only solution accepted.
    pub solution: String,
}

/// A workspace in a login account.
#[derive(Clone, Debug)]
pub struct LoginWorkspace {
    /// Team id.
    pub team_id: String,
    /// Name.
    pub name: String,
    /// Domain.
    pub domain: String,
    /// The session handed out on sign-in; add it with `add_session` first.
    pub token: String,
    /// Its `d` cookie.
    pub cookie: String,
    /// How the magic login is offered.
    pub magic: LoginMagic,
    /// Single sign-on only.
    pub sso_required: bool,
    /// When set, sign-in needs this two-factor PIN.
    pub two_factor_pin: Option<String>,
}

/// How a workspace offers magic login.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginMagic {
    /// A magic login code exchanged at `auth.loginMagicBulk`.
    Code,
    /// A magic link that redirects to the client page holding the token.
    Link,
    /// None (needs a browser).
    None,
}

pub(crate) struct State {
    pub(crate) base_url: String,
    pub(crate) teams: BTreeMap<String, Value>,
    pub(crate) users: BTreeMap<String, Value>,
    pub(crate) sessions: BTreeMap<String, Session>,
    pub(crate) conversations: BTreeMap<String, Conversation>,
    pub(crate) files: BTreeMap<String, StoredFile>,
    pub(crate) emoji: BTreeMap<String, String>,
    pub(crate) sockets: Vec<Socket>,
    pub(crate) socket_connections: u64,
    pub(crate) reject_sockets: bool,
    pub(crate) calls: Vec<RecordedCall>,
    pub(crate) injected: BTreeMap<String, Injected>,
    pub(crate) login_accounts: Vec<LoginAccount>,
    pub(crate) next_ts: u64,
    pub(crate) next_file: u64,
}

impl State {
    pub(crate) fn new(base_url: String) -> Self {
        Self {
            base_url,
            teams: BTreeMap::new(),
            users: BTreeMap::new(),
            sessions: BTreeMap::new(),
            conversations: BTreeMap::new(),
            files: BTreeMap::new(),
            emoji: BTreeMap::new(),
            sockets: Vec::new(),
            socket_connections: 0,
            reject_sockets: false,
            calls: Vec::new(),
            injected: BTreeMap::new(),
            login_accounts: Vec::new(),
            next_ts: 0,
            next_file: 0,
        }
    }

    /// A fresh, increasing message timestamp.
    pub(crate) fn next_ts(&mut self) -> String {
        self.next_ts += 1;
        format!("{}.000100", FIRST_TS_SECONDS + self.next_ts)
    }

    /// Sends `event` to every socket of `user_id`.
    pub(crate) fn push_to_user(&mut self, user_id: &str, event: &Value) {
        self.sockets.retain(|socket| {
            socket.user_id != user_id || socket.commands.send(SocketCommand::Send(event.clone())).is_ok()
        });
    }

    /// Sends `event` to every member of `channel`.
    pub(crate) fn push_to_members(&mut self, channel: &str, event: &Value) {
        let members = self
            .conversations
            .get(channel)
            .map(|conversation| conversation.members.clone())
            .unwrap_or_default();
        for member in members {
            self.push_to_user(&member, event);
        }
    }

    /// The team a user belongs to.
    pub(crate) fn user_team(&self, user_id: &str) -> Option<String> {
        self.users
            .get(user_id)
            .and_then(|user| user.get("team_id"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    /// A conversation as the given user sees it: the stored info plus
    /// `is_member` and `last_read`.
    pub(crate) fn conversation_for(&self, channel: &str, user_id: &str) -> Option<Value> {
        let conversation = self.conversations.get(channel)?;
        let mut info = conversation.info.clone();
        if let Some(object) = info.as_object_mut() {
            object.insert("is_member".to_owned(), json!(conversation.members.iter().any(|member| member == user_id)));
            if let Some(last_read) = conversation.last_read.get(user_id) {
                object.insert("last_read".to_owned(), json!(last_read));
            }
        }
        Some(info)
    }
}
