//! Live trigger stream: identify this bot, then hold
//! `GET /webhook/events/stream` open as that bot acting for its owner.
//!
//! The body is Server-Sent Events. Each `data:` frame is the same broker
//! envelope persisted webhooks deliver. Delivery is best-effort: a dropped
//! connection misses events published while it was down.

use std::collections::VecDeque;

use bot_id::BotId;
use rootcause::prelude::ResultExt as _;
use serde::Deserialize;
use webhook::domain::models::{WebhookFilter, WebhookScope};

#[cfg(test)]
mod test;

const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
const BOT_ACTING_USER_HEADER: &str = "x-macro-bot-for-macro-user-id";

/// Map the daemon's `bot_scope` config onto the stream query's workspace scope.
pub fn stream_scope(bot_scope: &str) -> rootcause::Result<WebhookScope> {
    match bot_scope {
        "user" => Ok(WebhookScope::User),
        "team" => Ok(WebhookScope::Team),
        other => rootcause::bail!("unsupported bot_scope `{other}`; expected `user` or `team`"),
    }
}

/// Incremental Server-Sent Events parser: bytes in, `data:` payloads out.
///
/// Comments (`: keep-alive`) and frames with no data are dropped. `id` and
/// `event` fields are ignored: the broker envelope is self-describing.
#[derive(Debug, Default)]
pub(crate) struct SseParser {
    buf: String,
}

impl SseParser {
    /// Append a chunk and return every complete data payload it finished.
    pub(crate) fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buf.push_str(&chunk.replace("\r\n", "\n"));
        let mut payloads = Vec::new();
        while let Some(idx) = self.buf.find("\n\n") {
            let frame = self.buf[..idx].to_owned();
            self.buf.replace_range(..idx + 2, "");
            if let Some(data) = frame_data(&frame) {
                payloads.push(data);
            }
        }
        payloads
    }
}

fn frame_data(frame: &str) -> Option<String> {
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some(rest) = line.strip_prefix("data:") else {
            continue;
        };
        data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
    }
    if data_lines.is_empty() {
        None
    } else {
        Some(data_lines.join("\n"))
    }
}

/// Client for the storage service's live event stream, acting as one bot.
pub struct EventStreamClient {
    http: reqwest::Client,
    base: String,
    bot_token: String,
    bot_scope: String,
    owner_user_id: String,
}

impl EventStreamClient {
    /// Build a client that calls the storage service as one bot.
    pub fn new(
        storage_url: impl Into<String>,
        bot_token: impl Into<String>,
        bot_scope: impl Into<String>,
        owner_user_id: impl Into<String>,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: storage_url.into().trim_end_matches('/').to_owned(),
            bot_token: bot_token.into(),
            bot_scope: bot_scope.into(),
            owner_user_id: owner_user_id.into(),
        }
    }

    fn credentialed(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header(BOT_TOKEN_HEADER, &self.bot_token)
            .header(BOT_SCOPE_HEADER, &self.bot_scope)
            .header(BOT_ACTING_USER_HEADER, &self.owner_user_id)
    }

    /// Who this daemon's token is. Stream filters are scoped to that bot.
    #[tracing::instrument(skip(self), err)]
    pub async fn identify_bot(&self) -> rootcause::Result<BotId> {
        let response = self
            .credentialed(self.http.get(format!("{}/bots/me", self.base)))
            .send()
            .await
            .context("could not reach the service to identify the bot")?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to identify the bot: {message}");
        }
        let me: BotMe = response
            .json()
            .await
            .context("could not read the service's answer to identify the bot")?;
        Ok(me.id)
    }

    /// Open `GET /webhook/events/stream` and start reading envelopes.
    #[tracing::instrument(skip(self, filters), err)]
    pub async fn connect(
        &self,
        scope: WebhookScope,
        filters: &[WebhookFilter],
    ) -> rootcause::Result<EventStream> {
        let filters =
            serde_json::to_string(filters).context("could not encode the stream filters")?;
        let response = self
            .credentialed(
                self.http
                    .get(format!("{}/webhook/events/stream", self.base))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .query(&[
                        ("scope", scope_as_str(scope)),
                        ("filters", filters.as_str()),
                    ]),
            )
            .send()
            .await
            .context("could not reach the service to open the event stream")?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to open the event stream: {message}");
        }
        Ok(EventStream {
            response,
            parser: SseParser::default(),
            pending: VecDeque::new(),
        })
    }
}

fn scope_as_str(scope: WebhookScope) -> &'static str {
    match scope {
        WebhookScope::User => "user",
        WebhookScope::Team => "team",
    }
}

#[derive(Debug, Deserialize)]
struct BotMe {
    id: BotId,
}

/// An open SSE response, yielding one broker envelope at a time.
pub struct EventStream {
    response: reqwest::Response,
    parser: SseParser,
    pending: VecDeque<serde_json::Value>,
}

impl EventStream {
    /// The next complete JSON envelope, or `None` when the server closes.
    pub async fn next_envelope(&mut self) -> rootcause::Result<Option<serde_json::Value>> {
        loop {
            if let Some(value) = self.pending.pop_front() {
                return Ok(Some(value));
            }
            let Some(chunk) = self
                .response
                .chunk()
                .await
                .context("could not read the event stream")?
            else {
                return Ok(None);
            };
            let text = String::from_utf8_lossy(&chunk);
            for data in self.parser.push(&text) {
                match serde_json::from_str(&data) {
                    Ok(value) => self.pending.push_back(value),
                    Err(_) => {
                        tracing::debug!("undecodable SSE data frame; skipped");
                    }
                }
            }
        }
    }
}
