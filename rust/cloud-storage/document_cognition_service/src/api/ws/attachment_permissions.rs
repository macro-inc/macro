use crate::api::context::ApiContext;
use crate::model::ws::{GenericErrorResponse, WebSocketError};
use anyhow::Result;
use macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2;
use model::{chat::AttachmentType, user::UserContext};

#[tracing::instrument(skip(ctx, attachments))]
pub async fn ensure_user_attachment_access(
    ctx: &ApiContext,
    user_ctx: UserContext,
    attachments: Vec<(String, Option<AttachmentType>)>,
) -> Result<(), WebSocketError> {
    let permissions = attachments
        .into_iter()
        .map(|(attachment_id, attachment_type)| {
            let ctx = &ctx;
            let user_ctx = &user_ctx;
            async move {
                get_users_access_level_v2(
                    &ctx.db,
                    &ctx.comms_service_client,
                    &user_ctx.user_id,
                    attachment_id.as_str(),
                    &attachment_type
                        .map(|kind| {
                            // balls ass decision to make images their own attachment type
                            if kind == AttachmentType::Image {
                                AttachmentType::Document
                            } else {
                                kind
                            }
                        })
                        .unwrap_or(AttachmentType::Document)
                        .to_string(),
                )
                .await
                .map_err(|e| {
                    tracing::error!(
                        error = ?e,
                        user_id = %user_ctx.user_id,
                        attachment_id = %attachment_id,
                        "Failed to check attachment access level"
                    );
                    WebSocketError::Generic(GenericErrorResponse { message: e.1 })
                })
                .and_then(|permissions| {
                    if permissions.is_none() {
                        tracing::warn!(user_id=?user_ctx.user_id, attachment_id=?attachment_id, "no permission to access attachment");
                        Err(WebSocketError::Generic(GenericErrorResponse {
                            message: "No Permission".into(),
                        }))
                    } else {
                        Ok(permissions)
                    }
                })
            }
        });

    let _ = futures::future::try_join_all(permissions).await?;
    Ok(())
}
