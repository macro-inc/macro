use crate::api::MACRO_INTERNAL_USER_ID;
use crate::api::context::ApiContext;
use axum::extract::{Json, State};
use axum::http::StatusCode;
use macro_authorization::MacroAuthorizationExtractor;
use model::document_storage_service_internal::{ValidateItemIDsRequest, ValidateItemIDsResponse};

/// Validates the user has access to the provided list of item ids
#[tracing::instrument(skip(ctx, authorization), fields(user_id=?authorization.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor,
    Json(req): Json<ValidateItemIDsRequest>,
) -> Result<(StatusCode, Json<ValidateItemIDsResponse>), (StatusCode, String)> {
    tracing::info!("validate_item_ids");

    let user_id = authorization.user_context.user_id;

    if matches!(user_id.as_str(), "" | MACRO_INTERNAL_USER_ID) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "No user id found in context".to_string(),
        ));
    }

    let items = match macro_db_client::item_access::validate_user_accessible_items(
        &ctx.db, &user_id, req.items,
    )
    .await
    {
        Ok(items) => items,
        Err(e) => {
            tracing::error!(error=?e, "unable to get item ids");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get item ids".to_string(),
            ));
        }
    };

    Ok((StatusCode::OK, Json(ValidateItemIDsResponse { items })))
}
