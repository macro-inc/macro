use std::{marker::PhantomData, time::Duration};

use async_graphql::{Context, Subscription};
use attention_feed::domain::{
    live::{COALESCE_WINDOW, coalesce},
    models::CandidateKeying,
};
use futures::{Stream, StreamExt};
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;

use crate::{
    context::NotificationInboxGraphqlContext,
    inputs::NotificationInboxScopeInput,
    objects::{GraphqlNotificationInboxPatch, GraphqlNotificationInboxUnreadCount},
};

/// How long triggers are collected before the unread counts are counted
/// again. Longer than the inbox's own window: every signed-in viewer holds
/// this subscription, and a count that follows a busy channel within a
/// second is soon enough.
const UNREAD_COALESCE_WINDOW: Duration = Duration::from_secs(1);

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

    /// How many unread rows the authenticated user's whole notification
    /// inbox holds, by kind: the current counts at once, then the counts
    /// again each time they change. Each payload is complete and lists only
    /// kinds with an unread row, so an empty list means nothing is unread.
    /// The stream ends with an error when its sources end or a count fails,
    /// after which the client resubscribes.
    async fn notification_inbox_unread_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<Vec<GraphqlNotificationInboxUnreadCount>>> + 'static,
    > {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?.clone();
        let viewer = context.viewer(user.clone()).await?;
        // Subscribed before the first count, so a change during it is not
        // missed.
        let triggers = context
            .triggers
            .subscribe(user, CandidateKeying::FiledEntity, false);

        Ok(async_stream::stream! {
            let mut unread = match context.service.unread_rows(viewer.clone()).await {
                Ok(unread) => unread,
                Err(error) => {
                    tracing::error!(error = ?error, "notification inbox unread count failed");
                    yield Err(async_graphql::Error::new(
                        "notification inbox unread counts are unavailable; resubscribe",
                    ));
                    return;
                }
            };
            let mut sent = GraphqlNotificationInboxUnreadCount::list(&unread);
            yield Ok(sent.clone());

            let batches = coalesce(triggers, UNREAD_COALESCE_WINDOW);
            futures::pin_mut!(batches);
            while let Some(batch) = batches.next().await {
                // After missed changes the groups that changed are unknown:
                // count everything again.
                let counted = if batch.invalidated {
                    context.service.unread_rows(viewer.clone()).await
                } else {
                    context
                        .service
                        .recount_unread_rows(viewer.clone(), unread.clone(), batch.keys)
                        .await
                };
                match counted {
                    Ok(counted) => unread = counted,
                    Err(error) => {
                        // The counts sent are now wrong and nothing says
                        // when the next change comes: the client counts
                        // again by resubscribing.
                        tracing::error!(error = ?error, "notification inbox unread recount failed");
                        yield Err(async_graphql::Error::new(
                            "notification inbox unread counts are unavailable; resubscribe",
                        ));
                        return;
                    }
                }
                let counts = GraphqlNotificationInboxUnreadCount::list(&unread);
                if counts != sent {
                    sent = counts;
                    yield Ok(sent.clone());
                }
            }
            yield Err(async_graphql::Error::new(
                "notification inbox subscription ended; resubscribe",
            ));
        })
    }
}
