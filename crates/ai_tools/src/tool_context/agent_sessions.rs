//! Wire the session reader to the shared session repository and access service.

use super::ToolEntityAccessService;
use agent_session::{
    domain::read::SessionReader, inbound::toolset::ReadAgentSessionContext,
    outbound::postgres::PgAgentSessionRepo,
};
use bots::outbound::pg_bots_repo::PgBotsRepo;
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use std::sync::Arc;

/// Session-reading dependencies shared by chat, agents, and external MCP.
pub type ToolReadAgentSessionContext =
    ReadAgentSessionContext<PgAgentSessionRepo<PgBotsRepo>, ToolEntityAccessService>;

/// Reuse the session domain's repository and the host's entity-access service.
pub fn build_read_agent_session_context(
    pool: sqlx::PgPool,
    access: Arc<ToolEntityAccessService>,
) -> ToolReadAgentSessionContext {
    let registrar = OwnedEntityRegistrar::new(OwnerGrantPolicy::new(PgBotsRepo::new(pool.clone())));
    let repo = PgAgentSessionRepo::new(pool, registrar);
    ReadAgentSessionContext {
        sharing: Arc::new(agent_session::domain::sharing::SessionSharingService::new(
            repo.clone(),
        )),
        service: Arc::new(SessionReader::new(repo)),
        access,
    }
}
