//! GraphQL inbound adapter for channel messages, activity and the viewer's
//! channel reads.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

mod inputs;
mod objects;
mod reads;
mod subscription;
mod user_query;

pub use inputs::{ChannelChangesInput, ChannelThreadInput, ChannelTimelineInput};
pub use objects::*;
pub use reads::ChannelGraphqlContext;
pub use subscription::{
    ChannelTimelineSubscriptionRoot, ChannelTimelineSubscriptions, GraphqlChannelTimelineUpdate,
};
pub use user_query::GraphqlChannelQuery;

#[cfg(test)]
mod test;

use std::{marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::{Context, Enum, ErrorExtensions, ID, InputObject, Object};
use channels::domain::{
    models::{Activity, ActivityType},
    ports::{ChannelMessagesErr, ChannelMutationErr, ChannelService},
};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, MemberParticipantRole},
    ports::EntityAccessService,
};
use graphql_common::{parse_id, parse_macro_user_id, require_authenticated_user};
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

/// Transport validation error with the shared GraphQL code.
fn bad_input(message: impl Into<String>) -> async_graphql::Error {
    use async_graphql::ErrorExtensions;
    async_graphql::Error::new(message.into()).extend_with(|_, e| e.set("code", "BAD_USER_INPUT"))
}

/// Preserve REST's error categories without leaking persistence details.
fn message_error(error: messages::domain::ports::MessageError) -> async_graphql::Error {
    use async_graphql::ErrorExtensions;
    use messages::domain::ports::MessageError;
    let (message, code) = match error {
        MessageError::NotFound => ("message or parent not found", "NOT_FOUND"),
        MessageError::Forbidden => ("forbidden", "FORBIDDEN"),
        MessageError::Invalid(message) => (message, "BAD_USER_INPUT"),
        MessageError::Conflict => ("message id already exists", "CONFLICT"),
        MessageError::Contended(_) => (
            "conversation is busy; retry the request",
            "SERVICE_UNAVAILABLE",
        ),
        MessageError::Repository(error) => {
            tracing::error!(error = ?error, "channel read failed");
            ("channel read is unavailable", "INTERNAL_SERVER_ERROR")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, e| e.set("code", code))
}

/// Apply this adapter's validation code to the shared UUID parser.
fn parse_read_id(id: ID, field: &str) -> async_graphql::Result<Uuid> {
    graphql_common::parse_id(id, field).map_err(|_| bad_input(format!("invalid {field}")))
}

/// Domain-facing capability behind the viewer's channel reads.
pub trait ChannelUserReads: Send + Sync + 'static {
    /// The direct message between `user_id` and `recipient_id` that
    /// get-or-create by `user_id` would reuse, while `user_id` is still in
    /// it, without creating one: `None` when they have none `user_id` is in.
    fn find_direct_message(
        &self,
        user_id: MacroUserIdStr<'static>,
        recipient_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>, ChannelMessagesErr>> + Send;

    /// When `user_id` last viewed `channel_id`, member or not.
    fn channel_viewed_at(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<DateTime<Utc>>, ChannelMessagesErr>> + Send;
}

impl<S> ChannelUserReads for S
where
    S: ChannelService,
{
    fn find_direct_message(
        &self,
        user_id: MacroUserIdStr<'static>,
        recipient_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>, ChannelMessagesErr>> + Send {
        ChannelService::find_direct_message(self, user_id, recipient_id)
    }

    fn channel_viewed_at(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<DateTime<Utc>>, ChannelMessagesErr>> + Send {
        ChannelService::channel_viewed_at(self, user_id, channel_id)
    }
}

/// A boxed read, so the context needs no schema type parameter.
type ReadFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, ChannelMessagesErr>> + Send + 'a>>;

/// Object-safe form of [`ChannelUserReads`].
trait ChannelQueryReads: Send + Sync {
    /// See [`ChannelUserReads::find_direct_message`].
    fn find_direct_message(
        &self,
        user_id: MacroUserIdStr<'static>,
        recipient_id: MacroUserIdStr<'static>,
    ) -> ReadFuture<'_, Option<Uuid>>;

    /// See [`ChannelUserReads::channel_viewed_at`].
    fn channel_viewed_at(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> ReadFuture<'_, Option<DateTime<Utc>>>;
}

/// Erases a [`ChannelUserReads`].
struct ServiceReads<S>(Arc<S>);

impl<S: ChannelUserReads> ChannelQueryReads for ServiceReads<S> {
    fn find_direct_message(
        &self,
        user_id: MacroUserIdStr<'static>,
        recipient_id: MacroUserIdStr<'static>,
    ) -> ReadFuture<'_, Option<Uuid>> {
        Box::pin(self.0.find_direct_message(user_id, recipient_id))
    }

    fn channel_viewed_at(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> ReadFuture<'_, Option<DateTime<Utc>>> {
        Box::pin(self.0.channel_viewed_at(user_id, channel_id))
    }
}

/// Request data for the viewer's channel fields, type-erased so the schema
/// gains no type parameter.
#[derive(Clone)]
pub struct ChannelQueryContext {
    /// The channel reads behind the fields.
    reads: Arc<dyn ChannelQueryReads>,
}

impl ChannelQueryContext {
    /// Compose the channel reads from the domain service.
    pub fn new<S: ChannelUserReads>(service: Arc<S>) -> Self {
        Self {
            reads: Arc::new(ServiceReads(service)),
        }
    }
}

/// The authenticated user's channel fields, flattened into the viewer.
pub struct GraphqlChannelUserQuery {
    /// The authenticated user.
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlChannelUserQuery {
    /// Fields for the authenticated `user_id`.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

#[Object]
impl GraphqlChannelUserQuery {
    /// The id of the authenticated user's direct message with `userId`, the
    /// one a first message to them would reuse, while the authenticated user
    /// is still in it: of several, one both are in, then one only `userId`
    /// left, then the oldest, then the lowest id. Null when they are in none,
    /// or when `userId` is the authenticated user. Asking never creates one.
    async fn direct_message_channel_id(
        &self,
        ctx: &Context<'_>,
        user_id: ID,
    ) -> async_graphql::Result<Option<ID>> {
        let recipient_id = parse_macro_user_id(user_id.to_string(), "userId")?;
        let context = ctx.data::<ChannelQueryContext>()?;
        let channel_id = context
            .reads
            .find_direct_message(self.user_id.clone(), recipient_id)
            .await
            .map_err(|error| channel_read_failed(error, "direct message lookup failed"))?;
        Ok(channel_id.map(|id| ID(id.to_string())))
    }

    /// When the authenticated user last viewed the channel, in RFC 3339
    /// format, whether or not they are still in it. Null when they never
    /// viewed it. Their own activity row needs no access to the channel.
    async fn channel_viewed_at(
        &self,
        ctx: &Context<'_>,
        channel_id: ID,
    ) -> async_graphql::Result<Option<String>> {
        let channel_id = parse_id(channel_id, "channelId")?;
        let context = ctx.data::<ChannelQueryContext>()?;
        let viewed_at = context
            .reads
            .channel_viewed_at(self.user_id.clone(), channel_id)
            .await
            .map_err(|error| channel_read_failed(error, "channel view lookup failed"))?;
        Ok(viewed_at.map(|value| value.to_rfc3339()))
    }
}

/// Logs a failed read and answers with a stable message and code, never the
/// repository's error text.
fn channel_read_failed(error: ChannelMessagesErr, message: &'static str) -> async_graphql::Error {
    tracing::error!(error = ?error, message, "channel read failed");
    async_graphql::Error::new(message)
        .extend_with(|_, extensions| extensions.set("code", "INTERNAL_SERVER_ERROR"))
}
