//! Authenticated user's channel reads, flattened into the composed schema.
use async_graphql::{Context, ID, Object};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::ports::{MessageRead, MessageTimelineEntry};
use tracing::Instrument;

use crate::{ChannelGraphqlContext, inputs::*, message_error, objects::*};

/// Channel fields scoped to the authenticated user.
pub struct GraphqlChannelQuery {
    /// Authenticated viewer; never supplied by a query argument.
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlChannelQuery {
    /// Construct the user's lazy channel read fields.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

#[Object]
impl GraphqlChannelQuery {
    /// Channel roots and activity in the same newest-first window as REST.
    #[tracing::instrument(
        name = "channel.timeline",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, page_size = tracing::field::Empty, entry_count = tracing::field::Empty)
    )]
    async fn channel_timeline(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Timeline page selection.")] input: ChannelTimelineInput,
    ) -> async_graphql::Result<GraphqlChannelTimelinePage> {
        let (channel_id, query) = input.into_query()?;
        tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
        tracing::Span::current().record("page_size", i64::from(query.limit.unwrap_or(50)));
        let reads = ctx.data::<ChannelGraphqlContext>()?;
        let access = reads
            .authorize(self.user_id.clone(), channel_id)
            .instrument(tracing::info_span!("channel.timeline.authorize"))
            .await?;
        let seq = reads
            .channel_seq(access.clone(), channel_id)
            .instrument(tracing::info_span!("channel.timeline.sequence"))
            .await?;
        let page = reads
            .messages
            .timeline_entries(access, query)
            .instrument(tracing::info_span!("channel.timeline.read"))
            .await
            .map_err(message_error)?;
        tracing::Span::current().record("entry_count", page.entries.len() as i64);
        Ok(
            tracing::info_span!("channel.timeline.map").in_scope(|| GraphqlChannelTimelinePage {
                entries: page
                    .entries
                    .into_iter()
                    .map(|entry| GraphqlChannelTimelineEntry::from_entry(entry, channel_id))
                    .collect(),
                older_cursor: page.next_cursor.as_ref().map(encode_cursor),
                newer_cursor: page.previous_cursor.as_ref().map(encode_cursor),
                seq,
            }),
        )
    }

    /// A bounded window of live replies using the REST thread's display order.
    #[tracing::instrument(
        name = "channel.thread",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, root_id = tracing::field::Empty, page_size = tracing::field::Empty, reply_count = tracing::field::Empty)
    )]
    async fn channel_thread(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Thread reply page selection.")] input: ChannelThreadInput,
    ) -> async_graphql::Result<GraphqlChannelThreadPage> {
        let (channel_id, root_id, query) = input.into_query()?;
        tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
        tracing::Span::current().record("root_id", tracing::field::display(root_id));
        tracing::Span::current().record("page_size", i64::from(query.limit.unwrap_or(50)));
        let reads = ctx.data::<ChannelGraphqlContext>()?;
        let access = reads.authorize(self.user_id.clone(), channel_id).await?;
        let seq = reads.channel_seq(access.clone(), channel_id).await?;
        let page = reads
            .messages
            .thread_page(access, root_id, query)
            .await
            .map_err(message_error)?;
        tracing::Span::current().record("reply_count", page.replies.len() as i64);
        Ok(GraphqlChannelThreadPage {
            root: GraphqlChannelMessage::from_item(page.root, channel_id, page.call),
            replies: page
                .replies
                .into_iter()
                .map(|message| GraphqlChannelMessage::from_message(message, channel_id))
                .collect(),
            older_cursor: page.next_cursor.as_ref().map(encode_reply_cursor),
            newer_cursor: page.previous_cursor.as_ref().map(encode_reply_cursor),
            seq,
        })
    }

    /// One message under channel view access, with the channel sequence read
    /// before it; a missing message answers the sequence alone.
    #[tracing::instrument(
        name = "channel.message",
        skip_all,
        err(Debug),
        fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty, found = tracing::field::Empty)
    )]
    async fn channel_message(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Channel containing the message.")] channel_id: ID,
        #[graphql(desc = "Message identity to read.")] message_id: ID,
    ) -> async_graphql::Result<GraphqlChannelMessageRead> {
        let channel_id = crate::parse_read_id(channel_id, "channelId")?;
        let message_id = crate::parse_read_id(message_id, "messageId")?;
        tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
        tracing::Span::current().record("message_id", tracing::field::display(message_id));
        let reads = ctx.data::<ChannelGraphqlContext>()?;
        let access = reads.authorize(self.user_id.clone(), channel_id).await?;
        let seq = reads.channel_seq(access.clone(), channel_id).await?;
        let message = match reads.messages.get_entry(access, message_id).await {
            Ok(MessageRead::Reply(message)) => {
                Some(GraphqlChannelMessage::from_message(message, channel_id))
            }
            Ok(MessageRead::Root(MessageTimelineEntry::Message { message })) => {
                Some(GraphqlChannelMessage::from_item(*message, channel_id, None))
            }
            Ok(MessageRead::Root(MessageTimelineEntry::Call { message, status })) => Some(
                GraphqlChannelMessage::from_item(*message, channel_id, Some(status)),
            ),
            Ok(MessageRead::Root(MessageTimelineEntry::Activity { .. })) => {
                return Err(crate::bad_input("expected a message"));
            }
            Err(messages::domain::ports::MessageError::NotFound) => None,
            Err(error) => return Err(message_error(error)),
        };
        tracing::Span::current().record("found", message.is_some());
        Ok(GraphqlChannelMessageRead { seq, message })
    }

    /// Current changed messages and activity after the client's sequence.
    #[tracing::instrument(name = "channel.changes", skip_all, err(Debug), fields(channel_id = tracing::field::Empty))]
    async fn channel_changes(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Channel and last applied sequence.")] input: ChannelChangesInput,
    ) -> async_graphql::Result<GraphqlChannelChanges> {
        let channel_id = crate::parse_read_id(input.channel_id, "channelId")?;
        tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
        if input.after.is_empty() || !input.after.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(crate::bad_input(
                "after must be a nonnegative decimal sequence",
            ));
        }
        let after = input
            .after
            .parse::<i64>()
            .ok()
            .filter(|value| *value >= 0)
            .ok_or_else(|| crate::bad_input("after must be a nonnegative decimal sequence"))?;
        let reads = ctx.data::<ChannelGraphqlContext>()?;
        let access = reads.authorize(self.user_id.clone(), channel_id).await?;
        reads.channel_changes(access, channel_id, after).await
    }
}
