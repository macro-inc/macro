//! Read adapters consume the agent-session domain service.

use std::sync::Arc;

use agent_session::domain::search::{
    AgentSessionSearchMetadata, AgentSessionSearchMetadataService,
};
use entity_access::outbound::{accessible_session_ids, get_user_source_ids};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::agent_session::AgentSessionSearchSource;

pub(crate) struct AgentSessionSearchMetadataSource {
    pub db: ReadOnlyPool,
    pub service: Arc<dyn AgentSessionSearchMetadataService>,
}

impl AgentSessionSearchSource for AgentSessionSearchMetadataSource {
    async fn accessible(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        requested: &[Uuid],
    ) -> Result<Vec<AgentSessionSearchMetadata>, Report> {
        let sources = get_user_source_ids(&self.db, Some(user))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        let ids = accessible_session_ids(&self.db, &sources, requested).await?;
        self.service
            .search_metadata(ids)
            .await
            .map_err(|error| rootcause::report!("{error:#}"))
    }
}
