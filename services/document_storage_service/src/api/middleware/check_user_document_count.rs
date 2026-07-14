use std::sync::Arc;

use axum::{
    Extension,
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use http_body_util::BodyExt;
use sqlx::{Pool, Postgres};

use crate::{
    api::{
        MACRO_READ_PROFESSIONAL_PERMISSION_ID, context::ApiContext,
        middleware::error_handler::error_handler,
    },
    config::Config,
};
use model::folder::UploadFolderRequest;
use model::user::UserContext;

/// Checks if the user has hit/exceeded their document limit for a folder upload
#[tracing::instrument(skip(ctx, user_context, config_context, req, next), fields(user_id=?user_context.user_id))]
pub(in crate::api) async fn handler_upload_folder(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    State(config_context): State<Arc<Config>>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    match user_context.permissions.as_ref() {
        None => Err(error_handler(
            "could not get user permissions",
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
        Some(permissions) => {
            if permissions.contains(&String::from(MACRO_READ_PROFESSIONAL_PERMISSION_ID)) {
                tracing::trace!("user is a professional, skipping document count check");
                return Ok(next.run(req).await);
            }

            let (parts, body) = req.into_parts();
            let bytes = match body.collect().await {
                Ok(bytes) => bytes.to_bytes(),
                Err(err) => {
                    tracing::error!(error=?err, "failed to collect body");
                    return Err(error_handler(
                        "error occurred",
                        StatusCode::INTERNAL_SERVER_ERROR,
                    ));
                }
            };

            let parsed_body = match serde_json::from_slice::<UploadFolderRequest>(&bytes) {
                Ok(result) => result,
                Err(err) => {
                    tracing::error!(error=?err, "failed to parse body");
                    return Err(error_handler(
                        "unable to parse body for folder upload",
                        StatusCode::INTERNAL_SERVER_ERROR,
                    ));
                }
            };

            let new_item_count: u64 = match parsed_body.content.len().try_into() {
                Ok(count) => count,
                Err(_) => {
                    return Err(error_handler(
                        "unable to convert folder item count to i64",
                        StatusCode::INTERNAL_SERVER_ERROR,
                    ));
                }
            };

            if let Err((status_code, msg)) = check_document_count_for_folder_upload(
                ctx.db.clone(),
                &user_context.user_id,
                new_item_count,
                config_context.document_limit,
            )
            .await
            {
                return Err(error_handler(msg.as_str(), status_code));
            }

            let request = Request::from_parts(parts, Body::from(bytes));
            Ok(next.run(request).await)
        }
    }
}

#[tracing::instrument(skip(db))]
async fn check_document_count_for_folder_upload(
    db: Pool<Postgres>,
    user_id: &str,
    new_item_count: u64,
    document_limit: u64,
) -> Result<(), (StatusCode, String)> {
    let document_count =
        match macro_db_client::user::count::count_user_items(&db, user_id, false).await {
            Ok(document_count) => document_count as u64,
            Err(e) => {
                tracing::error!(error=?e, "unable to get user document count");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to get user document count".to_string(),
                ));
            }
        };

    if document_count + new_item_count >= document_limit {
        return Err((
            StatusCode::FORBIDDEN,
            "user document count exceeds document limit".to_string(),
        ));
    }

    Ok(())
}
