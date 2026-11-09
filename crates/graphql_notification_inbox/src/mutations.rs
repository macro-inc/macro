use std::marker::PhantomData;

use async_graphql::{Context, ID, Object, SimpleObject};
use attention_feed::domain::models::DoneReceipt;
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;

use crate::{
    context::{NotificationInboxGraphqlContext, to_graphql_error},
    inputs::{
        ClearNotificationInboxInput, MarkNotificationInboxNotificationDoneInput,
        MarkNotificationInboxRowsDoneInput, MarkNotificationInboxRowsSeenInput,
        UndoNotificationInboxRowsDoneInput,
    },
    objects::GraphqlNotificationInboxPatch,
};

/// The result of marking inbox rows done.
#[derive(SimpleObject)]
pub struct MarkNotificationInboxRowsDonePayload {
    /// The completed rows; remove them from every inbox. Rows that were
    /// already gone are included.
    row_ids: Vec<ID>,
    /// Opaque token that reverses exactly this operation.
    undo_token: String,
}

/// The result of marking one notification of a row done.
#[derive(SimpleObject)]
pub struct MarkNotificationInboxNotificationDonePayload<E: SoupEntityEdges> {
    /// The row's group's place in the requested inbox.
    patches: Vec<GraphqlNotificationInboxPatch<E>>,
    /// Opaque token that reverses exactly this operation.
    undo_token: String,
}

/// The result of one batch of clearing the inbox.
#[derive(SimpleObject)]
pub struct ClearNotificationInboxPayload {
    /// How many rows the batch cleared.
    row_count: i32,
    /// Opaque token that reverses exactly this batch.
    undo_token: String,
    /// Send as the next batch's `cursor` to keep clearing; absent once
    /// nothing is left.
    next_cursor: Option<String>,
}

/// The result of undoing a mark-done.
#[derive(SimpleObject)]
pub struct UndoNotificationInboxRowsDonePayload<E: SoupEntityEdges> {
    /// The restored groups' places in the requested inbox.
    patches: Vec<GraphqlNotificationInboxPatch<E>>,
}

/// The result of marking inbox rows seen.
#[derive(SimpleObject)]
pub struct MarkNotificationInboxRowsSeenPayload<E: SoupEntityEdges> {
    /// The updated groups' places in the requested inbox.
    patches: Vec<GraphqlNotificationInboxPatch<E>>,
}

/// Root GraphQL adapter for notification inbox mutations.
pub struct NotificationInboxMutationRoot<E>(PhantomData<fn() -> E>);

impl<E> Default for NotificationInboxMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Object]
impl<E: SoupEntityEdges> NotificationInboxMutationRoot<E> {
    /// Mark notification inbox rows done for the authenticated user:
    /// acknowledge the notifications each row shows and hides, and archive
    /// an email row's thread. Notifications newer than a row's `revision`
    /// stay active. Tasks, requests, reviews and pull requests themselves
    /// are not completed.
    async fn mark_notification_inbox_rows_done(
        &self,
        ctx: &Context<'_>,
        input: MarkNotificationInboxRowsDoneInput,
    ) -> async_graphql::Result<MarkNotificationInboxRowsDonePayload> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let targets = input.into_targets()?;
        let viewer = context.viewer(user).await?;
        let outcome = context
            .service
            .mark_done(viewer, targets)
            .await
            .map_err(to_graphql_error)?;
        Ok(MarkNotificationInboxRowsDonePayload {
            row_ids: outcome.rows.iter().map(|row| ID(row.id())).collect(),
            undo_token: outcome.receipt.encode(),
        })
    }

    /// Mark one notification of a row done for the authenticated user, with
    /// the hidden notifications about the same message or comment. A row's last
    /// shown notification completes the row, as marking the row done does.
    /// Returns the row's group's place in the requested inbox.
    async fn mark_notification_inbox_notification_done(
        &self,
        ctx: &Context<'_>,
        input: MarkNotificationInboxNotificationDoneInput,
    ) -> async_graphql::Result<MarkNotificationInboxNotificationDonePayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let scope = input.scope.clone().unwrap_or_default().into_scope();
        let (row, notification) = input.into_target()?;
        let viewer = context.viewer(user).await?;
        let outcome = context
            .service
            .mark_notification_done(viewer, scope, row, notification)
            .await
            .map_err(to_graphql_error)?;
        Ok(MarkNotificationInboxNotificationDonePayload {
            patches: outcome
                .changes
                .into_iter()
                .map(GraphqlNotificationInboxPatch::from)
                .collect(),
            undo_token: outcome.receipt.encode(),
        })
    }

    /// Clear the authenticated user's notification inbox one batch at a time:
    /// every matching row the batch reads is marked done, its shown and hidden
    /// notifications. Email threads are not archived. Repeat with
    /// `nextCursor` until it is absent; each batch's undo token reverses that
    /// batch.
    async fn clear_notification_inbox(
        &self,
        ctx: &Context<'_>,
        input: ClearNotificationInboxInput,
    ) -> async_graphql::Result<ClearNotificationInboxPayload> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let request = input.into_request()?;
        let viewer = context.viewer(user).await?;
        let outcome = context
            .service
            .clear(viewer, request)
            .await
            .map_err(to_graphql_error)?;
        Ok(ClearNotificationInboxPayload {
            row_count: i32::try_from(outcome.rows).unwrap_or(i32::MAX),
            undo_token: outcome.receipt.encode(),
            next_cursor: outcome.next.as_ref().map(|next| next.encode()),
        })
    }

    /// Reverse one mark-done for the authenticated user without overwriting
    /// anything that happened since, and return the restored groups' places
    /// in the requested inbox.
    async fn undo_notification_inbox_rows_done(
        &self,
        ctx: &Context<'_>,
        input: UndoNotificationInboxRowsDoneInput,
    ) -> async_graphql::Result<UndoNotificationInboxRowsDonePayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let receipt = DoneReceipt::decode(&input.undo_token)
            .map_err(|_| async_graphql::Error::new("invalid notification inbox undo token"))?;
        let scope = input.scope.unwrap_or_default().into_scope();
        let viewer = context.viewer(user).await?;
        let changes = context
            .service
            .undo_done(viewer, scope, receipt)
            .await
            .map_err(to_graphql_error)?;
        Ok(UndoNotificationInboxRowsDonePayload {
            patches: changes
                .into_iter()
                .map(GraphqlNotificationInboxPatch::from)
                .collect(),
        })
    }

    /// Mark notification inbox rows seen for the authenticated user: the
    /// notifications each row shows and hides become read. Returns the
    /// updated groups' places in the requested inbox.
    async fn mark_notification_inbox_rows_seen(
        &self,
        ctx: &Context<'_>,
        input: MarkNotificationInboxRowsSeenInput,
    ) -> async_graphql::Result<MarkNotificationInboxRowsSeenPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let scope = input.scope.clone().unwrap_or_default().into_scope();
        let rows = input.into_rows()?;
        let viewer = context.viewer(user).await?;
        let changes = context
            .service
            .mark_seen(viewer, scope, rows)
            .await
            .map_err(to_graphql_error)?;
        Ok(MarkNotificationInboxRowsSeenPayload {
            patches: changes
                .into_iter()
                .map(GraphqlNotificationInboxPatch::from)
                .collect(),
        })
    }
}
