use std::{future::Future, pin::Pin, sync::Arc};

use bots::domain::{
    models::{Bot, BotId, BotIdentity},
    ports::{BotError, BotService},
};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, MemberParticipantRole},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::errors::BotReadError;

/// The bot reads this adapter serves, so tests can stand in for the bots
/// service without implementing all of it.
pub trait BotReads: Send + Sync + 'static {
    /// Identities of `ids` in request order, each once; unknown ids omitted.
    fn identities(
        &self,
        ids: &[BotId],
    ) -> impl Future<Output = Result<Vec<BotIdentity>, BotError>> + Send;

    /// Bots the caller can `@` mention, in `channel` when one is given.
    fn mentionable_bots(
        &self,
        caller: MacroUserIdStr<'static>,
        channel: Option<EntityAccessReceipt<MemberParticipantRole>>,
    ) -> impl Future<Output = Result<Vec<Bot>, BotError>> + Send;
}

impl<S: BotService> BotReads for S {
    fn identities(
        &self,
        ids: &[BotId],
    ) -> impl Future<Output = Result<Vec<BotIdentity>, BotError>> + Send {
        self.get_identities(ids)
    }

    fn mentionable_bots(
        &self,
        caller: MacroUserIdStr<'static>,
        channel: Option<EntityAccessReceipt<MemberParticipantRole>>,
    ) -> impl Future<Output = Result<Vec<Bot>, BotError>> + Send {
        self.list_mentionable_bots(caller, channel)
    }
}

/// Channel membership check for channel-scoped bot lists, the one
/// `GET /channels/{id}/bots` makes.
pub trait ChannelMemberAuthorizer: Send + Sync + 'static {
    /// A member receipt for `user_id` in `channel_id`.
    fn authorize_channel_member(
        &self,
        user_id: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<EntityAccessReceipt<MemberParticipantRole>, AccessError>> + Send;
}

impl<A: EntityAccessService> ChannelMemberAuthorizer for A {
    async fn authorize_channel_member(
        &self,
        user_id: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, AccessError> {
        self.generate_entity_access_receipt::<MemberParticipantRole>(
            user_id,
            None,
            &channel_id.to_string(),
            EntityType::Channel,
        )
        .await
    }
}

pub(crate) type ReadFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, BotReadError>> + Send + 'a>>;

/// Object-safe view of the bot reads and channel check, so request data does
/// not carry their type parameters.
pub(crate) trait BotGraphqlReads: Send + Sync {
    fn identities(&self, ids: Vec<BotId>) -> ReadFuture<'_, Vec<BotIdentity>>;

    fn mentionable_bots(
        &self,
        viewer: MacroUserIdStr<'static>,
        channel_id: Option<Uuid>,
    ) -> ReadFuture<'_, Vec<Bot>>;
}

/// Type-erased bot reads stored in GraphQL request data.
#[derive(Clone)]
pub struct BotsGraphqlContext {
    pub(crate) reads: Arc<dyn BotGraphqlReads>,
}

impl BotsGraphqlContext {
    /// Erase the bots service and the channel access check.
    pub fn new<R: BotReads, A: ChannelMemberAuthorizer>(bots: Arc<R>, access: Arc<A>) -> Self {
        Self {
            reads: Arc::new(ServiceReads { bots, access }),
        }
    }
}

struct ServiceReads<R, A> {
    bots: Arc<R>,
    access: Arc<A>,
}

impl<R: BotReads, A: ChannelMemberAuthorizer> ServiceReads<R, A> {
    async fn channel_member(
        &self,
        viewer: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, BotReadError> {
        self.access
            .authorize_channel_member(viewer, channel_id)
            .await
            .map_err(BotReadError::from)
    }
}

impl<R: BotReads, A: ChannelMemberAuthorizer> BotGraphqlReads for ServiceReads<R, A> {
    fn identities(&self, ids: Vec<BotId>) -> ReadFuture<'_, Vec<BotIdentity>> {
        Box::pin(async move { Ok(self.bots.identities(&ids).await?) })
    }

    fn mentionable_bots(
        &self,
        viewer: MacroUserIdStr<'static>,
        channel_id: Option<Uuid>,
    ) -> ReadFuture<'_, Vec<Bot>> {
        Box::pin(async move {
            let channel = match channel_id {
                Some(channel_id) => Some(self.channel_member(&viewer, channel_id).await?),
                None => None,
            };
            Ok(self.bots.mentionable_bots(viewer, channel).await?)
        })
    }
}
