use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::extract::State;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use entity_access::domain::models::EntityPermission;
use entity_access::inbound::axum_extractors::HistoryAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use models_permissions::share_permission::access_level::{AccessLevel, ViewAccessLevel};

#[derive(serde::Deserialize)]
pub struct Params {
    pub item_type: String,
    pub item_id: String,
}

/// Upserts an item into the user's history and performs other necessary tracking actions
#[utoipa::path(
    post,
    path = "/history/{item_type}/{item_id}",
    params(
        ("item_type" = String, Path, description = "Type of the item"),
        ("item_id" = String, Path, description = "ID of the item")
    ),
    responses(
        (status = 200, body=SuccessResponse),
        (status = 400, body=GenericErrorResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, history_access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn upsert_history_handler(
    history_access: HistoryAccessExtractor<
        ViewAccessLevel,
        EntityAccessService,
        AuthorizationService,
    >,
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { item_type, item_id }): Path<Params>,
) -> impl IntoResponse {
    let access_level = match history_access.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => AccessLevel::View,
    };

    // we only upsert history for threads that were shared with the user
    if item_type == "thread" && access_level == AccessLevel::Owner {
        return GenericResponse::builder()
            .data(&GenericSuccessResponse { success: true })
            .send(StatusCode::OK);
    }

    let mut transaction = match ctx.db.begin().await {
        Ok(transaction) => transaction,
        Err(e) => {
            tracing::error!(error=?e, "unable to begin transaction");
            return GenericResponse::builder()
                .message("unable to begin transaction")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if item_type != "thread" {
        // Update the item's last accessed time
        if let Err(e) = macro_db_client::history::upsert_item_last_accessed(
            &mut transaction,
            item_id.as_str(),
            item_type.as_str(),
        )
        .await
        {
            tracing::error!(error=?e, "unable to update item last accessed");
            return GenericResponse::builder()
                .message("unable to update item last accessed")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    if let Err(e) = macro_db_client::history::upsert_user_history(
        &mut transaction,
        user.authorization.user.macro_user_id.clone(),
        item_id.as_str(),
        item_type.as_str(),
    )
    .await
    {
        tracing::error!(error=?e, "unable to upsert history");
        return GenericResponse::builder()
            .message("unable to upsert history")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // If the item is a document, track the document view
    if item_type == "document"
        && let Err(e) = macro_db_client::document::track_document::track_document(
            &mut transaction,
            item_id.as_str(),
            Some(user.authorization.user.macro_user_id.as_ref()),
        )
        .await
    {
        tracing::error!(error=?e, "unable to track document view");
        return GenericResponse::builder()
            .message("unable to track document view")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "unable to commit transaction");
        return GenericResponse::builder()
            .message("unable to commit transaction")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    GenericResponse::builder()
        .data(&GenericSuccessResponse { success: true })
        .send(StatusCode::OK)
}
