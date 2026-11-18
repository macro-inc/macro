//! OpenSearch adapter for the agent-session indexing domain port.

use agent_fold::domain::model::Author;
use agent_session::domain::{model::AgentSessionId, search::indexing::SearchSnapshot};
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_until},
    combinator::{consumed, opt, recognize, rest, verify},
    multi::many0,
    sequence::delimited,
};
use opensearch_client::{
    OpensearchClient,
    agent_session::{
        AgentSessionMessageAuthor, AgentSessionMessageDocument, ReconcileAgentSessionArgs,
    },
};
use rootcause::Report;
use std::sync::Arc;

use crate::domain::agent_session_index::{
    AgentSessionSearchIndex, ProjectionVersion, ProjectionWrites,
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

const PASTE_OPEN: &str = "<m-paste>";
const PASTE_CLOSE: &str = "</m-paste>";

/// A message's text with its `<m-*>` chips written as text. Links and
/// mentions read as `PlainTextFormatter` writes them, as in agent
/// notifications; prompts and replies are prose, not valid markup
/// (`Vec<String>`, `a < b`), so they parse leniently, and from the first tag
/// that does not parse the rest stays as written. A paste (a long pasted text
/// or a quoted reply) reads as its content, which that formatter would drop
/// with the tags it does not know.
fn shown_text(text: &str) -> String {
    let Ok((_, pieces)) = many0(piece).parse(text) else {
        return flattened(text);
    };
    pieces
        .into_iter()
        .map(|piece| match piece {
            Piece::Markup(markup) => flattened(markup),
            Piece::Paste(content) => content,
            Piece::Malformed(block) => block.to_owned(),
        })
        .collect()
}

fn flattened(markup: &str) -> String {
    PlainTextFormatter::format_xml_text(ParsedXmlText::parse_lenient(markup)).0
}

enum Piece<'a> {
    Markup(&'a str),
    Paste(String),
    /// A paste whose JSON does not parse, kept as written.
    Malformed(&'a str),
}

/// A paste, or the markup up to the next one.
fn piece(input: &str) -> IResult<&str, Piece<'_>> {
    alt((
        paste,
        verify(
            recognize((opt(tag(PASTE_OPEN)), alt((take_until(PASTE_OPEN), rest)))),
            |markup: &str| !markup.is_empty(),
        )
        .map(Piece::Markup),
    ))
    .parse(input)
}

#[derive(serde::Deserialize)]
struct Paste {
    content: String,
}

/// `<m-paste>{"content": ...}</m-paste>`. The editor escapes `<` and `>` in
/// the JSON, so the first closing tag ends it.
fn paste(input: &str) -> IResult<&str, Piece<'_>> {
    consumed(delimited(
        tag(PASTE_OPEN),
        take_until(PASTE_CLOSE),
        tag(PASTE_CLOSE),
    ))
    .map(
        |(block, json): (&str, &str)| match serde_json::from_str::<Paste>(json) {
            Ok(paste) => Piece::Paste(paste.content),
            Err(_) => Piece::Malformed(block),
        },
    )
    .parse(input)
}

#[cfg(test)]
mod test;
