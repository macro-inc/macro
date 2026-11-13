//! Type-erased access and message reads supplied in GraphQL request data.
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{api::MessageReader, changes::ChannelMessageChange, service::MessageView};
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
}

impl ChannelGraphqlContext {
    /// Supply the REST messages service and its entity access boundary.
    pub fn new<S: MessageReader, A: EntityAccessService>(messages: Arc<S>, access: Arc<A>) -> Self {
        Self { messages, access }
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
            .map_err(|error| {
                use async_graphql::ErrorExtensions;
                match error {
                    AccessError::Unavailable(error) | AccessError::Internal(error) => {
                        tracing::error!(error = ?error, "channel access is unavailable");
                        async_graphql::Error::new("channel access is unavailable")
                            .extend_with(|_, e| e.set("code", "INTERNAL_SERVER_ERROR"))
                    }
                    _ => async_graphql::Error::new("forbidden")
                        .extend_with(|_, e| e.set("code", "FORBIDDEN")),
                }
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
