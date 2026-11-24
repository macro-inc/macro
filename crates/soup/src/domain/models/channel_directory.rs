//! The channel filters a channel directory page may carry: the shapes whose
//! channel query the request bounds, so a page can read the primary at the
//! cost of a page of the REST channel list.

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::channel::ChannelLiteral;
use recursion::CollapsibleExt;

use super::CHANNEL_DIRECTORY_PAGE_LIMIT;

/// The most participation states a channel directory filter may carry: the
/// web's "either" (`isParticipant` true or false) is two. Each one is a
/// membership check per candidate.
const PARTICIPATION_LITERALS: usize = 2;

/// What a channel filter admits, folded up from its literals.
#[derive(Clone, Copy)]
struct Shape {
    /// Only channels named by id can match.
    names_channels: bool,
    /// The number of channel id literals.
    ids: usize,
    /// The number of participation literals.
    participation: usize,
    /// Every literal is a channel id or a participation state.
    ids_and_participation_only: bool,
}

/// Whether `filter` keeps a channel page's query bounded by the request: no
/// filter (the channels the user joined, as the REST list reads them), or one
/// that admits only channels it names by id, at most
/// [`CHANNEL_DIRECTORY_PAGE_LIMIT`] of them, with nothing beside the ids but
/// at most [`PARTICIPATION_LITERALS`] participation states.
///
/// Anything else is refused: a participation filter that names no ids reads
/// every channel of the user's teams before its limit, a notification state
/// adds a check per candidate, and more ids or participation states than a
/// page needs cost planning, SQL and candidates the page size does not bound.
pub(super) fn bounded(filter: Option<&Expr<ChannelLiteral>>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let shape = filter.collapse_frames(|frame: ExprFrame<Shape, ChannelLiteral>| match frame {
        ExprFrame::Literal(literal) => Shape {
            names_channels: matches!(literal, ChannelLiteral::ChannelId(_)),
            ids: usize::from(matches!(literal, ChannelLiteral::ChannelId(_))),
            participation: usize::from(matches!(literal, ChannelLiteral::IsParticipant(_))),
            ids_and_participation_only: matches!(
                literal,
                ChannelLiteral::ChannelId(_) | ChannelLiteral::IsParticipant(_)
            ),
        },
        ExprFrame::And(a, b) => Shape {
            names_channels: a.names_channels || b.names_channels,
            ids: a.ids + b.ids,
            participation: a.participation + b.participation,
            ids_and_participation_only: a.ids_and_participation_only
                && b.ids_and_participation_only,
        },
        ExprFrame::Or(a, b) => Shape {
            names_channels: a.names_channels && b.names_channels,
            ids: a.ids + b.ids,
            participation: a.participation + b.participation,
            ids_and_participation_only: a.ids_and_participation_only
                && b.ids_and_participation_only,
        },
        ExprFrame::Not(a) => Shape {
            names_channels: false,
            ..a
        },
    });
    shape.names_channels
        && shape.ids_and_participation_only
        && shape.ids <= usize::from(CHANNEL_DIRECTORY_PAGE_LIMIT)
        && shape.participation <= PARTICIPATION_LITERALS
}
