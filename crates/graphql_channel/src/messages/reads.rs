//! The channel message reads the GraphQL fields resolve through.

use std::{future::Future, pin::Pin, sync::Arc};

use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    ports::{
        MessageError, MessageEventPublisher, MessageRepository, MessageTimelineEntry,
        MessageTimelinePage, MessageTimelineQuery, ThreadRepliesPage, ThreadRepliesQuery,
    },
    service::{MessageService, MessageView, changes::ChannelChanges},
};
use uuid::Uuid;

/// A boxed read, so the port stays object-safe.
pub(crate) type ReadFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, MessageError>> + Send + 'a>>;

/// Who is reading, as authorization needs it.
#[derive(Clone, Debug)]
pub(crate) struct Reader {
    /// The authenticated user.
    pub(crate) user_id: MacroUserIdStr<'static>,
    /// The user's organization, which can grant access to a channel.
    pub(crate) organization_id: Option<i64>,
}

/// A timeline page and the channel's sequence number read before it.
#[derive(Debug, Clone)]
pub(crate) struct SequencedTimelinePage {
    /// The channel's change sequence number before the page was read.
    pub(crate) seq: i64,
    /// The page.
    pub(crate) page: MessageTimelinePage,
}

/// A window of a thread's replies and the channel's sequence number read
/// before it.
#[derive(Debug, Clone)]
pub(crate) struct SequencedThreadPage {
    /// The channel's change sequence number before the window was read.
    pub(crate) seq: i64,
    /// The thread's root as the timeline shows it, read with a window that
    /// starts a thread: one with no cursor.
    pub(crate) root: Option<MessageTimelineEntry>,
    /// The window.
    pub(crate) page: ThreadRepliesPage,
}

/// Object-safe view of the message service, so request data does not carry
/// its type parameters. Every read authorizes the reader for the channel.
pub(crate) trait ChannelMessageReads: Send + Sync {
    /// One page of the channel's timeline, with the sequence number read
    /// before it.
    fn timeline(
        &self,
        reader: Reader,
        channel_id: Uuid,
        query: MessageTimelineQuery,
    ) -> ReadFuture<'_, SequencedTimelinePage>;

    /// One window of a thread's replies, with the sequence number read
    /// before it.
    fn thread(
        &self,
        reader: Reader,
        channel_id: Uuid,
        root_id: Uuid,
        query: ThreadRepliesQuery,
    ) -> ReadFuture<'_, SequencedThreadPage>;

    /// What changed in the channel after `since`.
    fn changes(
        &self,
        reader: Reader,
        channel_id: Uuid,
        since: i64,
    ) -> ReadFuture<'_, ChannelChanges>;
}

/// Type-erased channel message reads stored in GraphQL request data.
#[derive(Clone)]
pub struct ChannelMessagesGraphqlContext {
    /// The reads.
    pub(crate) reads: Arc<dyn ChannelMessageReads>,
    /// The organization of the request's user.
    pub(crate) organization_id: Option<i64>,
}

impl ChannelMessagesGraphqlContext {
    /// Erase the message and access services so request data does not carry
    /// their type parameters.
    pub fn new<R, E, A>(service: Arc<MessageService<R, E>>, access: Arc<A>) -> Self
    where
        R: MessageRepository + 'static,
        E: MessageEventPublisher + 'static,
        A: EntityAccessService + 'static,
    {
        Self {
            reads: Arc::new(ServiceReads { service, access }),
            organization_id: None,
        }
    }

    /// The same reads for a request whose user belongs to `organization_id`.
    #[must_use]
    pub fn for_organization(&self, organization_id: Option<i64>) -> Self {
        Self {
            reads: self.reads.clone(),
            organization_id,
        }
    }

    /// Reads backed by a hand-written port, for resolver tests.
    #[cfg(test)]
    pub(crate) fn from_reads(reads: Arc<dyn ChannelMessageReads>) -> Self {
        Self {
            reads,
            organization_id: None,
        }
    }
}

/// The reads over the real services.
struct ServiceReads<R, E, A> {
    /// The message domain service.
    service: Arc<MessageService<R, E>>,
    /// Mints the view receipt each read requires.
    access: Arc<A>,
}

impl<R, E, A> ServiceReads<R, E, A>
where
    R: MessageRepository,
    E: MessageEventPublisher,
    A: EntityAccessService,
{
    /// The reader's view receipt for the channel, minted the way the REST
    /// message routes mint it.
    async fn receipt(
        &self,
        reader: &Reader,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageView>, MessageError> {
        self.access
            .generate_entity_access_receipt::<MessageView>(
                &reader.user_id,
                reader.organization_id,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(|error| match error {
                AccessError::Unavailable(error) | AccessError::Internal(error) => {
                    MessageError::Repository(error)
                }
                _ => MessageError::Forbidden,
            })
    }
}

impl<R, E, A> ChannelMessageReads for ServiceReads<R, E, A>
where
    R: MessageRepository + 'static,
    E: MessageEventPublisher + 'static,
    A: EntityAccessService + 'static,
{
    fn timeline(
        &self,
        reader: Reader,
        channel_id: Uuid,
        query: MessageTimelineQuery,
    ) -> ReadFuture<'_, SequencedTimelinePage> {
        Box::pin(async move {
            let access = self.receipt(&reader, channel_id).await?;
            // Before the page: a change committed between the two reads is
            // then after `seq`, and the reader's next catch-up returns it.
            let seq = self.service.channel_seq(&access).await?;
            let page = self.service.timeline_entries(access, query).await?;
            Ok(SequencedTimelinePage { seq, page })
        })
    }

    fn thread(
        &self,
        reader: Reader,
        channel_id: Uuid,
        root_id: Uuid,
        query: ThreadRepliesQuery,
    ) -> ReadFuture<'_, SequencedThreadPage> {
        Box::pin(async move {
            let access = self.receipt(&reader, channel_id).await?;
            let seq = self.service.channel_seq(&access).await?;
            let starts_thread = query.cursor.is_none();
            let page = self
                .service
                .thread_replies(access.clone(), root_id, query)
                .await?;
            // The reply read returns the bare root. A reader that opens a
            // thread may not hold its root, so the opening window carries it
            // with its thread summary and call, as a timeline page would.
            let root = if starts_thread {
                self.service.channel_root(&access, root_id).await?
            } else {
                None
            };
            Ok(SequencedThreadPage { seq, root, page })
        })
    }

    fn changes(
        &self,
        reader: Reader,
        channel_id: Uuid,
        since: i64,
    ) -> ReadFuture<'_, ChannelChanges> {
        Box::pin(async move {
            let access = self.receipt(&reader, channel_id).await?;
            self.service.channel_changes(access, since).await
        })
    }
}
