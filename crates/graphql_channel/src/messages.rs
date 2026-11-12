//! GraphQL reads of channel messages: timeline pages and the changes after
//! a sequence number.

mod objects;
mod reads;
#[cfg(test)]
mod test;

use async_graphql::{Context, Enum, ErrorExtensions, ID, InputObject, Object};
use chrono::{DateTime, Utc};
use graphql_common::parse_id;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::ports::{
    MessageCursor, MessageDirection, MessageError, MessageTimelineQuery, ReplyCursor,
    ThreadRepliesQuery,
};
use models_pagination::Base64Str;
use uuid::Uuid;

use self::reads::Reader;
pub use self::{
    objects::{
        GraphqlChannelBotProfile, GraphqlChannelCallState, GraphqlChannelCallStatus,
        GraphqlChannelChanges, GraphqlChannelImportedAuthor, GraphqlChannelMessage,
        GraphqlChannelMessageAttachment, GraphqlChannelMessageKind, GraphqlChannelMessageMention,
        GraphqlChannelMessageReaction, GraphqlChannelThreadPage, GraphqlChannelThreadSummary,
        GraphqlChannelTimelineActivity, GraphqlChannelTimelineCursor, GraphqlChannelTimelineEntry,
        GraphqlChannelTimelinePage,
    },
    reads::ChannelMessagesGraphqlContext,
};

/// Largest page a timeline read returns, the REST route's bound.
const MAX_PAGE_SIZE: i32 = 100;

/// Which side of a cursor a timeline page continues on.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "GraphqlChannelPageDirection")]
pub enum GraphqlChannelPageDirection {
    /// The newest rows, or those older than the cursor.
    Older,
    /// Rows newer than the cursor.
    Newer,
}

impl From<GraphqlChannelPageDirection> for MessageDirection {
    fn from(direction: GraphqlChannelPageDirection) -> Self {
        match direction {
            GraphqlChannelPageDirection::Older => Self::Older,
            GraphqlChannelPageDirection::Newer => Self::Newer,
        }
    }
}

/// Which page of a channel timeline to read. With neither a cursor nor
/// `around`, the latest page.
#[derive(InputObject, Default)]
#[graphql(name = "GraphqlChannelTimelineInput")]
pub struct GraphqlChannelTimelineInput {
    /// Continue from a cursor a previous page returned.
    pub cursor: Option<GraphqlChannelTimelineCursorInput>,
    /// Which side of the cursor to read; older when absent.
    pub direction: Option<GraphqlChannelPageDirection>,
    /// Center the page on the root containing this message. Cannot be
    /// combined with a cursor.
    pub around: Option<ID>,
    /// Page size, 1 to 100; 50 when absent.
    pub limit: Option<i32>,
}

impl GraphqlChannelTimelineInput {
    /// The domain selection this input asks for.
    fn into_query(self) -> async_graphql::Result<MessageTimelineQuery> {
        let limit = page_limit(self.limit)?;
        Ok(MessageTimelineQuery {
            cursor: self
                .cursor
                .map(GraphqlChannelTimelineCursorInput::into_cursor)
                .transpose()?,
            direction: self.direction.map(Into::into).unwrap_or_default(),
            around: self
                .around
                .map(|around| parse_id(around, "around"))
                .transpose()?,
            limit,
            ..MessageTimelineQuery::default()
        })
    }
}

/// A timeline position a previous page returned as a cursor.
#[derive(InputObject)]
#[graphql(name = "GraphqlChannelTimelineCursorInput")]
pub struct GraphqlChannelTimelineCursorInput {
    /// The cursor's `createdAt`.
    pub created_at: String,
    /// The cursor's `entryId`.
    pub entry_id: ID,
}

impl GraphqlChannelTimelineCursorInput {
    /// The domain cursor this input spells.
    fn into_cursor(self) -> async_graphql::Result<MessageCursor> {
        Ok(MessageCursor {
            created_at: DateTime::parse_from_rfc3339(&self.created_at)
                .map_err(|_| bad_input("cursor is invalid"))?
                .with_timezone(&Utc),
            id: parse_id(self.entry_id, "cursor.entryId")?,
        })
    }
}

/// Which window of a thread's replies to read. With neither a cursor nor
/// `around`, the newest replies.
#[derive(InputObject, Default)]
#[graphql(name = "GraphqlChannelThreadInput")]
pub struct GraphqlChannelThreadInput {
    /// Continue from a cursor a previous window returned.
    pub cursor: Option<String>,
    /// Which side of the cursor to read; older when absent. With no cursor,
    /// older reads the end of the thread and newer its start.
    pub direction: Option<GraphqlChannelPageDirection>,
    /// Center the window on this reply. Cannot be combined with a cursor.
    pub around: Option<ID>,
    /// Window size, 1 to 100; 50 when absent.
    pub limit: Option<i32>,
}

impl GraphqlChannelThreadInput {
    /// The domain selection this input asks for.
    fn into_query(self) -> async_graphql::Result<ThreadRepliesQuery> {
        Ok(ThreadRepliesQuery {
            cursor: self.cursor.map(decode_cursor::<ReplyCursor>).transpose()?,
            direction: self.direction.map(Into::into).unwrap_or_default(),
            around: self
                .around
                .map(|around| parse_id(around, "around"))
                .transpose()?,
            limit: page_limit(self.limit)?,
        })
    }
}

/// A page size the reads accept.
fn page_limit(limit: Option<i32>) -> async_graphql::Result<Option<u16>> {
    limit
        .map(|limit| {
            u16::try_from(limit)
                .ok()
                .filter(|limit| (1..=MAX_PAGE_SIZE).contains(&i32::from(*limit)))
                .ok_or_else(|| bad_input("limit must be between 1 and 100"))
        })
        .transpose()
}

/// The opaque spelling of a reply cursor.
pub(crate) fn encode_cursor<C: serde::Serialize>(cursor: C) -> String {
    Base64Str::encode_json(cursor).type_erase()
}

/// A cursor a previous page returned.
fn decode_cursor<C: serde::de::DeserializeOwned>(cursor: String) -> async_graphql::Result<C> {
    Base64Str::new_from_string(cursor)
        .decode_json()
        .map_err(|_| bad_input("cursor is invalid"))
}

/// A request the caller can correct.
fn bad_input(message: &'static str) -> async_graphql::Error {
    coded(message, "BAD_USER_INPUT")
}

/// An error carrying a machine-readable code.
fn coded(message: &'static str, code: &'static str) -> async_graphql::Error {
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}

/// The GraphQL error for a failed read, with the REST route's meanings.
fn read_error(error: MessageError) -> async_graphql::Error {
    match error {
        MessageError::NotFound => coded("channel or message not found", "NOT_FOUND"),
        MessageError::Forbidden => coded("forbidden", "FORBIDDEN"),
        MessageError::Invalid(message) => bad_input(message),
        MessageError::Conflict => coded("message id already exists", "CONFLICT"),
        MessageError::Busy => coded("too many writes at once; retry", "UNAVAILABLE"),
        MessageError::Repository(error) => {
            tracing::error!(error = ?error, "channel message read failed");
            coded("channel messages are unavailable", "INTERNAL_SERVER_ERROR")
        }
    }
}

/// Flattenable channel message field of the authenticated user.
pub struct GraphqlChannelMessagesQuery {
    /// The authenticated user.
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlChannelMessagesQuery {
    /// Channel message reads scoped to the authenticated `user_id`. The
    /// reads are resolved from request data per field.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

/// Channel message field of the authenticated user.
#[Object]
impl GraphqlChannelMessagesQuery {
    /// The messages of one channel. Each read under it checks that the
    /// user can view the channel.
    async fn channel_messages(
        &self,
        channel_id: ID,
    ) -> async_graphql::Result<GraphqlChannelMessages> {
        Ok(GraphqlChannelMessages {
            user_id: self.user_id.clone(),
            channel_id: parse_id(channel_id, "channelId")?,
        })
    }
}

/// The messages of one channel, as the authenticated user reads them. It
/// has the channel's id, so a client cache keeps one record per channel.
pub struct GraphqlChannelMessages {
    /// The authenticated user.
    user_id: MacroUserIdStr<'static>,
    /// The channel read.
    channel_id: Uuid,
}

impl GraphqlChannelMessages {
    /// The reader authorization sees for this request.
    fn reader(&self, context: &ChannelMessagesGraphqlContext) -> Reader {
        Reader {
            user_id: self.user_id.clone(),
            organization_id: context.organization_id,
        }
    }
}

/// The messages of one channel.
#[Object]
impl GraphqlChannelMessages {
    /// The channel's id.
    async fn id(&self) -> ID {
        ID(self.channel_id.to_string())
    }

    /// One page of the channel's timeline, oldest row first: root messages
    /// with their thread summaries, and the facts shown between them. `seq`
    /// is read before the rows, so `changes(since: seq)` returns everything
    /// the page can lack.
    #[tracing::instrument(skip_all, fields(channel_id = %self.channel_id), err(Debug))]
    async fn timeline(
        &self,
        ctx: &Context<'_>,
        input: Option<GraphqlChannelTimelineInput>,
    ) -> async_graphql::Result<GraphqlChannelTimelinePage> {
        let context = ctx.data::<ChannelMessagesGraphqlContext>()?;
        let query = input.unwrap_or_default().into_query()?;
        let read = context
            .reads
            .timeline(self.reader(context), self.channel_id, query)
            .await
            .map_err(read_error)?;
        Ok(GraphqlChannelTimelinePage {
            seq: read.seq,
            entries: read.page.entries.into_iter().map(Into::into).collect(),
            older_cursor: read.page.next_cursor.map(Into::into),
            newer_cursor: read.page.previous_cursor.map(Into::into),
        })
    }

    /// One window of a thread's live replies, in thread order, with the
    /// sequence number read before it. A window read without a cursor also
    /// returns the thread's root.
    #[tracing::instrument(
        skip_all,
        fields(channel_id = %self.channel_id, root_id = %root_id.as_str()),
        err(Debug)
    )]
    async fn thread(
        &self,
        ctx: &Context<'_>,
        root_id: ID,
        input: Option<GraphqlChannelThreadInput>,
    ) -> async_graphql::Result<GraphqlChannelThreadPage> {
        let context = ctx.data::<ChannelMessagesGraphqlContext>()?;
        let root = parse_id(root_id, "rootId")?;
        let query = input.unwrap_or_default().into_query()?;
        let read = context
            .reads
            .thread(self.reader(context), self.channel_id, root, query)
            .await
            .map_err(read_error)?;
        let root_entry = read.root.map(GraphqlChannelTimelineEntry::from);
        Ok(GraphqlChannelThreadPage {
            seq: read.seq,
            root_id: ID(root.to_string()),
            root: match root_entry {
                Some(GraphqlChannelTimelineEntry::Message(root)) => Some(root),
                Some(GraphqlChannelTimelineEntry::Activity(_)) | None => None,
            },
            replies: read
                .page
                .replies
                .into_iter()
                .map(GraphqlChannelMessage::reply)
                .collect(),
            older_cursor: read.page.older_cursor.map(encode_cursor),
            newer_cursor: read.page.newer_cursor.map(encode_cursor),
        })
    }

    /// What changed in the channel after sequence number `since`, as the
    /// current state of each changed message, or a reset when the log can
    /// no longer answer from there.
    #[tracing::instrument(skip_all, fields(channel_id = %self.channel_id, since), err(Debug))]
    async fn changes(
        &self,
        ctx: &Context<'_>,
        since: i64,
    ) -> async_graphql::Result<GraphqlChannelChanges> {
        let context = ctx.data::<ChannelMessagesGraphqlContext>()?;
        let changes = context
            .reads
            .changes(self.reader(context), self.channel_id, since)
            .await
            .map_err(read_error)?;
        Ok(changes.into())
    }
}
