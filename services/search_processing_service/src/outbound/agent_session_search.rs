//! OpenSearch adapter for the agent-session indexing domain port.

use agent_fold::domain::model::Author;
use agent_session::domain::{model::AgentSessionId, search::indexing::SearchSnapshot};
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use opensearch_client::{
    OpensearchClient,
    agent_session::{
        AgentSessionMessageAuthor, AgentSessionMessageDocument, ReconcileAgentSessionArgs,
    },
};
use rootcause::Report;
use std::sync::Arc;

use crate::{
    domain::agent_session_index::{AgentSessionSearchIndex, ProjectionVersion, ProjectionWrites},
    parsers::message_text::with_pastes_as_content,
};

pub struct OpenSearchAgentSessionIndex(pub Arc<OpensearchClient>);

impl AgentSessionSearchIndex for OpenSearchAgentSessionIndex {
    async fn reconcile(
        &self,
        snapshot: SearchSnapshot,
        index_override: Option<&str>,
        version: ProjectionVersion,
    ) -> Result<ProjectionWrites, Report> {
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
            version: version.get(),
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
                    content: shown_text(&message.searchable_text()),
                })
                .collect(),
        };
        let writes = self
            .0
            .reconcile_agent_session(&args, index_override)
            .await?;
        Ok(ProjectionWrites {
            parent_written: writes.parent_written,
            messages_written: writes.messages_written,
            messages_unchanged: writes.messages_unchanged,
            messages_deleted: writes.messages_deleted,
        })
    }

    async fn delete(
        &self,
        id: AgentSessionId,
        index_override: Option<&str>,
        version: ProjectionVersion,
    ) -> Result<(), Report> {
        Ok(self
            .0
            .delete_agent_session(&id.to_string(), index_override, version.get())
            .await?)
    }
}

/// A message's text with its `<m-*>` chips written as text. Links and
/// mentions read as `PlainTextFormatter` writes them, as in agent
/// notifications; prompts and replies are prose, not valid markup
/// (`Vec<String>`, `a < b`), so they parse leniently, and from a tag that does
/// not parse the text up to the next paste stays as written. A paste reads as
/// its content.
fn shown_text(text: &str) -> String {
    with_pastes_as_content(text, |markup| {
        PlainTextFormatter::format_xml_text(ParsedXmlText::parse_lenient(markup)).0
    })
}

#[cfg(test)]
mod test;
