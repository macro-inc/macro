use crate::api::context::ApiContext;
use crate::api::email::links::access::{InboxAccess, InboxActionError, authorize_inbox_access};
use anyhow::Context;
use axum::Extension;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use uuid::Uuid;

/// Removes a linked inbox.
///
/// For an inbox the caller owns this enqueues a full cascade teardown
/// (`LinkManagerMessage::DeleteLink`). For an inbox reached via delegation it
/// only drops the `macro_user_links` edge, leaving the owner's data intact.
#[utoipa::path(
    delete,
    tag = "Links",
    path = "/email/links/{link_id}",
    operation_id = "delete_link",
    params(
        ("link_id" = Uuid, Path, description = "Inbox link ID."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn delete_link_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(link_id): Path<Uuid>,
) -> Result<Response, InboxActionError> {
    let (link, access) = authorize_inbox_access(&ctx, &user_context.user_id, link_id).await?;

    match access {
        InboxAccess::Own => {
            let message = LinkManagerMessage::DeleteLink {
                link_id: link.id,
                deletion_reason: DeletionReason::ManuallyDisabled,
            };

            ctx.sqs_client
                .enqueue_link_manager_notification(message)
                .await
                .context("failed to enqueue delete notification")?;
        }
        InboxAccess::Delegated => {
            macro_db_client::macro_user_links::delete_edge(
                &ctx.db,
                &user_context.user_id,
                link.macro_id.as_ref(),
                link.id,
            )
            .await
            .context("failed to delete delegation edge")?;

            // A promoted shared mailbox has no human owner — it lives only through its
            // delegation edges. When the last delegate leaves, tear the mailbox down so it
            // doesn't linger as an orphaned link + minted user that nobody can reach.
            let remaining = macro_db_client::macro_user_links::get_primaries_for_child(
                &ctx.db,
                link.macro_id.as_ref(),
            )
            .await
            .context("failed to count remaining shared-inbox delegates")?;

            if remaining.is_empty() {
                let mut conn = ctx
                    .db
                    .acquire()
                    .await
                    .context("failed to acquire connection")?;
                let is_promoted = macro_db_client::shared_inbox::is_promoted_shared_mailbox(
                    &mut conn,
                    link.macro_id.as_ref(),
                )
                .await
                .context("failed to check promoted shared mailbox")?;

                if is_promoted {
                    ctx.sqs_client
                        .enqueue_link_manager_notification(LinkManagerMessage::DeleteLink {
                            link_id: link.id,
                            deletion_reason: DeletionReason::ManuallyDisabled,
                        })
                        .await
                        .context("failed to enqueue shared-inbox teardown")?;
                }
            }
        }
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}
