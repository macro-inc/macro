//! Membership policy: which groups may appear in the inbox at all.
//!
//! Rows come from the viewer's pending notifications; this policy narrows
//! the entities they are filed under the way the inbox promises, and Soup's
//! access gates drop anything the viewer can no longer open.

use std::sync::Arc;

use filter_ast::Expr;
use item_filters::{
    SharedEmailFilter,
    ast::{
        EmailFilterAst, EntityFilterAst,
        agent_session::{AgentSessionLiteral, AgentSessionVisibility},
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
        initiative::InitiativeLiteral,
    },
};
use model_entity::EntityType;

#[cfg(test)]
mod test;

/// The only foreign entities the inbox lists.
const GITHUB_PULL_REQUEST_SOURCE: &str = "github_pull_request";

/// The entities inbox groups are filed under. Channel threads are never
/// their own group: a channel's group holds its threads.
pub const CANDIDATE_TYPES: [EntityType; 11] = [
    EntityType::Document,
    EntityType::Chat,
    EntityType::Project,
    EntityType::EmailThread,
    EntityType::Channel,
    EntityType::CalendarEvent,
    EntityType::ForeignEntity,
    EntityType::AgentSession,
    EntityType::Initiative,
    EntityType::CrmCompany,
    EntityType::CrmContact,
];

/// The inbox membership filter.
///
/// - Email is Signal-classified and the viewer's own (not shared) mail.
/// - Pull requests include the viewer.
/// - Agent sessions are opted in (Soup excludes them by default), except
///   unlisted ones, whose runs live in their routine's history.
/// - Projects (initiatives) are opted in, so their discussions are listed.
/// - Snippets are documents like any other.
pub fn inbox_filter() -> EntityFilterAst {
    EntityFilterAst {
        email_filter: EmailFilterAst {
            tree: Some(Arc::new(Expr::and(
                Expr::val(EmailLiteral::Importance(true)),
                Expr::val(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ))),
            crm_scope: None,
        },
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
        initiative_filter: Some(Arc::new(Expr::val(InitiativeLiteral::Include))),
        ..Default::default()
    }
}
