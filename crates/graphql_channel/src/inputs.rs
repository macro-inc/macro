//! Channel read inputs and lossless keyset cursors.
use async_graphql::{ID, InputObject};
use chrono::DateTime;
use messages::domain::ports::{
    MessageCursor, MessageDirection, MessageReplyCursor, MessageThreadQuery, MessageTimelineQuery,
};
use nom::{
    Parser,
    branch::alt,
    bytes::complete::tag,
    character::complete::digit1,
    combinator::{all_consuming, rest},
    sequence::separated_pair,
};
use uuid::Uuid;

use crate::bad_input;

#[cfg(test)]
mod test;

/// A bounded channel timeline selection; choose at most one position.
#[derive(InputObject)]
pub struct ChannelTimelineInput {
    /// Channel to read under the viewer's current access.
    pub channel_id: ID,
    /// Page size, default 50 and clamped to 1 through 100.
    pub limit: Option<i32>,
    /// Return entries strictly older than this timeline sort key.
    pub before: Option<String>,
    /// Return entries strictly newer than this timeline sort key.
    pub after: Option<String>,
    /// Center the window on a message; replies resolve to their root.
    pub around: Option<ID>,
}

impl ChannelTimelineInput {
    /// Validate the transport selection and use the same query as REST.
    pub(crate) fn into_query(self) -> async_graphql::Result<(Uuid, MessageTimelineQuery)> {
        validate_positions(&self.before, &self.after, &self.around)?;
        let channel = crate::parse_read_id(self.channel_id, "channelId")?;
        let direction = if self.after.is_some() {
            MessageDirection::Newer
        } else {
            MessageDirection::Older
        };
        let cursor = self
            .before
            .or(self.after)
            .map(|key| decode_cursor(&key))
            .transpose()?;
        Ok((
            channel,
            MessageTimelineQuery {
                cursor,
                direction,
                around: self
                    .around
                    .map(|id| crate::parse_read_id(id, "around"))
                    .transpose()?,
                limit: Some(page_limit(self.limit)),
                ..Default::default()
            },
        ))
    }
}

/// A bounded window of a channel thread's live replies.
#[derive(InputObject)]
pub struct ChannelThreadInput {
    /// Channel containing the thread.
    pub channel_id: ID,
    /// Root message identity.
    pub root_id: ID,
    /// Page size, default 50 and clamped to 1 through 100.
    pub limit: Option<i32>,
    /// Replies strictly before this reply sort key in display order.
    pub before: Option<String>,
    /// Replies strictly after this reply sort key in display order.
    pub after: Option<String>,
    /// Center the window on this reply.
    pub around: Option<ID>,
}

impl ChannelThreadInput {
    /// Validate and preserve the domain's import-aware reply ordering.
    pub(crate) fn into_query(self) -> async_graphql::Result<(Uuid, Uuid, MessageThreadQuery)> {
        validate_positions(&self.before, &self.after, &self.around)?;
        let channel = crate::parse_read_id(self.channel_id, "channelId")?;
        let root = crate::parse_read_id(self.root_id, "rootId")?;
        let direction = if self.before.is_some() {
            MessageDirection::Older
        } else {
            MessageDirection::Newer
        };
        let cursor = self
            .before
            .or(self.after)
            .map(|key| decode_reply_cursor(&key))
            .transpose()?;
        Ok((
            channel,
            root,
            MessageThreadQuery {
                cursor,
                direction,
                around: self
                    .around
                    .map(|id| crate::parse_read_id(id, "around"))
                    .transpose()?,
                limit: Some(page_limit(self.limit)),
            },
        ))
    }
}

/// Read changes strictly after the client's last applied channel sequence.
#[derive(InputObject)]
pub struct ChannelChangesInput {
    /// Channel to synchronize.
    pub channel_id: ID,
    /// Last applied nonnegative decimal sequence number.
    pub after: String,
}

/// Clamp before converting so a negative GraphQL Int cannot wrap.
fn page_limit(limit: Option<i32>) -> u16 {
    limit.unwrap_or(50).clamp(1, 100) as u16
}

/// Reject ambiguous windows rather than silently choosing a position.
fn validate_positions(
    before: &Option<String>,
    after: &Option<String>,
    around: &Option<ID>,
) -> async_graphql::Result<()> {
    if usize::from(before.is_some()) + usize::from(after.is_some()) + usize::from(around.is_some())
        > 1
    {
        return Err(bad_input("choose at most one of before, after, or around"));
    }
    Ok(())
}

/// Microsecond timestamp and lowercase UUID; channel data uses post-epoch times.
/// Unexpected pre-epoch values clamp to zero to keep the encoder total.
pub(crate) fn encode_cursor(cursor: &MessageCursor) -> String {
    format!(
        "{:020}-{}",
        cursor.created_at.timestamp_micros().max(0),
        cursor.id
    )
}

/// Parse only the canonical cursor shape emitted by this adapter.
fn decode_cursor(key: &str) -> async_graphql::Result<MessageCursor> {
    let parsed: nom::IResult<&str, (&str, &str)> =
        all_consuming(separated_pair(digit1, tag("-"), rest)).parse(key);
    let (_, (micros, id)) = parsed.map_err(|_| bad_input("invalid timeline cursor"))?;
    let micros: i64 = micros
        .parse()
        .map_err(|_| bad_input("invalid timeline cursor"))?;
    let cursor = MessageCursor {
        created_at: DateTime::from_timestamp_micros(micros)
            .ok_or_else(|| bad_input("invalid timeline cursor"))?,
        id: id
            .parse()
            .map_err(|_| bad_input("invalid timeline cursor"))?,
    };
    if encode_cursor(&cursor) != key {
        return Err(bad_input("invalid timeline cursor"));
    }
    Ok(cursor)
}

/// Nonnegative import order sorts before unimported replies, as SQL NULLS LAST does.
/// Unexpected negative positions clamp to zero.
pub(crate) fn encode_reply_cursor(cursor: &MessageReplyCursor) -> String {
    let prefix = cursor
        .import_order
        .map(|value| format!("{:020}", value.max(0)))
        .unwrap_or_else(|| "~".to_owned());
    format!(
        "{prefix}-{}",
        encode_cursor(&MessageCursor {
            created_at: cursor.created_at,
            id: cursor.id
        })
    )
}

/// Recover the import-order prefix and chronological tie-breaker without loss.
fn decode_reply_cursor(key: &str) -> async_graphql::Result<MessageReplyCursor> {
    let parsed: nom::IResult<&str, (&str, &str)> =
        all_consuming(separated_pair(alt((tag("~"), digit1)), tag("-"), rest)).parse(key);
    let (_, (prefix, position)) = parsed.map_err(|_| bad_input("invalid reply cursor"))?;
    let import_order = if prefix == "~" {
        None
    } else {
        Some(
            prefix
                .parse::<i64>()
                .map_err(|_| bad_input("invalid reply cursor"))?,
        )
    };
    let position = decode_cursor(position)?;
    let cursor = MessageReplyCursor {
        import_order,
        created_at: position.created_at,
        id: position.id,
    };
    if encode_reply_cursor(&cursor) != key {
        return Err(bad_input("invalid reply cursor"));
    }
    Ok(cursor)
}
