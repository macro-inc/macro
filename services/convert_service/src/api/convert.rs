use std::str::FromStr;

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::{
    convert::ConvertRequest,
    document::FileType,
    response::{EmptyResponse, ErrorResponse},
};

use crate::{
    disk::LOW_DISK_MESSAGE, process::convert::Conversion, utils::get_lok_filter_from_file_types,
};

use super::context::{ApiContext, AuthorizationService};

/// Convert call
#[utoipa::path(
        post,
        path = "/internal/convert",
        operation_id = "convert",
        security(
            ("internal" = [])
        ),
        responses(
            (status = 200, description = "convert", body = EmptyResponse),
            (status = 400, description = "invalid request", body = ErrorResponse),
            (status = 401, description = "unauthorized", body = ErrorResponse),
            (status = 500, description = "internal server error", body = ErrorResponse),
            (status = 503, description = "low disk space", body = ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, _internal_authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<ConvertRequest>,
) -> Result<Response, Response> {
    let job_id = macro_uuid::generate_uuid_v7().to_string();

    tracing::info!(job_id=%job_id, "starting conversion job");

    ctx.disk.check().map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "refusing conversion: low disk space");
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: LOW_DISK_MESSAGE.into(),
            }),
        )
            .into_response()
    })?;

    let from_file_type: FileType = req
        .from_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| FileType::from_str(s).map_err(anyhow::Error::from))
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get file type".into(),
                }),
            )
                .into_response()
        })?;

    let to_file_type: FileType = req
        .to_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| FileType::from_str(s).map_err(anyhow::Error::from))
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get file type".into(),
                }),
            )
                .into_response()
        })?;

    let filter = get_lok_filter_from_file_types(&from_file_type, &to_file_type).map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "unable to get lok filter");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: e.to_string().into(),
            }),
        )
            .into_response()
    })?;

    let input = ctx
        .s3_client
        .get(&req.from_bucket, &req.from_key)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get object from S3");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get object from S3".into(),
                }),
            )
                .into_response()
        })?;

    let conversion = Conversion::new(from_file_type, to_file_type, filter);
    let output = ctx
        .converter
        .convert(conversion, input)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "conversion failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "conversion failed".into(),
                }),
            )
                .into_response()
        })?;

    ctx.s3_client
        .put(&req.to_bucket, &req.to_key, &output)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to upload file");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to upload file".into(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", post(handler))
}
