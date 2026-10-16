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
        EmailFilterAst, EntityFilterAst, agent_session::AgentSessionLiteral,
        channel::ChannelThreadLiteral, document::DocumentLiteral, email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::models::WorkFeedItemType;

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
/// - Agent sessions are opted in (Soup excludes them by default).
/// - Snippets are documents only when the caller shows them.
pub fn signal_filter(user: &MacroUserIdStr<'static>, include_snippets: bool) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: (!include_snippets).then(|| {
            Arc::new(Expr::is_not(Expr::val(DocumentLiteral::SubType(
                DocumentSubType::Snippet,
            ))))
        }),
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
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
        ..Default::default()
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
