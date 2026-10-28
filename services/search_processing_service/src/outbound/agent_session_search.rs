//! OpenSearch adapter for the agent-session indexing domain port.

use agent_fold::domain::model::Author;
use agent_session::domain::{model::AgentSessionId, search::indexing::SearchSnapshot};
use opensearch_client::{
    OpensearchClient,
    agent_session::{
        AgentSessionMessageAuthor, AgentSessionMessageDocument, ReconcileAgentSessionArgs,
    },
};
use rootcause::Report;
use std::sync::Arc;

use crate::domain::agent_session_index::AgentSessionSearchIndex;

pub struct OpenSearchAgentSessionIndex(pub Arc<OpensearchClient>);

impl AgentSessionSearchIndex for OpenSearchAgentSessionIndex {
    async fn reconcile(
        &self,
        snapshot: SearchSnapshot,
        index_override: Option<&str>,
    ) -> Result<(), Report> {
        let metadata = snapshot.metadata;
        let args = ReconcileAgentSessionArgs {
            agent_session_id: metadata.id.to_string(),
            name: metadata.name,
            owner_id: metadata.owner_id.to_string(),
            bot_id: metadata.bot_id.to_string(),
            thread_id: None,
            originating_message_id: None,
            created_at_millis: opensearch_client::date_format::EpochMillis::new(
                metadata.created_at.timestamp_millis(),
            )?,
            updated_at_millis: opensearch_client::date_format::EpochMillis::new(
                metadata.updated_at.timestamp_millis(),
            )?,
            // The session lease serializes writers; every reconciliation gets
            // its own generation to remove obsolete children after a refold.
            projection_generation: macro_uuid::Uuid::now_v7().to_string(),
            messages: snapshot
                .messages
                .into_iter()
                .map(|message| AgentSessionMessageDocument {
                    turn: message.id.0,
                    author: match &message.author {
                        Author::User { .. } => AgentSessionMessageAuthor::User,
                        Author::Agent => AgentSessionMessageAuthor::Agent,
                    },
                    author_user_id: match &message.author {
                        Author::User { user_id } => user_id.as_ref().map(ToString::to_string),
                        Author::Agent => None,
                    },
                    content: message.searchable_text(),
                })
                .collect(),
        };
        Ok(self
            .0
            .reconcile_agent_session(&args, index_override)
            .await?)
    }

    async fn delete(&self, id: AgentSessionId, index_override: Option<&str>) -> Result<(), Report> {
        Ok(self
            .0
            .delete_agent_session(&id.to_string(), index_override)
            .await?)
    }
}
