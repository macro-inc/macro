//! Membership policy: which entities may appear in the feed at all.
//!
//! The feed's reasons (outstanding attention, recent own work) come
//! from the candidate source; this policy only narrows candidates the way
//! Home's Signal view always has. Attention needs no content-age cutoff: a
//! new comment on a months-old document is current news.

use std::sync::Arc;

use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::{
    SharedEmailFilter,
    ast::{
        EmailFilterAst, EntityFilterAst,
        agent_session::{AgentSessionLiteral, AgentSessionVisibility},
        channel::ChannelThreadLiteral,
        document::DocumentLiteral,
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::models::{WorkFeedItemType, WorkFeedScope};

#[cfg(test)]
mod test;

/// The only foreign entities Home surfaces.
const GITHUB_PULL_REQUEST_SOURCE: &str = "github_pull_request";

/// The Signal membership filter for `user`.
///
/// - Email is Signal-classified and the viewer's own (not shared) mail;
///   Noise mail stays out even when the viewer touches it.
/// - Channel threads include the viewer as a participant.
/// - Pull requests include the viewer.
/// - Agent sessions are opted in (Soup excludes them by default), except
///   unlisted ones: a routine's runs, unless the routine lists them, live in
///   its history and the Agents list.
/// - Snippets are documents only when the caller shows them.
/// - Tasks are documents only when the scope asks for both; asking for one
///   of documents and tasks keeps the other out.
pub fn signal_filter(user: &MacroUserIdStr<'static>, scope: &WorkFeedScope) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: document_filter(scope).map(Arc::new),
        email_filter: EmailFilterAst {
            tree: Some(Arc::new(Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ))),
            crm_scope: None,
        },
        channel_thread_filter: Some(Arc::new(Expr::val(ChannelThreadLiteral::Participant(
            user.clone(),
        )))),
        foreign_entity_filter: Some(Arc::new(Expr::and(
            Expr::val(ForeignEntityLiteral::ForeignEntitySource(
                GITHUB_PULL_REQUEST_SOURCE.to_string(),
            )),
            Expr::val(ForeignEntityLiteral::IncludesMe),
        ))),
        agent_session_filter: Some(Arc::new(Expr::and(
            Expr::val(AgentSessionLiteral::Include),
            Expr::is_not(Expr::val(AgentSessionLiteral::Visibility(
                AgentSessionVisibility::Unlisted,
            ))),
        ))),
        ..Default::default()
    }
}

/// The document conditions of `scope`: snippets unless it shows them, and
/// the task subtype when it asks for only one of documents and tasks.
fn document_filter(scope: &WorkFeedScope) -> Option<Expr<DocumentLiteral>> {
    let requested: &[WorkFeedItemType] = if scope.types.is_empty() {
        &WorkFeedItemType::ALL
    } else {
        &scope.types
    };
    let is_task = || Expr::val(DocumentLiteral::SubType(DocumentSubType::Task));
    let tasks = match (
        requested.contains(&WorkFeedItemType::Document),
        requested.contains(&WorkFeedItemType::Task),
    ) {
        (true, false) => Some(Expr::is_not(is_task())),
        (false, true) => Some(is_task()),
        _ => None,
    };
    let snippets = (!scope.include_snippets).then(|| {
        Expr::is_not(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Snippet,
        )))
    });
    match (tasks, snippets) {
        (Some(tasks), Some(snippets)) => Some(Expr::and(tasks, snippets)),
        (tasks, snippets) => tasks.or(snippets),
    }
}

/// The candidate entity types for the requested item kinds, deduplicated in
/// request order; no kinds means every kind.
pub fn candidate_types(types: &[WorkFeedItemType]) -> Vec<EntityType> {
    let requested: &[WorkFeedItemType] = if types.is_empty() {
        &WorkFeedItemType::ALL
    } else {
        types
    };
    let mut entity_types = Vec::with_capacity(requested.len());
    for item_type in requested {
        let entity_type = item_type.entity_type();
        if !entity_types.contains(&entity_type) {
            entity_types.push(entity_type);
        }
    }
    entity_types
}
