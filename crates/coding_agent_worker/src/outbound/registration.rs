//! Boot-time webhook feed reconciliation: make sure this daemon's bot has a
//! validated trigger feed pointing at this daemon, without any manual step.
//!
//! The flow is deliberately the plain webhook API driven as the bot acting
//! for its owner: who am I (`/bots/me`), do I have a feed (list), is it
//! mine and current (endpoint match), verify it if unverified, create it if
//! missing. It leans on no server-side affordance beyond that API: the feed
//! is an ordinary webhook, scoped to this bot by an `ids` filter and found
//! again by the namespace this daemon mints for it.
//!
//! Secrets are only ever returned at creation, so the daemon persists its
//! feed's id and secret in a state file next to the config. Losing the file
//! is recoverable: the stale feed is deleted and recreated.

use std::path::{Path, PathBuf};

use agent_trigger::domain::broker_events::AgentTriggerEventName;
use bot_id::BotId;
use bots::domain::models::Bot;
use rootcause::prelude::ResultExt as _;
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator as _;
use webhook::domain::models::{
    CreateWebhookRequest, CreateWebhookResponse, ListWebhooksResponse, Webhook, WebhookFilter,
    WebhookScope,
};

use crate::config::{MacroApi, Server};

#[cfg(test)]
mod test;

const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
const BOT_ACTING_USER_HEADER: &str = "x-macro-bot-for-macro-user-id";

/// The namespace a daemon's feed carries: derived from its bot, so the feed
/// can be found again without the server marking it as that bot's.
///
/// Takes the `BotId` rather than its rendering, so no other identifier can be
/// mistaken for the bot this feed belongs to.
fn feed_namespace(bot: BotId) -> String {
    format!("agent-feed-{bot}")
}

/// Every event a trigger feed carries, straight from the topic's own
/// vocabulary: a mention that should open a session, and a follow-up message
/// on a thread that already has one. A name this daemon does not yet handle
/// is still worth subscribing to - it arrives, is recognised as unsupported,
/// and is acked - which beats silently never being sent it.
fn trigger_events() -> Vec<String> {
    AgentTriggerEventName::iter()
        .map(|event| event.to_string())
        .collect()
}

/// The reconciled feed this daemon serves.
#[derive(Debug, Clone)]
pub struct FeedRegistration {
    /// The webhook row's id.
    pub webhook_id: String,
    /// The secret deliveries to this daemon are signed with.
    pub signing_secret: String,
    /// Whether the endpoint had already passed validation. When false, the
    /// caller should request validation once it is serving.
    pub is_valid: bool,
}

/// The persisted half of a registration: what only creation reveals.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FeedState {
    webhook_id: String,
    signing_secret: String,
}

pub(crate) trait FeedStateStore {
    fn load(&self) -> rootcause::Result<Option<FeedState>>;

    fn save(&self, state: &FeedState) -> rootcause::Result<()>;
}

pub(crate) struct FileFeedStateStore {
    path: PathBuf,
}

impl FileFeedStateStore {
    fn failure(&self) -> String {
        format!(
            "failed to use the feed state file at {}",
            self.path.display()
        )
    }
}

impl FeedStateStore for FileFeedStateStore {
    fn load(&self) -> rootcause::Result<Option<FeedState>> {
        let found = std::fs::read_to_string(&self.path);
        if let Err(error) = &found
            && error.kind() == std::io::ErrorKind::NotFound
        {
            return Ok(None);
        }
        // State we cannot parse is state we do not have: the feed it named
        // is treated as stale, deleted, and replaced.
        let raw = found.context(self.failure())?;
        Ok(serde_json::from_str(&raw).ok())
    }

    fn save(&self, state: &FeedState) -> rootcause::Result<()> {
        let raw = serde_json::to_string_pretty(state).expect("a serializable state");
        std::fs::write(&self.path, raw).context(self.failure())?;
        // The secret signs deliveries to us; keep it out of other users' reach.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }
}

/// Where the feed state lives: next to the config it belongs to.
pub fn state_path(config_path: &Path) -> PathBuf {
    config_path.with_extension("webhook-state.json")
}

/// The webhook-feed reconciler for one bot on one deployment.
pub(crate) struct FeedReconciler<S = FileFeedStateStore> {
    http: reqwest::Client,
    base: String,
    macro_api: MacroApi,
    owner_user_id: String,
    public_url: String,
    state_store: S,
}

impl FeedReconciler<FileFeedStateStore> {
    /// Build a reconciler from the daemon's config.
    pub fn new(macro_api: &MacroApi, server: &Server, config_path: &Path) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: macro_api.storage_url.trim_end_matches('/').to_owned(),
            macro_api: macro_api.clone(),
            owner_user_id: macro_api.owner_user_id.clone(),
            public_url: server.public_url.clone(),
            state_store: FileFeedStateStore {
                path: state_path(config_path),
            },
        }
    }
}

impl<S: FeedStateStore> FeedReconciler<S> {
    fn credentialed(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header(BOT_TOKEN_HEADER, &self.macro_api.bot_token)
            .header(BOT_SCOPE_HEADER, &self.macro_api.bot_scope)
            .header(BOT_ACTING_USER_HEADER, &self.owner_user_id)
    }

    async fn read<T: serde::de::DeserializeOwned>(
        &self,
        what: &'static str,
        request: reqwest::RequestBuilder,
    ) -> rootcause::Result<T> {
        let response = self
            .credentialed(request)
            .send()
            .await
            .context(format!("could not reach the service to {what}"))?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to {what}: {message}");
        }
        Ok(response
            .json()
            .await
            .context(format!("could not read the service's answer to {what}"))?)
    }

    /// Reconcile: return a feed that exists, points at this daemon, and
    /// whose secret this daemon holds.
    pub async fn ensure_feed(&self) -> rootcause::Result<FeedRegistration> {
        let me: Bot = self
            .read(
                "identify the bot",
                self.http.get(format!("{}/bots/me", self.base)),
            )
            .await?;
        let bot = me.id;

        let list: ListWebhooksResponse = self
            .read(
                "list webhooks",
                self.http.get(format!("{}/webhook/webhooks", self.base)),
            )
            .await?;
        let mine: Vec<&Webhook> = list
            .webhooks
            .iter()
            .filter(|row| row.namespace == feed_namespace(bot))
            .collect();

        // The remembered feed, when it still exists and points here.
        if let Some(state) = self.state_store.load()?
            && let Some(row) = mine.iter().find(|row| row.id == state.webhook_id)
            && row.endpoint_url == self.public_url
        {
            return Ok(FeedRegistration {
                webhook_id: state.webhook_id,
                signing_secret: state.signing_secret,
                is_valid: row.is_valid,
            });
        }

        // Anything else of ours is a feed whose secret is lost or whose
        // endpoint moved: delete before recreating, since one bot needs
        // exactly one feed.
        for row in mine {
            tracing::info!(webhook_id = %row.id, "removing this bot's stale trigger feed");
            let response = self
                .credentialed(
                    self.http
                        .delete(format!("{}/webhook/webhooks/{}", self.base, row.id)),
                )
                .send()
                .await?;
            if !response.status().is_success() {
                tracing::warn!(webhook_id = %row.id, status = %response.status(), "stale feed delete refused");
            }
        }

        let created: CreateWebhookResponse = self
            .read(
                "create the trigger feed",
                self.http
                    .post(format!("{}/webhook/webhooks", self.base))
                    .json(&CreateWebhookRequest {
                        scope: WebhookScope::User,
                        namespace: feed_namespace(bot),
                        name: "Agent trigger feed".to_owned(),
                        endpoint_url: self.public_url.clone(),
                        headers: None,
                        // Scoped to this bot: trigger events name the bot they
                        // are for, so without this the feed would receive
                        // every bot's triggers in channels its owner can see.
                        filters: vec![WebhookFilter {
                            events: trigger_events(),
                            ids: Some(vec![bot.to_string()]),
                        }],
                    }),
            )
            .await?;

        self.state_store.save(&FeedState {
            webhook_id: created.id.clone(),
            signing_secret: created.signing_secret.clone(),
        })?;
        tracing::info!(webhook_id = %created.id, %bot, "trigger feed registered");

        Ok(FeedRegistration {
            webhook_id: created.id,
            signing_secret: created.signing_secret,
            is_valid: created.is_valid,
        })
    }

    /// Ask the service to validate the feed's endpoint; call once serving.
    /// Best-effort: a rate-limited or failed validation is retried by a
    /// later boot, and deliveries to an unvalidated feed simply wait.
    pub async fn request_validation(&self, webhook_id: &str) {
        let result = self
            .credentialed(self.http.post(format!(
                "{}/webhook/webhooks/{}/validate",
                self.base, webhook_id
            )))
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                tracing::info!(%webhook_id, "trigger feed validated");
            }
            Ok(response) => {
                tracing::warn!(%webhook_id, status = %response.status(), "feed validation refused");
            }
            Err(error) => {
                tracing::warn!(error = ?error, %webhook_id, "feed validation failed");
            }
        }
    }
}
