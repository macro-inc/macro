use crate::api::context::ApiContext;
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::history::HistoryAccessExtractor;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn upsert_history_handler(
    HistoryAccessExtractor { access_level, .. }: HistoryAccessExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { item_type, item_id }): Path<Params>,
) -> impl IntoResponse {
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

    let user_id = user_context.user_id.as_str();

    // If a user id is present in the UserContext, add the item to the user's history
    if !user_id.is_empty()
        && let Err(e) = macro_db_client::history::upsert_user_history(
            &mut transaction,
            &user_context.user_id,
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
    if item_type == "document" {
        let user_id_option = if user_id.is_empty() {
            None
        } else {
            Some(user_id)
        };

        if let Err(e) = macro_db_client::document::track_document::track_document(
            &mut transaction,
            item_id.as_str(),
            user_id_option,
        )
        .await
        {
            tracing::error!(error=?e, "unable to track document view");
            return GenericResponse::builder()
                .message("unable to track document view")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
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
