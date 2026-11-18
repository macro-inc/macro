//! Realtime activity subscription for the authenticated user.

#[cfg(test)]
mod test;

use activity::{ActivitySubscriptionExit, ActivitySubscriptionService, ActivitySubscriptionUpdate};
use async_graphql::{Context, SimpleObject, Subscription, Union};
use axum::extract::FromRef;
use entity_access::domain::{
    models::{AccessError, ViewAccessLevel},
    ports::EntityAccessService,
};
use graphql_common::require_authenticated_user;
use macro_user_id::user_id::MacroUserIdStr;
use std::{marker::PhantomData, sync::Arc};
use tokio_stream::Stream;

/// Check retained activity through the current entity permission service.
pub async fn record_visible<A: EntityAccessService>(
    access: &A,
    viewer: &MacroUserIdStr<'_>,
    record: &activity::ActivityRecord,
) -> async_graphql::Result<bool> {
    if !activity::domain::visible_reads::requires_current_visibility(record.entity_type) {
        return Ok(true);
    }
    match access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            viewer,
            None,
            &record.entity_id,
            record.entity_type,
        )
        .await
    {
        Ok(_) => Ok(true),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_)
            | AccessError::BadRequest(_),
        ) => Ok(false),
        Err(_) => Err(async_graphql::Error::new("activity access is unavailable")),
    }
}

use crate::GraphqlActivityEvent;

/// A content-free signal to refresh activity through authorized queries.
#[derive(SimpleObject)]
pub struct GraphqlActivityInvalidation {
    /// True when mounted activity queries need a fresh read.
    pub refresh: bool,
}

/// Realtime activity patch: a recorded event or a purge invalidation.
#[expect(
    clippy::large_enum_variant,
    reason = "recorded rows dominate; invalidations carry no data"
)]
#[derive(Union)]
pub enum GraphqlActivityPatch {
    /// An activity event that was durably recorded.
    Updated(GraphqlActivityEvent),
    /// Activity queries must refresh after a purge.
    Invalidated(GraphqlActivityInvalidation),
}

impl From<ActivitySubscriptionUpdate> for GraphqlActivityPatch {
    fn from(value: ActivitySubscriptionUpdate) -> Self {
        match value {
            ActivitySubscriptionUpdate::Updated(record) => {
                Self::Updated(GraphqlActivityEvent::from(record.as_ref().clone()))
            }
            ActivitySubscriptionUpdate::Invalidated => {
                Self::Invalidated(GraphqlActivityInvalidation { refresh: true })
            }
        }
    }
}

/// Subscribe to realtime activity addressed to the authenticated user.
pub fn subscribe_to_activity<S: ActivitySubscriptionService, A: EntityAccessService>(
    service: &S,
    access: Arc<A>,
    ctx: &Context<'_>,
) -> async_graphql::Result<
    impl Stream<Item = async_graphql::Result<GraphqlActivityPatch>> + Send + 'static,
> {
    let user_id = require_authenticated_user(ctx)?;
    let mut subscription = service.subscribe(user_id.clone());

    Ok(async_stream::stream! {
        while let Some(update) = subscription.recv().await {
            if let ActivitySubscriptionUpdate::Updated(record) = &update {
                match record_visible(access.as_ref(), &user_id, record).await {
                    Ok(true) => {},
                    Ok(false) => continue,
                    Err(error) => { yield Err(error); break; }
                }
            }
            yield Ok(GraphqlActivityPatch::from(update));
        }

        match subscription.exit_reason().await {
            ActivitySubscriptionExit::SlowConsumer => {
                yield Err(async_graphql::Error::new(
                    "activity subscription closed because the client was too slow",
                ));
            }
            ActivitySubscriptionExit::Lagging { .. } => {
                yield Err(async_graphql::Error::new(
                    "activity subscription closed after falling behind",
                ));
            }
            ActivitySubscriptionExit::Closed => {}
        }
    })
}

/// Root GraphQL adapter for realtime activity subscriptions.
pub struct ActivitySubscriptionRoot<S, A, St> {
    /// User-scoped activity subscription service.
    service: S,
    /// Bind access and storage service types without owning either value.
    marker: PhantomData<fn() -> (A, St)>,
}

impl<S, A, St> ActivitySubscriptionRoot<S, A, St> {
    /// Creates an activity subscription root backed by `service`.
    pub fn new(service: S) -> Self {
        Self {
            service,
            marker: PhantomData,
        }
    }
}

#[Subscription]
impl<S, A, St> ActivitySubscriptionRoot<S, A, St>
where
    S: ActivitySubscriptionService,
    A: EntityAccessService,
    St: Send + Sync + 'static,
    Arc<A>: FromRef<St>,
{
    /// Subscribe to realtime activity for the authenticated user.
    async fn activity_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<GraphqlActivityPatch>> + 'static,
    > {
        subscribe_to_activity(&self.service, Arc::<A>::from_ref(ctx.data::<St>()?), ctx)
    }
}
