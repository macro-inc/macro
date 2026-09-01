//! Live trigger stream: identify this bot, then hold
//! `GET /webhook/events/stream` open as that bot acting for its owner.
//!
//! The body is Server-Sent Events, decoded by `eventsource-stream`. Each
//! event's `data` is the same broker envelope persisted webhooks deliver,
//! decoded straight into the caller's envelope type. Delivery is
//! best-effort: a dropped connection misses events published while it was
//! down.

use std::marker::PhantomData;
use std::pin::Pin;

use bot_id::BotId;
use eventsource_stream::{Event, EventStreamError, Eventsource as _};
use futures::{Stream, StreamExt as _};
use rootcause::prelude::ResultExt as _;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use webhook::domain::models::{WebhookFilter, WebhookScope};

#[cfg(test)]
mod test;

const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
const BOT_ACTING_USER_HEADER: &str = "x-macro-bot-for-macro-user-id";

/// Map the daemon's `bot_scope` config onto the stream query's workspace scope.
pub fn stream_scope(bot_scope: &str) -> rootcause::Result<WebhookScope> {
    bot_scope.parse().map_err(|_| {
        rootcause::report!("unsupported bot_scope `{bot_scope}`; expected `user` or `team`")
    })
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

    /// Open `GET /webhook/events/stream` and start reading envelopes of
    /// type `E`.
    #[tracing::instrument(skip(self, filters), err)]
    pub async fn connect<E: DeserializeOwned>(
        &self,
        scope: WebhookScope,
        filters: &[WebhookFilter],
    ) -> rootcause::Result<EventStream<E>> {
        let filters =
            serde_json::to_string(filters).context("could not encode the stream filters")?;
        let response = self
            .credentialed(
                self.http
                    .get(format!("{}/webhook/events/stream", self.base))
                    .header(reqwest::header::ACCEPT, "text/event-stream")
                    .query(&[
                        ("scope", scope.to_string().as_str()),
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
            events: Box::pin(response.bytes_stream().eventsource()),
            _envelope: PhantomData,
        })
    }
}

#[derive(Debug, Deserialize)]
struct BotMe {
    id: BotId,
}

type SseEvents =
    Pin<Box<dyn Stream<Item = Result<Event, EventStreamError<reqwest::Error>>> + Send>>;

/// An open SSE response, yielding one decoded envelope at a time.
pub struct EventStream<E> {
    events: SseEvents,
    _envelope: PhantomData<E>,
}

impl<E: DeserializeOwned> EventStream<E> {
    /// The next envelope, or `None` when the server closes.
    ///
    /// Keep-alive comments never surface as events; a `data` payload that
    /// does not decode as `E` is skipped rather than ending the stream.
    pub async fn next_event(&mut self) -> rootcause::Result<Option<E>> {
        loop {
            let Some(event) = self.events.next().await else {
                return Ok(None);
            };
            let event = event.context("could not read the event stream")?;
            match serde_json::from_str(&event.data) {
                Ok(value) => return Ok(Some(value)),
                Err(error) => {
                    tracing::debug!(error = ?error, id = %event.id, "undecodable SSE data; skipped");
                }
            }
        }
    }
}
