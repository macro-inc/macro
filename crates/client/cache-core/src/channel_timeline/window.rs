//! Pure page-window logic shared by every storage adapter and the engine.

use super::{
    ChannelTimelineRequest, ChannelTimelineResult, ChannelTimelineRow, ChannelTimelineSnapshot,
    MESSAGE_TYPENAME, TIMELINE_HEAD, TIMELINE_START, TimelineScope, TimelineSpan, covering_span,
};
use crate::value::EntityKey;
use std::collections::HashMap;

/// Where storage reads the rows of one page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowPlan {
    /// The fetched stretch holding the window's anchor.
    pub span: TimelineSpan,
    /// The anchor: older rows lie in `[span.start, position)`, newer rows in
    /// `(position, span.end]`.
    pub position: String,
    /// Rows to read on each side: one more than the page size, so the page
    /// knows whether the stretch continues.
    pub read_limit: usize,
    /// Whether the page needs rows older than the anchor.
    pub read_older: bool,
    /// Whether the page needs rows newer than the anchor.
    pub read_newer: bool,
}

/// The message whose row anchors an `around` read: a reply read in the
/// channel's timeline is anchored on its root.
pub fn anchor_root_key(
    request: &ChannelTimelineRequest,
    row: &ChannelTimelineRow,
) -> Option<EntityKey<'static>> {
    match (&request.thread_root_id, &row.scope) {
        (None, TimelineScope::Thread(root_id)) => {
            Some(EntityKey::entity(MESSAGE_TYPENAME, &[root_id]))
        }
        _ => None,
    }
}

/// Decides which stored rows answer `request`, given the resolved anchor row
/// of an `around` read and the fetched stretches of the request's scope.
/// `None` means the cache cannot answer: the anchor is unknown, hidden, in
/// another list, or outside everything fetched.
pub fn plan_window(
    request: &ChannelTimelineRequest,
    anchor: Option<&ChannelTimelineRow>,
    spans: &[TimelineSpan],
) -> Option<WindowPlan> {
    let (position, read_older, read_newer) = match (&request.before, &request.after) {
        (Some(before), _) => (before.clone(), true, false),
        (None, Some(after)) => (after.clone(), false, true),
        (None, None) if request.around.is_some() => {
            let anchor = anchor.filter(|row| !row.hidden && row.scope == request.scope())?;
            (anchor.sort_key.clone(), true, true)
        }
        (None, None) => (TIMELINE_HEAD.to_owned(), true, false),
    };
    let span = covering_span(spans, &position)?.clone();
    Some(WindowPlan {
        span,
        position,
        read_limit: usize::from(request.limit) + 1,
        read_older,
        read_newer,
    })
}

/// Builds the page from one storage snapshot and the optimistic overlay.
///
/// `overlay` maps every message touched by a pending optimistic mutation to
/// its composed row (`None` when the composed record is not a timeline
/// entry); those replace the stored rows of the same keys.
pub fn compose_channel_window(
    request: &ChannelTimelineRequest,
    snapshot: ChannelTimelineSnapshot,
    overlay: &HashMap<EntityKey<'static>, Option<ChannelTimelineRow>>,
) -> ChannelTimelineResult {
    let seq = snapshot.seq.map(|seq| seq.to_string());
    let miss = |seq: Option<String>| ChannelTimelineResult {
        seq,
        ..ChannelTimelineResult::default()
    };
    let Some(span) = snapshot.span else {
        return miss(seq);
    };
    let scope = request.scope();
    let limit = usize::from(request.limit);
    let around = request.around.is_some();

    let mut optimistic = false;
    let anchor = match snapshot.anchor {
        Some(stored) if around => match overlay.get(&stored.record_key) {
            None => Some(stored),
            Some(Some(row))
                if !row.hidden && row.scope == scope && row.sort_key == stored.sort_key =>
            {
                optimistic = true;
                Some(row.clone())
            }
            // The pending mutation removed or moved the anchor.
            Some(_) => return miss(seq),
        },
        Some(_) | None if around => return miss(seq),
        _ => None,
    };
    let position = match (&anchor, &request.before, &request.after) {
        (Some(anchor), _, _) => anchor.sort_key.clone(),
        (None, Some(before), _) => before.clone(),
        (None, None, Some(after)) => after.clone(),
        (None, None, None) => TIMELINE_HEAD.to_owned(),
    };

    let older_truncated = snapshot.older.len() > limit;
    let newer_truncated = snapshot.newer.len() > limit;
    let mut older = snapshot.older;
    let mut newer = snapshot.newer;
    if !overlay.is_empty() {
        // An overlay row beyond the last stored row read belongs to a later page.
        let older_floor = older_truncated
            .then(|| older.last().map(|row| row.sort_key.clone()))
            .flatten()
            .unwrap_or_else(|| span.start.clone());
        let newer_ceiling = newer_truncated
            .then(|| newer.last().map(|row| row.sort_key.clone()))
            .flatten()
            .unwrap_or_else(|| span.end.clone());
        let before = older.len() + newer.len();
        older.retain(|row| !overlay.contains_key(&row.record_key));
        newer.retain(|row| !overlay.contains_key(&row.record_key));
        optimistic |= before != older.len() + newer.len();
        let anchor_key = anchor.as_ref().map(|row| &row.record_key);
        for row in overlay.values().flatten() {
            if row.hidden || row.scope != scope || Some(&row.record_key) == anchor_key {
                continue;
            }
            let key = row.sort_key.as_str();
            if key < position.as_str() && key >= older_floor.as_str() {
                older.push(row.clone());
                optimistic = true;
            } else if key > position.as_str() && key <= newer_ceiling.as_str() {
                newer.push(row.clone());
                optimistic = true;
            }
        }
        older.sort_by(|left, right| right.sort_key.cmp(&left.sort_key));
        newer.sort_by(|left, right| left.sort_key.cmp(&right.sort_key));
    }

    let (older_limit, newer_limit) = if around {
        let older_limit = limit / 2;
        (older_limit, limit.saturating_sub(older_limit + 1))
    } else if request.after.is_some() {
        (0, limit)
    } else {
        (limit, 0)
    };
    let more_older = older_truncated || older.len() > older_limit;
    let more_newer = newer_truncated || newer.len() > newer_limit;
    older.truncate(older_limit);
    newer.truncate(newer_limit);

    let reaches_start = span.start == TIMELINE_START && !more_older;
    let reaches_head = span.end == TIMELINE_HEAD && !more_newer;
    // An empty page that stops at the edge of what was fetched says nothing
    // about what lies beyond it: the server has to answer.
    if !around {
        let edge_reached = if request.after.is_some() {
            reaches_head
        } else {
            reaches_start
        };
        if older.is_empty() && newer.is_empty() && !edge_reached {
            return miss(seq);
        }
    }

    let oldest = older
        .last()
        .or(anchor.as_ref())
        .or(newer.first())
        .map_or_else(|| position.clone(), |row| row.sort_key.clone());
    let newest = newer
        .last()
        .or(anchor.as_ref())
        .or(older.first())
        .map_or_else(|| position.clone(), |row| row.sort_key.clone());
    // A `before` page always has its cursor's entry above it, and an `after`
    // page its cursor's entry below it.
    let older_cursor = (request.after.is_some() || !reaches_start).then_some(oldest);
    let newer_cursor = (request.before.is_some()
        || ((around || request.after.is_some()) && !reaches_head))
        .then_some(newest);

    let keys = newer
        .into_iter()
        .rev()
        .chain(anchor)
        .chain(older)
        .map(|row| row.record_key)
        .collect();
    ChannelTimelineResult {
        covered: true,
        keys,
        older_cursor,
        newer_cursor,
        seq,
        optimistic,
    }
}
