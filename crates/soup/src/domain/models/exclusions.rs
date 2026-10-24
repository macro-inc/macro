//! Recognize the nil-primary-id filters clients use to exclude an entity type.
//! Prune these legs before calling their domain services, not after acquiring
//! database connections for queries that can only return an empty page.

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
};
use recursion::CollapsibleExt;

/// Only prove exclusions: an unknown literal or a negation may still match.
/// In particular, `nil OR real_id` must never suppress the whole request.
fn excludes_all<L: Clone>(tree: Option<&Expr<L>>, excludes: impl Fn(L) -> bool) -> bool {
    tree.is_some_and(|tree| {
        tree.collapse_frames(|frame| match frame {
            ExprFrame::And(a, b) => a || b,
            ExprFrame::Or(a, b) => a && b,
            ExprFrame::Not(_) => false,
            ExprFrame::Literal(literal) => excludes(literal),
        })
    })
}

pub(super) fn email(filter: Option<&EntityFilterAst>) -> bool {
    excludes_all(
        filter.and_then(|filter| filter.email_filter.tree.as_deref()),
        |literal| matches!(literal, EmailLiteral::ThreadId(id) if id.is_nil()),
    )
}

pub(super) fn channel(filter: Option<&EntityFilterAst>) -> bool {
    excludes_all(
        filter.and_then(|filter| filter.channel_filter.as_deref()),
        |literal| matches!(literal, ChannelLiteral::ChannelId(id) if id.is_nil()),
    )
}

pub(super) fn channel_thread(filter: Option<&EntityFilterAst>) -> bool {
    excludes_all(
        filter.and_then(|filter| filter.channel_thread_filter.as_deref()),
        |literal| matches!(literal, ChannelThreadLiteral::ThreadId(id) if id.is_nil()),
    )
}

pub(super) fn call(filter: Option<&EntityFilterAst>) -> bool {
    excludes_all(
        filter.and_then(|filter| filter.call_filter.as_deref()),
        |literal| matches!(literal, CallLiteral::CallId(id) if id.is_nil()),
    )
}

pub(super) fn foreign_entity(filter: Option<&EntityFilterAst>) -> bool {
    excludes_all(
        filter.and_then(|filter| filter.foreign_entity_filter.as_deref()),
        |literal| matches!(literal, ForeignEntityLiteral::Id(id) if id.is_nil()),
    )
}

/// Accept disabled entity legs without ignoring any active non-task filter.
pub(crate) fn non_task_filters_are_exclusions(ast: &EntityFilterAst) -> bool {
    (ast.calendar_event_filter.is_none()
        || excludes_all(
            ast.calendar_event_filter.as_deref(),
            |literal| matches!(literal, CalendarEventLiteral::Id(id) if id.is_nil()),
        ))
        && (ast.project_filter.is_none()
            || excludes_all(
                ast.project_filter.as_deref(),
                |literal| matches!(literal, ProjectLiteral::ProjectIdSelf(id) if id.is_nil()),
            ))
        && (ast.chat_filter.is_none()
            || excludes_all(
                ast.chat_filter.as_deref(),
                |literal| matches!(literal, ChatLiteral::ChatId(id) if id.is_nil()),
            ))
        && (ast.email_filter.tree.is_none() || email(Some(ast)))
        && (ast.channel_filter.is_none() || channel(Some(ast)))
        && (ast.channel_thread_filter.is_none() || channel_thread(Some(ast)))
        && (ast.call_filter.is_none() || call(Some(ast)))
        && (ast.crm_company_filter.is_none()
            || excludes_all(
                ast.crm_company_filter.as_deref(),
                |literal| matches!(literal, CrmCompanyLiteral::Id(id) if id.is_nil()),
            ))
        && (ast.foreign_entity_filter.is_none() || foreign_entity(Some(ast)))
        && ast.crm_contact_filter.is_none()
        && ast.github_pull_request_filter.is_none()
        && ast.agent_session_filter.is_none()
        && ast.initiative_filter.is_none()
        && ast.database_row_filter.is_none()
}
