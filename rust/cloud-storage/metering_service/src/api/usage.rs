use crate::api::context::ApiContext;
use axum::{
    Router,
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use metering_db_client::{
    CreateUsageRecordRequest, MeteringDb, Usage, UsageQuery, UsageReport, paths,
};
use serde::Deserialize;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct UsageQueryParams {
    pub user_id: Option<String>,
    pub service_name: Option<String>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[utoipa::path(
    post,
    path = paths::USAGE,
    request_body = CreateUsageRecordRequest,
    responses(
        (status = 201, description = "Usage record created successfully", body = Usage),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "usage"
)]
pub async fn create_usage_record(
    State(db): State<MeteringDb>,
    Json(request): Json<CreateUsageRecordRequest>,
) -> Result<(StatusCode, Json<Usage>), (StatusCode, Json<serde_json::Value>)> {
    match db.create_usage_record(request).await {
        Ok(record) => Ok((StatusCode::CREATED, Json(record))),
        Err(e) => {
            tracing::error!("Failed to create usage record: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to create usage record",
                    "details": e.to_string()
                })),
            ))
        }
    }
}

#[utoipa::path(
    get,
    path = paths::USAGE,
    params(UsageQueryParams),
    responses(
        (status = 200, description = "Usage records retrieved successfully", body = UsageReport),
        (status = 400, description = "Invalid query parameters"),
        (status = 500, description = "Internal server error")
    ),
    tag = "usage"
)]
pub async fn get_usage_records(
    State(db): State<MeteringDb>,
    Query(params): Query<UsageQueryParams>,
) -> Result<Json<UsageReport>, (StatusCode, Json<serde_json::Value>)> {
    let query = UsageQuery {
        user_id: params.user_id,
        service_name: params.service_name,
        start_date: params.start_date,
        end_date: params.end_date,
        limit: params.limit,
        offset: params.offset,
    };

    match db.get_usage_records(query).await {
        Ok(report) => Ok(Json(report)),
        Err(e) => {
            tracing::error!("Failed to get usage records: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to retrieve usage records",
                    "details": e.to_string()
                })),
            ))
        }
    }
}

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_usage_record))
        .route("/", get(get_usage_records))
}
