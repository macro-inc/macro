//! Recognize the nil-primary-id filters clients use to exclude an entity type.
//! Prune these legs before calling their domain services, not after acquiring
//! database connections for queries that can only return an empty page.

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::{
    EntityFilterAst,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
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
