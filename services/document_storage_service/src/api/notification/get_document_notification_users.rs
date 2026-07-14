use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use model::response::GenericErrorResponse;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets all users that need to be notified for a document
/// Returns an list of strings that are the user ids to be notified
#[utoipa::path(
        get,
        path = "/internal/notifications/document/{document_id}",
        operation_id = "get_document_notification_users",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=Vec<String>),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    let users =
        macro_db_client::notification::document::get_document_notification_users(&db, &document_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get document notification users");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(GenericErrorResponse {
                        error: true,
                        message: "unable to get document notification users".to_string(),
                    }),
                )
                    .into_response()
            })?;

    Ok((StatusCode::OK, Json(users)).into_response())
}
