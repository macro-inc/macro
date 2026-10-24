use std::marker::PhantomData;

use async_graphql::{Context, Subscription};
use attention_feed::domain::{
    live::{COALESCE_WINDOW, coalesce},
    models::CandidateKeying,
};
use futures::{Stream, StreamExt};
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;

use crate::{
    context::NotificationInboxGraphqlContext, inputs::NotificationInboxScopeInput,
    objects::GraphqlNotificationInboxPatch,
};

/// Root GraphQL adapter for the notification inbox subscription.
pub struct NotificationInboxSubscriptionRoot<E>(PhantomData<fn() -> E>);

impl<E> Default for NotificationInboxSubscriptionRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Subscription]
impl<E: SoupEntityEdges> NotificationInboxSubscriptionRoot<E> {
    /// Changes to the authenticated user's notification inbox in `scope`:
    /// groups to insert or move with their current rows, groups to remove,
    /// and an invalidation when changes may have been missed. Each payload
    /// is one batch to apply together. Start it before fetching the first
    /// page and refetch after an invalidation; the stream ends with an error
    /// when its sources end, after which the client resubscribes and
    /// refetches.
    async fn notification_inbox_updates(
        &self,
        ctx: &Context<'_>,
        scope: Option<NotificationInboxScopeInput>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<Vec<GraphqlNotificationInboxPatch<E>>>> + 'static,
    > {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?.clone();
        let scope = scope.unwrap_or_default().into_scope();
        let viewer = context.viewer(user.clone()).await?;
        let triggers = context
            .triggers
            .subscribe(user, CandidateKeying::FiledEntity, false);

        Ok(async_stream::stream! {
            let batches = coalesce(triggers, COALESCE_WINDOW);
            futures::pin_mut!(batches);
            while let Some(batch) = batches.next().await {
                if batch.invalidated {
                    yield Ok(vec![GraphqlNotificationInboxPatch::invalidated()]);
                    continue;
                }
                match context.service.recompute(viewer.clone(), scope.clone(), batch.keys).await {
                    Ok(changes) if changes.is_empty() => {}
                    Ok(changes) => {
                        yield Ok(changes.into_iter().map(GraphqlNotificationInboxPatch::from).collect());
                    }
                    Err(error) => {
                        tracing::error!(error = ?error, "notification inbox recompute failed");
                        yield Ok(vec![GraphqlNotificationInboxPatch::invalidated()]);
                    }
                }
            }
            yield Err(async_graphql::Error::new(
                "notification inbox subscription ended; resubscribe and refetch the inbox",
            ));
        })
    }
}
