//! GraphQL inbound mutation adapter for channel activity.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ID, InputObject, Object};
use channels::domain::{
    models::{Activity, ActivityType},
    ports::{ChannelMutationErr, ChannelService},
};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, MemberParticipantRole},
    ports::EntityAccessService,
};
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Domain-facing capability required by the channel activity mutation.
pub trait ChannelActivityMutationService: Send + Sync + 'static {
    /// Record activity after channel member access has been verified.
    fn record_channel_activity(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        activity_type: ActivityType,
    ) -> impl Future<Output = Result<Activity, ChannelMutationErr>> + Send;
}

impl<S> ChannelActivityMutationService for S
where
    S: ChannelService,
{
    fn record_channel_activity(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        activity_type: ActivityType,
    ) -> impl Future<Output = Result<Activity, ChannelMutationErr>> + Send {
        self.post_activity(access, activity_type)
    }
}

/// Typed channel-member authorization boundary used by the GraphQL adapter.
pub trait ChannelActivityAuthorizer: Send + Sync + 'static {
    /// Mint a member receipt for the authenticated user and channel.
    fn authorize_channel_member(
        &self,
        user_id: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<EntityAccessReceipt<MemberParticipantRole>, AccessError>> + Send;
}

impl<A> ChannelActivityAuthorizer for A
where
    A: EntityAccessService,
{
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

/// Schema-only channel activity service.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpChannelActivityMutationService;

impl ChannelActivityMutationService for NoOpChannelActivityMutationService {
    async fn record_channel_activity(
        &self,
        _access: EntityAccessReceipt<MemberParticipantRole>,
        _activity_type: ActivityType,
    ) -> Result<Activity, ChannelMutationErr> {
        Err(ChannelMutationErr::NotFound(
            "channel activity mutations are not configured".to_string(),
        ))
    }
}

/// Root GraphQL adapter for channel mutations.
pub struct ChannelMutationRoot<S, A>(PhantomData<fn() -> (S, A)>);

impl<S, A> ChannelMutationRoot<S, A> {
    /// Construct a channel mutation root.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<S, A> Default for ChannelMutationRoot<S, A> {
    fn default() -> Self {
        Self::new()
    }
}

/// Channel activity operation exposed by GraphQL.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
#[graphql(name = "ChannelActivityType")]
pub enum GraphqlChannelActivityType {
    /// Record that the user viewed the channel.
    View,
    /// Record that the user interacted with the channel.
    Interact,
}

impl From<GraphqlChannelActivityType> for ActivityType {
    fn from(value: GraphqlChannelActivityType) -> Self {
        match value {
            GraphqlChannelActivityType::View => Self::View,
            GraphqlChannelActivityType::Interact => Self::Interact,
        }
    }
}

/// Input for recording authenticated channel activity.
#[derive(InputObject)]
pub struct RecordChannelActivityInput {
    /// Channel receiving the activity update.
    pub channel_id: ID,
    /// Kind of activity to record.
    pub activity_type: GraphqlChannelActivityType,
}

/// Authoritative channel activity returned by the channels domain.
pub struct GraphqlChannelActivity(Activity);

/// GraphQL fields for authoritative channel activity.
#[Object]
impl GraphqlChannelActivity {
    /// Stable activity row identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// User who owns this activity row.
    async fn user_id(&self) -> &str {
        &self.0.user_id
    }

    /// Channel associated with the activity.
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    /// Activity row creation time in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// Activity row update time in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// Most recent channel view time in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|value| value.to_rfc3339())
    }

    /// Most recent channel interaction time in RFC 3339 format.
    async fn interacted_at(&self) -> Option<String> {
        self.0.interacted_at.map(|value| value.to_rfc3339())
    }
}

/// GraphQL channel mutations.
#[Object]
impl<S, A> ChannelMutationRoot<S, A>
where
    S: ChannelActivityMutationService,
    A: ChannelActivityAuthorizer,
{
    /// Record a view or interaction in the authenticated user's channel activity.
    async fn record_channel_activity(
        &self,
        ctx: &Context<'_>,
        input: RecordChannelActivityInput,
    ) -> async_graphql::Result<GraphqlChannelActivity> {
        let user_id = require_authenticated_user(ctx)?;
        let channel_id = parse_id(input.channel_id, "channelId")?;
        let authorizer = ctx.data::<Arc<A>>()?;
        let access = authorizer
            .authorize_channel_member(&user_id, channel_id)
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        let service = ctx.data::<Arc<S>>()?;
        let activity = service
            .record_channel_activity(access, input.activity_type.into())
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;

        Ok(GraphqlChannelActivity(activity))
    }
}
