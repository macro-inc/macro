use axum::{
    extract::{Json, State},
    http::StatusCode,
};
use macro_db_client::dcs::batch_verify::batch_verify;
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct VerifyAttachmentsRequest {
    pub attachments: Vec<String>,
}
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct VerifyAttachmentsResponse {
    pub attachments: Vec<String>,
}

#[tracing::instrument(skip(db))]
#[utoipa::path(
        post,
        path = "/attachments/verify",
        responses(
            (status = 200, body=VerifyAttachmentsResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
pub async fn verify_attachments_handler(
    State(db): State<PgPool>,
    req: Json<VerifyAttachmentsRequest>,
) -> Result<(StatusCode, Json<VerifyAttachmentsResponse>), (StatusCode, String)> {
    let attachments = batch_verify(&db, &req.attachments).await.map_err(|e| {
        tracing::error!(error = %e, "unable to verify attachments");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Ok((
        StatusCode::OK,
        Json(VerifyAttachmentsResponse { attachments }),
    ))
}
