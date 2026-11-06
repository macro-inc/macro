use std::marker::PhantomData;

use async_graphql::{Context, ID, Object, SimpleObject};
use attention_feed::domain::models::DoneReceipt;
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;
use tracing::Instrument;
use uuid::Uuid;

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

/// The result of clearing the inbox.
#[derive(SimpleObject)]
pub struct ClearNotificationInboxPayload {
    /// How many rows the clear has cleared; while it runs on, the count so
    /// far.
    row_count: i32,
    /// Opaque token that reverses the whole clear, stopping it first if it
    /// is still running. Undo it with `undoNotificationInboxRowsDone`.
    undo_token: String,
    /// Whether the clear finished before the reply. A clear still running
    /// carries on in the background; live updates remove its rows.
    complete: bool,
    /// Always absent: the server reads every batch itself.
    #[graphql(deprecation = "The server clears every batch. Remove after 2026-12-06.")]
    next_cursor: Option<String>,
}

/// How long a clear request waits for the clear before replying with its
/// progress; the clear carries on either way.
const CLEAR_WAIT: std::time::Duration = std::time::Duration::from_secs(15);

/// The prefix that marks an undo token as a whole clear's.
const CLEAR_TOKEN_PREFIX: &str = "clear:";

/// The undo token that names clear `id`.
fn clear_token(id: Uuid) -> String {
    format!("{CLEAR_TOKEN_PREFIX}{id}")
}

/// The clear an undo token names, if it names one.
fn parse_clear_token(token: &str) -> Option<async_graphql::Result<Uuid>> {
    token.strip_prefix(CLEAR_TOKEN_PREFIX).map(|id| {
        Uuid::parse_str(id)
            .map_err(|_| async_graphql::Error::new("invalid notification inbox undo token"))
    })
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

    /// Clear the authenticated user's notification inbox in one call: the
    /// server reads every batch and marks each matching row done, its shown
    /// and hidden notifications. Email threads are not archived. The clear
    /// runs apart from the request, so a closed tab or dropped connection
    /// doesn't stop it partway; the reply comes when it finishes, or with
    /// its progress after a while, and one token undoes all of it.
    async fn clear_notification_inbox(
        &self,
        ctx: &Context<'_>,
        input: ClearNotificationInboxInput,
    ) -> async_graphql::Result<ClearNotificationInboxPayload> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<NotificationInboxGraphqlContext>()?;
        let request = input.into_request()?;
        let viewer = context.viewer(user).await?;
        let id = Uuid::now_v7();
        let service = context.service.clone();
        let clearing = viewer.clone();
        let task = tokio::spawn(
            async move { service.clear(clearing, request, id).await }.in_current_span(),
        );
        let (rows, complete) = match tokio::time::timeout(CLEAR_WAIT, task).await {
            Ok(Ok(outcome)) => (outcome.map_err(to_graphql_error)?.rows, true),
            Ok(Err(error)) => {
                tracing::error!(error = ?error, "notification inbox clear task failed");
                return Err(async_graphql::Error::new(
                    "the notification inbox clear failed",
                ));
            }
            Err(_) => {
                let progress = context
                    .service
                    .clear_progress(viewer, id)
                    .await
                    .map_err(to_graphql_error)?;
                (progress.map_or(0, |progress| progress.rows), false)
            }
        };
        Ok(ClearNotificationInboxPayload {
            row_count: i32::try_from(rows).unwrap_or(i32::MAX),
            undo_token: clear_token(id),
            complete,
            next_cursor: None,
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
        let scope = input.scope.unwrap_or_default().into_scope();
        let changes = match parse_clear_token(&input.undo_token) {
            Some(id) => {
                let id = id?;
                let viewer = context.viewer(user).await?;
                context.service.undo_clear(viewer, scope, id).await
            }
            None => {
                let receipt = DoneReceipt::decode(&input.undo_token).map_err(|_| {
                    async_graphql::Error::new("invalid notification inbox undo token")
                })?;
                let viewer = context.viewer(user).await?;
                context.service.undo_done(viewer, scope, receipt).await
            }
        }
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
