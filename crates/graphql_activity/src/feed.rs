use std::num::NonZeroU32;

use async_graphql::{Context, InputObject, SimpleObject};
use bot_id::BotIdStr;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Base64Str, CursorVal, CursorWithVal, Sortable};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{loaders::ActivityFeedReader, objects::GraphqlActivityEvent};

#[cfg(test)]
mod test;

/// Items returned by the activity feed when no limit is given.
pub const DEFAULT_ACTIVITY_FEED_LIMIT: i32 = 25;
/// Most items one activity feed page may return.
pub const MAX_ACTIVITY_FEED_LIMIT: i32 = 100;

/// The feed's sort key: when the activity occurred.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct OccurredAt;

impl Sortable for OccurredAt {
    type Value = DateTime<Utc>;
}

/// The feed's opaque cursor payload: the `(occurred_at, id)` keyset position
/// of the last item on the previous page.
type ActivityFeedCursor = CursorWithVal<Uuid, OccurredAt>;

/// Page request for the authenticated user's activity feed.
#[derive(InputObject)]
pub struct ActivityFeedInput {
    /// Opaque cursor from the previous page's `nextCursor`; absent for the
    /// first page.
    pub cursor: Option<String>,
    /// Page size; defaults to 25, capped at 100.
    pub limit: Option<i32>,
}

/// One page of the authenticated user's activity, newest first.
#[derive(SimpleObject)]
pub struct GraphqlActivityPage {
    /// The page's activity events.
    pub items: Vec<GraphqlActivityEvent>,
    /// Cursor for the next page; absent when this page reached the end.
    pub next_cursor: Option<String>,
}

/// Validate a feed limit argument and apply the default.
fn parse_feed_limit(limit: Option<i32>) -> async_graphql::Result<NonZeroU32> {
    let limit =
        graphql_common::parse_limit(limit, DEFAULT_ACTIVITY_FEED_LIMIT, MAX_ACTIVITY_FEED_LIMIT)?;
    Ok(NonZeroU32::new(limit).expect("parse_limit rejects zero"))
}

/// Decode an opaque feed cursor into its keyset position.
fn decode_cursor(cursor: String) -> async_graphql::Result<(DateTime<Utc>, Uuid)> {
    let cursor = Base64Str::<ActivityFeedCursor>::new_from_string(cursor)
        .decode_json()
        .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
    Ok((cursor.val.last_val, cursor.id))
}

/// Encode a keyset position as an opaque cursor.
fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid, limit: u32) -> String {
    Base64Str::encode_json(ActivityFeedCursor {
        id,
        limit: limit as usize,
        val: CursorVal {
            sort_type: OccurredAt,
            last_val: occurred_at,
        },
        filter: (),
    })
    .type_erase()
}

/// Resolve one page of the authenticated user's activity feed, newest first.
///
/// The subject is the viewer's principal string, so delegated actions a bot
/// performed on the user's behalf appear in the user's own feed. Pagination
/// follows the page's `next` position, which storage derives from raw rows —
/// a corrupt row shrinks a page but never ends the feed.
pub async fn resolve_activity_feed<R>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    input: ActivityFeedInput,
) -> async_graphql::Result<GraphqlActivityPage>
where
    R: ActivityFeedReader,
{
    let reader = ctx.data::<R>()?;
    let limit = parse_feed_limit(input.limit)?;
    let cursor = input.cursor.map(decode_cursor).transpose()?;

    let page = reader
        .subject_feed(user_id.as_ref(), cursor, limit)
        .await
        .map_err(|_| async_graphql::Error::new("activity feed is unavailable"))?;

    Ok(GraphqlActivityPage {
        items: page.records.into_iter().map(Into::into).collect(),
        next_cursor: page
            .next
            .map(|(occurred_at, id)| encode_cursor(occurred_at, id, limit.get())),
    })
}

/// Whether the viewer may read `actor_id`'s mechanical activity.
///
/// Allowed for the viewer's own principal, or a first-party Macro bot.
pub fn actor_feed_is_visible(viewer: &MacroUserIdStr<'_>, actor_id: &str) -> bool {
    if actor_id == viewer.as_ref() {
        return true;
    }
    BotIdStr::parse_from_str(actor_id).is_ok_and(|bot| bot.bot_id().is_first_party())
}

/// Resolve one page of a mechanical actor's activity.
///
/// Rejects actor ids the viewer is not allowed to inspect.
pub async fn resolve_actor_activity<R>(
    ctx: &Context<'_>,
    viewer: &MacroUserIdStr<'static>,
    actor_id: String,
    input: ActivityFeedInput,
) -> async_graphql::Result<GraphqlActivityPage>
where
    R: ActivityFeedReader,
{
    if !actor_feed_is_visible(viewer, &actor_id) {
        return Err(async_graphql::Error::new(
            "actor activity is only available for the viewer or a Macro system bot",
        ));
    }

    let reader = ctx.data::<R>()?;
    let limit = parse_feed_limit(input.limit)?;
    let cursor = input.cursor.map(decode_cursor).transpose()?;

    let page = reader
        .actor_feed(&actor_id, cursor, limit)
        .await
        .map_err(|_| async_graphql::Error::new("activity feed is unavailable"))?;

    Ok(GraphqlActivityPage {
        items: page.records.into_iter().map(Into::into).collect(),
        next_cursor: page
            .next
            .map(|(occurred_at, id)| encode_cursor(occurred_at, id, limit.get())),
    })
}
