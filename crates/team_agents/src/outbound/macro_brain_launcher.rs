//! Starts a team agent's brain through Macro's public API, acting as the
//! agent with its own API key, exactly as the agent itself would.

use std::time::Duration;

use serde::{Deserialize, de::DeserializeOwned};
use tokio_util::task::TaskTracker;
use tracing::Instrument;
use uuid::Uuid;

use crate::domain::models::{BrainLaunch, TeamAgentError};
use crate::domain::ports::BrainLauncher;

const API_KEY_HEADER: &str = "x-macro-user-api-key";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The harness waits up to 180 seconds for the runtime to open a session.
const SESSION_CREATE_TIMEOUT: Duration = Duration::from_secs(200);
/// Handle of the bot that runs an agent's brain. Bots are unique per owner,
/// and each agent owns exactly one.
const BRAIN_HANDLE: &str = "brain";

/// Errors calling Macro as the agent.
#[derive(Debug, thiserror::Error)]
pub enum BrainLaunchError {
    /// The request failed to send or decode.
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    /// Macro answered with an error status.
    #[error("{path} answered {status}: {body}")]
    Status {
        /// Request path.
        path: String,
        /// HTTP status.
        status: reqwest::StatusCode,
        /// Response body.
        body: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum HarnessOwner {
    Team { team_id: Uuid },
    User,
}

#[derive(Deserialize)]
struct Harness {
    id: Uuid,
    owner: HarnessOwner,
    connected: bool,
    #[serde(default)]
    allow_permission_bypass: bool,
}

#[derive(Deserialize)]
struct BotRef {
    id: Uuid,
}

#[derive(Deserialize)]
struct CreatedAgent {
    bot: BotRef,
}

/// Brain launcher over Macro's HTTP API.
#[derive(Clone)]
pub struct MacroBrainLauncher {
    client: reqwest::Client,
    storage_url: String,
    harness_url: String,
    tasks: TaskTracker,
}

impl MacroBrainLauncher {
    /// Builds the launcher on the storage and agent harness base URLs.
    /// Background launches run on `tasks`; close and wait on it at shutdown.
    pub fn new(
        storage_url: String,
        harness_url: String,
        tasks: TaskTracker,
    ) -> Result<Self, BrainLaunchError> {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;

        Ok(Self {
            client,
            storage_url,
            harness_url,
            tasks,
        })
    }

    async fn send<T: DeserializeOwned>(
        request: reqwest::RequestBuilder,
        api_key: &str,
        path: &str,
    ) -> Result<T, BrainLaunchError> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);

        let response = request
            .headers(headers)
            .header(API_KEY_HEADER, api_key)
            .send()
            .await?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(BrainLaunchError::Status {
                path: path.to_string(),
                status,
                body,
            });
        }

        Ok(response.json().await?)
    }

    async fn launch(&self, launch: BrainLaunch) -> Result<(), BrainLaunchError> {
        let _: serde_json::Value = Self::send(
            self.client
                .post(format!("{}/agent-sessions", self.harness_url))
                .timeout(SESSION_CREATE_TIMEOUT)
                .json(&serde_json::json!({
                    "id": launch.session_id,
                    "botId": launch.bot_id,
                })),
            &launch.api_key,
            "/agent-sessions",
        )
        .await?;

        let _: serde_json::Value = Self::send(
            self.client
                .post(format!(
                    "{}/agent-sessions/{}/control",
                    self.harness_url, launch.session_id
                ))
                .json(&serde_json::json!({
                    "actionId": Uuid::now_v7(),
                    "type": "prompt",
                    "prompt": launch.prompt,
                })),
            &launch.api_key,
            "/agent-sessions/{id}/control",
        )
        .await?;

        Ok(())
    }
}

fn internal(error: BrainLaunchError) -> TeamAgentError {
    TeamAgentError::internal(error)
}

impl BrainLauncher for MacroBrainLauncher {
    #[tracing::instrument(name = "team_agents.brain.bind", skip(self, api_key, name), err)]
    async fn bind(
        &self,
        api_key: &str,
        name: &str,
        harness_id: Uuid,
        team_id: Uuid,
        model: &str,
    ) -> Result<Uuid, TeamAgentError> {
        let harnesses: Vec<Harness> = Self::send(
            self.client.get(format!("{}/harnesses", self.storage_url)),
            api_key,
            "/harnesses",
        )
        .await
        .map_err(internal)?;

        let harness = harnesses
            .into_iter()
            .find(|harness| harness.id == harness_id)
            .ok_or_else(|| TeamAgentError::Runtime("the runtime was not found".to_string()))?;

        match harness.owner {
            HarnessOwner::Team { team_id: owner } if owner == team_id => {}
            HarnessOwner::Team { .. } | HarnessOwner::User => {
                return Err(TeamAgentError::Runtime(
                    "the runtime must be shared with the team".to_string(),
                ));
            }
        }

        if !harness.connected {
            return Err(TeamAgentError::Runtime(
                "the runtime is offline".to_string(),
            ));
        }

        let auto_accept_permissions = harness.allow_permission_bypass.then_some(true);
        let created: CreatedAgent = Self::send(
            self.client
                .post(format!("{}/agents", self.storage_url))
                .json(&serde_json::json!({
                    "team_id": null,
                    "harness_id": harness_id,
                    "name": format!("{name} (brain)"),
                    "handle": BRAIN_HANDLE,
                    "description": format!("Runs {name}, a team agent, on this runtime."),
                    "avatar_url": null,
                    "instructions": format!("You are {name}'s brain: the agent that runs {name}, a team agent in Macro, on this computer. Your prompts tell you what to do."),
                    "harness": "macrod",
                    "default_model": model,
                    "channel_scope": "all",
                    "channel_ids": [],
                    "auto_accept_permissions": auto_accept_permissions,
                    "is_coding": true,
                })),
            api_key,
            "/agents",
        )
        .await
        .map_err(internal)?;

        Ok(created.bot.id)
    }

    fn start(&self, launch: BrainLaunch) {
        // Its own trace, linked to the request that started it: the launch
        // outlives the request by minutes.
        let span = tracing::info_span!(
            parent: None,
            "team_agents.brain.start",
            session_id = %launch.session_id,
            bot_id = %launch.bot_id,
        );
        span.follows_from(tracing::Span::current());

        let launcher = self.clone();
        self.tasks.spawn(
            async move {
                let _ = launcher.launch(launch).await.inspect_err(|error| {
                    tracing::error!(error = ?error, "could not start a team agent's brain");
                });
            }
            .instrument(span),
        );
    }
}
