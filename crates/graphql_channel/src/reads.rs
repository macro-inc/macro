//! Type-erased access and message reads supplied in GraphQL request data.
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::{MessageCommands, MessageReader},
    changes::ChannelMessageChange,
    service::{MessageView, MessageWrite},
};
use std::{future::Future, pin::Pin, sync::Arc};
use uuid::Uuid;

/// Receipt future used by the request-scoped authorizer.
type AccessFuture<'a> = Pin<
    Box<dyn Future<Output = Result<EntityAccessReceipt<MessageView>, AccessError>> + Send + 'a>,
>;

/// Object-safe channel view authorization, using REST's minimum capability.
trait ChannelReadAccess: Send + Sync {
    /// Mint the view receipt for the authenticated viewer and channel.
    fn authorize(&self, viewer: MacroUserIdStr<'static>, channel_id: Uuid) -> AccessFuture<'_>;
}

impl<A: EntityAccessService> ChannelReadAccess for A {
    fn authorize(&self, viewer: MacroUserIdStr<'static>, channel_id: Uuid) -> AccessFuture<'_> {
        Box::pin(async move {
            self.generate_entity_access_receipt::<MessageView>(
                &viewer,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
        })
    }
}

/// Primary-backed message reads and channel access shared by HTTP and WebSocket GraphQL.
#[derive(Clone)]
pub struct ChannelGraphqlContext {
    /// The exact messages service used by the REST router.
    pub(crate) messages: Arc<dyn MessageReader>,
    /// Current channel access; no membership policy is duplicated here.
    access: Arc<dyn ChannelReadAccess>,
    /// The REST message commands and their write access; absent on a schema
    /// mounted for reads only.
    writes: Option<ChannelWrites>,
}

/// A write committed but its answer is incomplete; a replay answers in full.
fn unanswerable() -> async_graphql::Error {
    crate::coded_error(
        "the written message could not be read back; retry the request",
        crate::code::SERVICE_UNAVAILABLE,
    )
}

/// A root read back after a write.
enum ReadBack {
    /// The root as the reads return it, boxed: a message is hundreds of bytes
    /// and the other variants carry none.
    Root(Box<crate::GraphqlChannelMessage>),
    /// No longer readable as a message root (deleted thread, activity).
    NotRoot,
    /// The read failed; already logged.
    Failed,
}

/// The REST service's commands with the access boundary that guards them.
#[derive(Clone)]
struct ChannelWrites {
    /// The exact messages service used by the REST router.
    commands: Arc<dyn MessageCommands>,
    /// Current channel write access.
    access: Arc<dyn crate::writes::ChannelWriteAccess>,
}

impl ChannelGraphqlContext {
    /// Supply the REST messages service and its entity access boundary.
    pub fn new<S: MessageReader, A: EntityAccessService>(messages: Arc<S>, access: Arc<A>) -> Self {
        Self {
            messages,
            access,
            writes: None,
        }
    }

    /// Also serve message mutations through the REST service's commands.
    #[must_use]
    pub fn with_commands<S: MessageCommands, A: EntityAccessService>(
        mut self,
        commands: Arc<S>,
        access: Arc<A>,
    ) -> Self {
        self.writes = Some(ChannelWrites { commands, access });
        self
    }

    /// A written message as the reads return it, with the root a reply
    /// belongs to. A root carries its thread summary and call state, so the
    /// cached records stay whole and a reply's root counts the reply in the
    /// same commit. A replayed write reads both back the same way.
    ///
    /// The write has committed by now. A reply whose root cannot be read back
    /// is answered without it. A root that cannot be read back is answered
    /// `SERVICE_UNAVAILABLE`, since a root without its thread summary would
    /// erase the cached one: the client's queue replays the write under the
    /// same id, a replay that finds its write in place makes no other, and the
    /// replay reads the root again.
    ///
    /// The answer's position is a floor for both records: the root is read
    /// after the write committed, or after the position a replay is given.
    pub(crate) async fn written(
        &self,
        access: EntityAccessReceipt<MessageView>,
        written: messages::domain::ports::WrittenMessage,
        channel_id: Uuid,
    ) -> async_graphql::Result<crate::GraphqlChannelMessageWrite> {
        let messages::domain::ports::WrittenMessage { message, seq } = written;
        // Every channel write has a position; one without is as unanswerable
        // as a root that cannot be read back.
        let seq = seq.ok_or_else(unanswerable)?.to_string();
        Ok(match message.thread_id {
            Some(root_id) => crate::GraphqlChannelMessageWrite {
                seq,
                root: match self.read_back_root(access, root_id, channel_id).await {
                    ReadBack::Root(root) => Some(*root),
                    ReadBack::NotRoot | ReadBack::Failed => None,
                },
                message: crate::GraphqlChannelMessage::from_message(message, channel_id),
            },
            None => crate::GraphqlChannelMessageWrite {
                seq,
                message: match self.read_back_root(access, message.id, channel_id).await {
                    ReadBack::Root(root) => *root,
                    ReadBack::NotRoot => {
                        crate::GraphqlChannelMessage::from_message(message, channel_id)
                    }
                    ReadBack::Failed => return Err(unanswerable()),
                },
                root: None,
            },
        })
    }

    /// Read a root back after a write committed. A failure is logged and left
    /// to the caller, which answers with less or asks for a replay, never with
    /// an error that reads as a refusal: a resend under a new id would post
    /// twice.
    async fn read_back_root(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root_id: Uuid,
        channel_id: Uuid,
    ) -> ReadBack {
        use messages::domain::ports::{MessageError, MessageTimelineEntry};
        match self.messages.get_root(access, root_id).await {
            Ok(MessageTimelineEntry::Message { message }) => ReadBack::Root(Box::new(
                crate::GraphqlChannelMessage::from_item(*message, channel_id, None),
            )),
            Ok(MessageTimelineEntry::Call { message, status }) => ReadBack::Root(Box::new(
                crate::GraphqlChannelMessage::from_item(*message, channel_id, Some(status)),
            )),
            Ok(MessageTimelineEntry::Activity { .. }) | Err(MessageError::NotFound) => {
                ReadBack::NotRoot
            }
            Err(error) => {
                tracing::error!(error = ?error, "written channel root could not be read back");
                ReadBack::Failed
            }
        }
    }

    /// Mint a write receipt with REST's capability and hand out the commands.
    pub(crate) async fn authorize_write(
        &self,
        user: MacroUserIdStr<'static>,
        organization_id: Option<i64>,
        channel_id: Uuid,
    ) -> async_graphql::Result<(&dyn MessageCommands, EntityAccessReceipt<MessageWrite>)> {
        let writes = self.writes.as_ref().ok_or_else(|| {
            crate::coded_error(
                "channel message mutations are not configured",
                crate::code::INTERNAL_SERVER_ERROR,
            )
        })?;
        let access = writes
            .access
            .authorize_write(user, organization_id, channel_id)
            .await
            .map_err(|error| match error {
                AccessError::Unavailable(error) | AccessError::Internal(error) => {
                    tracing::error!(error = ?error, "channel access is unavailable");
                    crate::coded_error(
                        "channel access is unavailable",
                        crate::code::INTERNAL_SERVER_ERROR,
                    )
                }
                _ => crate::forbidden(),
            })?;
        Ok((writes.commands.as_ref(), access))
    }

    /// Mint a receipt without weakening REST's authorization.
    pub(crate) async fn authorize(
        &self,
        viewer: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> async_graphql::Result<EntityAccessReceipt<MessageView>> {
        self.access
            .authorize(viewer, channel_id)
            .await
            .map_err(|error| match error {
                AccessError::Unavailable(error) | AccessError::Internal(error) => {
                    tracing::error!(error = ?error, "channel access is unavailable");
                    crate::coded_error(
                        "channel access is unavailable",
                        crate::code::INTERNAL_SERVER_ERROR,
                    )
                }
                _ => crate::forbidden(),
            })
    }

    /// Read the committed sequence BEFORE loading an authorized channel page.
    pub(crate) async fn channel_seq(&self, channel_id: Uuid) -> async_graphql::Result<String> {
        self.messages
            .channel_seq(channel_id)
            .await
            .map(|seq| seq.to_string())
            .map_err(crate::message_error)
    }

    /// Map the authorized domain change page without additional per-item reads.
    pub(crate) async fn channel_changes(
        &self,
        access: EntityAccessReceipt<MessageView>,
        channel_id: Uuid,
        after: i64,
    ) -> async_graphql::Result<crate::GraphqlChannelChanges> {
        let changes = self
            .messages
            .channel_changes(access, channel_id, after)
            .await
            .map_err(crate::message_error)?;
        Ok(crate::GraphqlChannelChanges {
            reset_required: changes.reset_required,
            seq: changes.seq.to_string(),
            has_more: changes.has_more,
            messages: changes
                .messages
                .into_iter()
                .map(|change| match change {
                    ChannelMessageChange::Root { message, call } => {
                        crate::GraphqlChannelMessage::from_item(*message, channel_id, call)
                    }
                    ChannelMessageChange::Reply { message } => {
                        crate::GraphqlChannelMessage::from_message(*message, channel_id)
                    }
                })
                .collect(),
            activities: changes
                .activities
                .into_iter()
                .map(|activity| {
                    crate::GraphqlChannelTimelineActivity::from_activity(activity, channel_id)
                })
                .collect(),
            removed_ids: changes
                .removed_ids
                .into_iter()
                .map(|id| async_graphql::ID(id.to_string()))
                .collect(),
        })
    }
}
