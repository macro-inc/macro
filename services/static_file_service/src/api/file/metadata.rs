use crate::api::context::AuthorizationService;
use crate::model::api::*;
use crate::service::dynamodb::client::DynamodbClient;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};

#[derive(serde::Deserialize)]
pub struct Params {
    pub file_id: String,
}

#[utoipa::path(
    get,
    path = "/api/file/metadata/{file_id}",
    params(
    ("file_id" = String, Path, description = "File ID")
    ),
    responses(
    (status = 200, body=GetFileMetadataResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String)
    )
)]
#[tracing::instrument(
    skip(metadata_client, user),
    fields(actor = %user.acting_entity())
)]
pub async fn handle_get_metadata(
    State(metadata_client): State<DynamodbClient>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { file_id }): Path<Params>,
) -> Result<Response, Response> {
    metadata_client
        .get_metadata(file_id.as_str())
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "error getting metadata");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "could not find metadata by id").into_response())
        .map(|metadata| {
            let response = GetFileMetadataResponse::from(metadata);
            (StatusCode::OK, Json(response)).into_response()
        })
}
