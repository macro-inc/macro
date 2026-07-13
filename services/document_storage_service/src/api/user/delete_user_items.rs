use crate::api::context::ApiContext;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, GenericErrorResponse};

#[derive(serde::Deserialize)]
pub struct Params {
    pub user_id: String,
}

/// deletes the users items
#[utoipa::path(
        delete,
        path = "/users/{user_id}/items",
        operation_id = "delete_user_items",
        params(
            ("user_id" = String, Path, description = "ID of the user")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn delete_user_items_handler(
    State(ctx): State<ApiContext>,
    Path(Params { user_id }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("deleting user dss items");
    let mut transaction = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "failed to begin transaction");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    let document_ids =
        macro_db_client::user::delete_user_dss_items::delete_documents::delete_user_documents(
            &mut transaction,
            &user_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete user documents");
            (StatusCode::INTERNAL_SERVER_ERROR).into_response()
        })?;

    macro_db_client::user::delete_user_dss_items::delete_chats::delete_user_chats(
        &mut transaction,
        &user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to delete user chats");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    macro_db_client::user::delete_user_dss_items::delete_projects::delete_user_projects(
        &mut transaction,
        &user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to delete user projects");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "failed to commit transaction");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    let document_ids_with_owner: Vec<(String, String)> = document_ids
        .into_iter()
        .map(|id| (id, user_id.to_string()))
        .collect();

    if let Err(e) = ctx
        .sqs_client
        .bulk_enqueue_document_delete_with_owner(document_ids_with_owner)
        .await
    {
        tracing::error!(error=?e, "failed to enqueue document delete");
    }

    Ok((StatusCode::OK).into_response())
}
