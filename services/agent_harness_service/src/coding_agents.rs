//! Compose agent discovery and session launch from the owning domain services.

use std::{collections::HashMap, sync::Arc};

use agent_session::domain::coding_agents::{
    CodingAgent, CodingAgentCandidate, CodingAgentDirectory, CodingAgentError,
    CodingAgentServiceImpl,
};
use agent_session::domain::routines::RoutineSessions;
use agent_session::inbound::coding_agents::{CodingAgentsState, coding_agents_router};
use axum::Router;
use bots::domain::ports::BotService;
use claude_cloud_agents::domain::credentials::AccountCredentials;
use codex_connection::domain::ConnectionService;
use harness_id::HarnessId;
use harnesses::domain::ports::HarnessRepo;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// Read discoverable agents and connection facts using each owning capability.
pub struct AvailableCodingAgents<Bots, Harnesses> {
    bots: Bots,
    harnesses: Harnesses,
    pool: PgPool,
    codex: Option<Arc<dyn ConnectionService>>,
    claude: Option<AccountCredentials>,
}

impl<Bots, Harnesses> AvailableCodingAgents<Bots, Harnesses> {
    /// Reuse the same credential stores and domains as interactive sessions.
    pub fn new(
        bots: Bots,
        harnesses: Harnesses,
        pool: PgPool,
        codex: Option<Arc<dyn ConnectionService>>,
        claude: Option<AccountCredentials>,
    ) -> Self {
        Self {
            bots,
            harnesses,
            pool,
            codex,
            claude,
        }
    }
}

impl<Bots: BotService, Harnesses: HarnessRepo> CodingAgentDirectory
    for AvailableCodingAgents<Bots, Harnesses>
{
    async fn candidates(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<CodingAgentCandidate>, CodingAgentError> {
        let (agents, cursor) = tokio::try_join!(
            async {
                self.bots
                    .list_agents(user_id.clone())
                    .await
                    .map_err(|_| CodingAgentError::OperationFailed)
            },
            async {
                cursor_api_key::store::get_cursor_api_key(&self.pool, user_id.as_ref())
                    .await
                    .map_err(|_| CodingAgentError::OperationFailed)
            },
        )?;
        // Persona visibility is already authorized by the bots domain. A
        // shared-channel persona may use a private harness the caller cannot
        // administer or list, so read only that persona's bound runtime facts.
        let harness_ids = agents
            .iter()
            .filter(|agent| agent.harness == harness_id::MACROD_HARNESS_SLUG)
            .filter_map(|agent| agent.harness_id)
            .collect::<Vec<_>>();
        let harnesses = connected_harnesses(&self.harnesses, harness_ids).await?;
        let codex_connected = if agents.iter().any(|agent| agent.harness == "codex-cloud") {
            match &self.codex {
                Some(codex) => {
                    let status = codex
                        .status(user_id.as_ref())
                        .await
                        .map_err(|_| CodingAgentError::OperationFailed)?;
                    codex_available(&status)
                }
                None => false,
            }
        } else {
            false
        };
        let claude_connected = if agents.iter().any(|agent| agent.harness == "claude-cloud") {
            match &self.claude {
                Some(claude) => claude.contains(user_id.as_ref()).await,
                None => false,
            }
        } else {
            false
        };
        let mut candidates = vec![CodingAgentCandidate {
            handle: Some("cursor".into()),
            agent: CodingAgent {
                id: bot_id::CURSOR_BOT_ID.as_uuid(),
                name: bot_id::CURSOR_NAME.into(),
                description: Some("Cursor cloud agents, run with your Cursor account.".into()),
                instructions: String::new(),
                harness: "cursor".into(),
                model: cursor
                    .as_ref()
                    .and_then(|config| config.default_model_id.clone()),
            },
            is_coding: true,
            available: cursor.is_some(),
        }];
        let connections = RuntimeConnections {
            cursor: cursor.is_some(),
            codex: codex_connected,
            claude: claude_connected,
            harnesses,
        };
        candidates.extend(agents.into_iter().map(|agent| {
            let available = connections.available(&agent.harness, agent.harness_id);
            CodingAgentCandidate {
                handle: Some(agent.bot.handle),
                agent: CodingAgent {
                    id: agent.bot.id.as_uuid(),
                    name: agent.bot.name,
                    description: agent.bot.description,
                    instructions: agent.instructions,
                    harness: agent.harness,
                    model: Some(agent.default_model).filter(|model| !model.trim().is_empty()),
                },
                is_coding: agent.is_coding,
                available,
            }
        }));
        Ok(candidates)
    }
}

async fn connected_harnesses(
    harnesses: &impl HarnessRepo,
    ids: impl IntoIterator<Item = HarnessId>,
) -> Result<HashMap<HarnessId, bool>, CodingAgentError> {
    let mut connected = HashMap::new();
    for id in ids {
        if connected.contains_key(&id) {
            continue;
        }
        let harness = harnesses
            .get_harness(id)
            .await
            .map_err(|_| CodingAgentError::OperationFailed)?;
        connected.insert(id, harness.is_some_and(|harness| harness.connected));
    }
    Ok(connected)
}

fn codex_available(status: &codex_connection::domain::ConnectionStatus) -> bool {
    status.connected && status.environment_id.is_some()
}

#[derive(Default)]
struct RuntimeConnections {
    cursor: bool,
    codex: bool,
    claude: bool,
    harnesses: HashMap<HarnessId, bool>,
}

impl RuntimeConnections {
    fn available(&self, harness: &str, harness_id: Option<HarnessId>) -> bool {
        match harness {
            "cursor" => self.cursor,
            "codex-cloud" => self.codex,
            "claude-cloud" => self.claude,
            "in-memory" | "macro-inmem" => true,
            harness_id::MACROD_HARNESS_SLUG => harness_id
                .and_then(|id| self.harnesses.get(&id))
                .copied()
                .unwrap_or(false),
            _ => false,
        }
    }
}

/// Reuse authorized session preparation and the normal first-prompt pipeline.
pub fn router<Directory, Sessions, Auth>(
    directory: Directory,
    sessions: Sessions,
    authorization: MacroAuthorizationState<Auth>,
) -> Router
where
    Directory: CodingAgentDirectory,
    Sessions: RoutineSessions,
    Auth: MacroAuthorizationService,
{
    coding_agents_router(CodingAgentsState::new(
        Arc::new(CodingAgentServiceImpl::new(directory, sessions)),
        authorization,
    ))
}
