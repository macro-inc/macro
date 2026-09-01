//! Webhook feed reconciliation: make sure this harness has a validated
//! trigger feed pointing at this daemon and covering every agent bound to it.
//!
//! The flow is deliberately the plain webhook API driven as the harness: which
//! agents am I serving (`/harnesses/me/agents`), do I have a feed (list), is
//! it mine and current (endpoint and bound-agent match), verify it if
//! unverified, create it if missing or stale. It leans on no server-side
//! affordance beyond that API: the feed is an ordinary webhook, scoped to the
//! bound bots by an `ids` filter and found again by the namespace this daemon
//! mints for it.
//!
//! Run at boot and then periodically: a teammate binding a new agent to this
//! harness changes the bound set, and the feed must grow to cover it without
//! a daemon restart.
//!
//! Secrets are only ever returned at creation, so the daemon persists its
//! feed's id and secret in a state file next to the config. Losing the file
//! is recoverable: the stale feed is deleted and recreated.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use agent_trigger::domain::broker_events::AgentTriggerEventName;
use harness_id::HarnessId;
use harnesses::domain::models::HarnessAgent;
use rootcause::prelude::ResultExt as _;
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator as _;
use webhook::domain::models::{
    CreateWebhookRequest, CreateWebhookResponse, ListWebhooksResponse, Webhook, WebhookFilter,
    WebhookScope,
};

use crate::config::{MacroApi, Server};
use crate::outbound::credentials::{HarnessCredentials, HarnessScope};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// The namespace a daemon's feed carries: derived from its harness, so the
/// feed can be found again without the server marking it as this harness's.
fn feed_namespace(harness: HarnessId) -> String {
    format!("harness-feed-{harness}")
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

/// The webhook-feed reconciler for one harness on one deployment.
pub(crate) struct FeedReconciler<S = FileFeedStateStore> {
    http: reqwest::Client,
    base: String,
    credentials: HarnessCredentials,
    public_url: String,
    state_store: S,
}

impl FeedReconciler<FileFeedStateStore> {
    /// Build a reconciler from the daemon's config and paired credentials.
    pub fn new(
        macro_api: &MacroApi,
        server: &Server,
        credentials: HarnessCredentials,
        config_path: &Path,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: macro_api.storage_url.trim_end_matches('/').to_owned(),
            credentials,
            public_url: server.public_url.clone(),
            state_store: FileFeedStateStore {
                path: state_path(config_path),
            },
        }
    }
}

impl<S: FeedStateStore> FeedReconciler<S> {
    fn credentialed(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.header(HARNESS_TOKEN_HEADER, &self.credentials.token)
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
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            rootcause::bail!(
                "the service refused this harness's credentials ({status}) while trying to \
                 {what}; the harness was likely removed - press p to pair again"
            );
        }
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to {what}: {message}");
        }
        Ok(response
            .json()
            .await
            .context(format!("could not read the service's answer to {what}"))?)
    }

    /// The agents currently bound to this harness, as sorted bot-id strings -
    /// the shape the feed filter carries.
    pub async fn bound_bot_ids(&self) -> rootcause::Result<Vec<String>> {
        let agents: Vec<HarnessAgent> = self
            .read(
                "list this harness's agents",
                self.http.get(format!("{}/harnesses/me/agents", self.base)),
            )
            .await?;
        let ids: BTreeSet<String> = agents
            .into_iter()
            .map(|agent| agent.bot_id.to_string())
            .collect();
        Ok(ids.into_iter().collect())
    }

    /// Whether an existing feed row already covers exactly `bot_ids`.
    fn covers(row: &Webhook, public_url: &str, bot_ids: &[String]) -> bool {
        if row.endpoint_url != public_url {
            return false;
        }
        let current: BTreeSet<&str> = row
            .filters
            .iter()
            .flat_map(|filter| filter.ids.iter().flatten())
            .map(String::as_str)
            .collect();
        let wanted: BTreeSet<&str> = bot_ids.iter().map(String::as_str).collect();
        current == wanted
    }

    /// Reconcile: return a feed that exists, points at this daemon, and
    /// covers every agent currently bound to this harness - or `None` while
    /// nothing is bound, since a filter over no bots is nothing to subscribe
    /// to (and the webhook API rightly refuses an empty ids list).
    pub async fn ensure_feed(&self) -> rootcause::Result<Option<FeedRegistration>> {
        let harness = self.credentials.harness_id;
        let bot_ids = self.bound_bot_ids().await?;

        let list: ListWebhooksResponse = self
            .read(
                "list webhooks",
                self.http.get(format!("{}/webhook/webhooks", self.base)),
            )
            .await?;
        let mine: Vec<&Webhook> = list
            .webhooks
            .iter()
            .filter(|row| row.namespace == feed_namespace(harness))
            .collect();

        // The remembered feed, when it still exists, points here, and covers
        // the current bound set.
        if !bot_ids.is_empty()
            && let Some(state) = self.state_store.load()?
            && let Some(row) = mine.iter().find(|row| row.id == state.webhook_id)
            && Self::covers(row, &self.public_url, &bot_ids)
        {
            return Ok(Some(FeedRegistration {
                webhook_id: state.webhook_id,
                signing_secret: state.signing_secret,
                is_valid: row.is_valid,
            }));
        }

        // Anything else of ours is a feed whose secret is lost, whose
        // endpoint moved, or whose bound set changed: delete before
        // recreating, since one harness needs exactly one feed.
        for row in mine {
            tracing::info!(webhook_id = %row.id, "removing this harness's stale trigger feed");
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

        if bot_ids.is_empty() {
            tracing::warn!(
                "no agents are bound to this harness yet; the trigger feed will be registered \
                 once one is (Settings -> Agents)"
            );
            return Ok(None);
        }

        // A team harness's feed subscribes in the team workspace so triggers
        // for teammates' agents - fanned out to every accessor's workspaces -
        // reach it.
        let scope = match self.credentials.scope {
            HarnessScope::User => WebhookScope::User,
            HarnessScope::Team => WebhookScope::Team,
        };
        let created: CreateWebhookResponse = self
            .read(
                "create the trigger feed",
                self.http
                    .post(format!("{}/webhook/webhooks", self.base))
                    .json(&CreateWebhookRequest {
                        scope,
                        namespace: feed_namespace(harness),
                        name: "Agent trigger feed".to_owned(),
                        endpoint_url: self.public_url.clone(),
                        headers: None,
                        // Scoped to this harness's agents: trigger events name
                        // the bot they are for, so without this the feed would
                        // receive every bot's triggers in channels its
                        // workspace can see.
                        filters: vec![WebhookFilter {
                            events: trigger_events(),
                            ids: Some(bot_ids),
                        }],
                    }),
            )
            .await?;

        self.state_store.save(&FeedState {
            webhook_id: created.id.clone(),
            signing_secret: created.signing_secret.clone(),
        })?;
        tracing::info!(webhook_id = %created.id, %harness, "trigger feed registered");

        Ok(Some(FeedRegistration {
            webhook_id: created.id,
            signing_secret: created.signing_secret,
            is_valid: created.is_valid,
        }))
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
