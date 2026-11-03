//! [`MacroClient`]: the agent's own Macro account over HTTP.
//!
//! Every call authenticates with the team agent's user API key
//! (`x-macro-user-api-key`). One client holds one connection pool; clone it
//! freely, clones share the pool.

mod types;

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

pub use self::types::*;
use crate::error::{Error, Result};

#[cfg(test)]
mod test;

const API_KEY_HEADER: &str = "x-macro-user-api-key";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// The stream sends a keep-alive every 20s; three missed means it is dead.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
/// Starting a macrod session can take up to 180s.
const SESSION_CREATE_TIMEOUT: Duration = Duration::from_secs(200);
const ERROR_BODY_LIMIT: usize = 500;

/// Which Macro deployment to talk to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Environment {
    /// macro.com.
    #[default]
    Prod,
    /// dev.macro.com.
    Dev,
    /// A local stack on this machine.
    Local,
}

impl FromStr for Environment {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "prod" | "production" | "prd" => Ok(Self::Prod),
            "dev" | "development" => Ok(Self::Dev),
            "local" | "lcl" => Ok(Self::Local),
            other => Err(Error::Config(format!(
                "unknown Macro environment {other:?}; use prod, dev, or local"
            ))),
        }
    }
}

/// Base URLs of the Macro services this crate calls, without trailing slash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hosts {
    /// Document storage service: messages, channels, the event stream.
    pub storage: String,
    /// Auth service: the caller, team agent profile, agent email.
    pub auth: String,
    /// Cognition: the `decisions` (Jev) endpoint.
    pub cognition: String,
    /// Agent harness: agent sessions.
    pub agent_harness: String,
}

impl Hosts {
    /// The hosts of a deployment (mirrors `packages/sdk/src/config.ts`).
    pub fn for_env(env: Environment) -> Self {
        let gateway = |base: &str| Self {
            storage: format!("{base}/dss"),
            auth: format!("{base}/auth"),
            cognition: format!("{base}/cognition"),
            agent_harness: format!("{base}/agent-harness"),
        };
        match env {
            Environment::Prod => gateway("https://gateway.macro.com"),
            Environment::Dev => gateway("https://dev-gateway.macro.com"),
            Environment::Local => Self {
                storage: "http://localhost:8086".to_owned(),
                auth: "http://localhost:8080".to_owned(),
                cognition: "http://localhost:8101/cognition".to_owned(),
                agent_harness: "http://localhost:8101".to_owned(),
            },
        }
    }

    /// Every service at one base URL (handy for tests and proxies).
    pub fn all_at(base: &str) -> Self {
        let base = base.trim_end_matches('/');
        Self {
            storage: base.to_owned(),
            auth: base.to_owned(),
            cognition: base.to_owned(),
            agent_harness: base.to_owned(),
        }
    }
}

/// The team agent's Macro account. Cheap to clone.
#[derive(Clone)]
pub struct MacroClient {
    http: reqwest::Client,
    stream_http: reqwest::Client,
    hosts: Arc<Hosts>,
    api_key: Arc<str>,
}

impl fmt::Debug for MacroClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MacroClient")
            .field("hosts", &self.hosts)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl MacroClient {
    /// A client for this API key and these hosts.
    pub fn new(api_key: impl Into<String>, hosts: Hosts) -> Result<Self> {
        let api_key: String = api_key.into();
        if api_key.trim().is_empty() {
            return Err(Error::Config("the Macro API key is empty".to_owned()));
        }
        let build = |builder: reqwest::ClientBuilder| {
            builder
                .connect_timeout(CONNECT_TIMEOUT)
                .user_agent(concat!("agent_brain/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|source| Error::Http {
                    what: "build the HTTP client",
                    source,
                })
        };
        Ok(Self {
            http: build(reqwest::Client::builder().timeout(REQUEST_TIMEOUT))?,
            stream_http: build(reqwest::Client::builder().read_timeout(STREAM_READ_TIMEOUT))?,
            hosts: Arc::new(hosts),
            api_key: Arc::from(api_key.trim()),
        })
    }

    /// A client from the environment: `MACRO_API_KEY` (required) and
    /// `MACRO_ENV` (`prod` (default), `dev`, or `local`).
    pub fn from_env() -> Result<Self> {
        let key = env_string("MACRO_API_KEY")?
            .ok_or_else(|| Error::Config("MACRO_API_KEY is not set".to_owned()))?;
        let env = match env_string("MACRO_ENV")? {
            Some(value) => value.parse()?,
            None => Environment::Prod,
        };
        Self::new(key, Hosts::for_env(env))
    }

    /// The hosts this client calls.
    pub fn hosts(&self) -> &Hosts {
        &self.hosts
    }

    /// Who this key belongs to.
    pub async fn me(&self) -> Result<Me> {
        let url = format!("{}/user/me", self.hosts.auth);
        self.json("read the current user", self.http.get(url)).await
    }

    /// This team agent's profile: name, job description, personality.
    pub async fn team_agent_profile(&self) -> Result<TeamAgentProfile> {
        let url = format!("{}/team_agents/me", self.hosts.auth);
        self.json("read the team agent profile", self.http.get(url))
            .await
    }

    /// Post a message in a channel (top level, or in a thread).
    #[tracing::instrument(skip_all, fields(channel_id, thread_id = message.thread_id.as_deref()), err)]
    pub async fn post_message(&self, channel_id: &str, message: &NewMessage) -> Result<Message> {
        let mut message = message.clone();
        if message.nonce.is_none() {
            message.nonce = Some(Uuid::now_v7().to_string());
        }
        let url = format!("{}/messages/channel/{channel_id}", self.hosts.storage);
        self.json("post a message", self.http.post(url).json(&message))
            .await
    }

    /// Post a top-level message.
    pub async fn post(&self, channel_id: &str, content: impl Into<String>) -> Result<Message> {
        self.post_message(channel_id, &NewMessage::text(content))
            .await
    }

    /// Reply in the thread rooted at `root_id`.
    pub async fn reply(
        &self,
        channel_id: &str,
        root_id: &str,
        content: impl Into<String>,
    ) -> Result<Message> {
        self.post_message(channel_id, &NewMessage::text(content).in_thread(root_id))
            .await
    }

    /// Turn the typing indicator on or off. It expires on its own after a
    /// few seconds; [`TypingGuard`](crate::wake::TypingGuard) keeps it alive.
    pub async fn typing(
        &self,
        channel_id: &str,
        thread_id: Option<&str>,
        active: bool,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            active: bool,
            thread_id: Option<&'a str>,
        }
        let url = format!(
            "{}/messages/channel/{channel_id}/typing",
            self.hosts.storage
        );
        self.send(
            "send the typing indicator",
            self.http.post(url).json(&Body { active, thread_id }),
        )
        .await
        .map(drop)
    }

    /// A channel's name, kind, and members.
    pub async fn channel(&self, channel_id: &str) -> Result<ChannelDetail> {
        let url = format!("{}/channels/{channel_id}", self.hosts.storage);
        self.json("read a channel", self.http.get(url)).await
    }

    /// Root messages in a channel, newest first, one page.
    pub async fn channel_messages(
        &self,
        channel_id: &str,
        query: &TimelineQuery,
    ) -> Result<MessagePage> {
        let selection =
            serde_json::to_string(query).map_err(|e| Error::json("the timeline query", e))?;
        let url = format!("{}/messages/channel/{channel_id}", self.hosts.storage);
        self.json(
            "read channel messages",
            self.http.get(url).query(&[("selection", selection)]),
        )
        .await
    }

    /// The latest `limit` root messages of a channel, oldest first.
    pub async fn recent_messages(&self, channel_id: &str, limit: u8) -> Result<Vec<ListedMessage>> {
        let query = TimelineQuery {
            limit: Some(limit.clamp(1, 100)),
            ..TimelineQuery::default()
        };
        let mut items = self.channel_messages(channel_id, &query).await?.items;
        items.reverse();
        Ok(items)
    }

    /// Ask Jev: the probability that each yes/no question is true of `input`.
    #[tracing::instrument(skip_all, fields(questions = request.questions.len()), err)]
    pub async fn decide(&self, request: &DecideRequest) -> Result<DecideResponse> {
        let url = format!("{}/decisions", self.hosts.cognition);
        self.json("ask for a decision", self.http.post(url).json(request))
            .await
    }

    /// The newest emails in the agent's inbox.
    pub async fn emails(&self, limit: u16) -> Result<Vec<EmailMessage>> {
        let url = format!("{}/team_agents/me/email/messages", self.hosts.auth);
        let list: EmailList = self
            .json("list emails", self.http.get(url).query(&[("limit", limit)]))
            .await?;
        Ok(list.messages)
    }

    /// Send an email from the agent's own address.
    pub async fn send_email(&self, email: &OutgoingEmail) -> Result<SentEmail> {
        let url = format!("{}/team_agents/me/email/send", self.hosts.auth);
        self.json("send an email", self.http.post(url).json(email))
            .await
    }

    /// Start an agent session with id `id` on the bot's runtime. Takes up to
    /// three minutes; fails with status 409 when the runtime is down.
    #[tracing::instrument(skip_all, fields(session_id = %id, bot_id = %bot_id), err)]
    pub async fn create_agent_session(&self, id: Uuid, bot_id: Uuid) -> Result<AgentSession> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            id: Uuid,
            bot_id: Uuid,
        }
        let url = format!("{}/agent-sessions", self.hosts.agent_harness);
        let created: AgentSessionCreated = self
            .json(
                "create an agent session",
                self.http
                    .post(url)
                    .timeout(SESSION_CREATE_TIMEOUT)
                    .json(&Body { id, bot_id }),
            )
            .await?;
        Ok(created.session)
    }

    /// Send a prompt to an existing agent session.
    #[tracing::instrument(skip_all, fields(session_id = %session_id), err)]
    pub async fn prompt_agent_session(&self, session_id: Uuid, prompt: &str) -> Result<PromptAck> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            action_id: Uuid,
            r#type: &'static str,
            prompt: &'a str,
        }
        let url = format!(
            "{}/agent-sessions/{session_id}/control",
            self.hosts.agent_harness
        );
        let body = Body {
            action_id: Uuid::now_v7(),
            r#type: "prompt",
            prompt,
        };
        self.json("prompt an agent session", self.http.post(url).json(&body))
            .await
    }

    /// Open the raw event stream response. Used by [`crate::events`].
    pub(crate) async fn open_event_stream(&self, filters_json: &str) -> Result<reqwest::Response> {
        let url = format!("{}/webhook/events/stream", self.hosts.storage);
        self.send(
            "open the event stream",
            self.stream_http
                .get(url)
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .query(&[("scope", "user"), ("filters", filters_json)]),
        )
        .await
    }

    async fn send(
        &self,
        what: &'static str,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response> {
        let response = request
            .header(API_KEY_HEADER, &*self.api_key)
            .send()
            .await
            .map_err(|source| Error::Http { what, source })?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let mut body = response.text().await.unwrap_or_default();
        if body.len() > ERROR_BODY_LIMIT {
            let mut end = ERROR_BODY_LIMIT;
            while !body.is_char_boundary(end) {
                end -= 1;
            }
            body.truncate(end);
        }
        Err(Error::Status {
            what,
            status: status.as_u16(),
            body,
        })
    }

    async fn json<T: DeserializeOwned>(
        &self,
        what: &'static str,
        request: reqwest::RequestBuilder,
    ) -> Result<T> {
        self.send(what, request)
            .await?
            .json()
            .await
            .map_err(|source| Error::Http { what, source })
    }
}

/// Read an environment variable, treating unset and empty alike.
pub(crate) fn env_string(name: &str) -> Result<Option<String>> {
    match std::env::var_os(name) {
        None => Ok(None),
        Some(value) => {
            let value = value
                .into_string()
                .map_err(|_| Error::Config(format!("{name} is not valid UTF-8")))?;
            Ok((!value.trim().is_empty()).then_some(value))
        }
    }
}

/// Caches channel details (name, kind) so each event doesn't refetch them.
#[derive(Debug, Default)]
pub struct ChannelCache {
    channels: Mutex<HashMap<String, Arc<ChannelDetail>>>,
}

impl ChannelCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// The channel's details, fetched once and then served from memory.
    pub async fn get(&self, client: &MacroClient, channel_id: &str) -> Result<Arc<ChannelDetail>> {
        if let Some(hit) = self.lock().get(channel_id) {
            return Ok(Arc::clone(hit));
        }
        let detail = Arc::new(client.channel(channel_id).await?);
        self.lock()
            .insert(channel_id.to_owned(), Arc::clone(&detail));
        Ok(detail)
    }

    /// Forget a channel (e.g. after it was renamed).
    pub fn forget(&self, channel_id: &str) {
        self.lock().remove(channel_id);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<ChannelDetail>>> {
        // A poisoned cache is still a valid cache.
        self.channels
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
