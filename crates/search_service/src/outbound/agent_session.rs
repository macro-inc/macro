//! Read adapters delegate to the table-owning crates.

use agent_session::domain::search::AgentSessionSearchMetadata;
use entity_access::outbound::{accessible_session_ids, get_user_source_ids};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::agent_session::AgentSessionSearchSource;

pub(crate) struct PgAgentSessionSearchSource(pub ReadOnlyPool);

impl AgentSessionSearchSource for PgAgentSessionSearchSource {
    async fn accessible(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        requested: &[Uuid],
    ) -> Result<Vec<AgentSessionSearchMetadata>, Report> {
        let sources = get_user_source_ids(&self.0, Some(user))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        let ids = accessible_session_ids(&self.0, &sources, requested).await?;
        Ok(agent_session::outbound::postgres::search::search_metadata(&self.0, &ids).await?)
    }
}
