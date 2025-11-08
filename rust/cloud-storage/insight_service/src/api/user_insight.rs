use super::api_context::ApiContext;
use anyhow::Context;
use axum::{
    Extension, Router,
    extract::{Json, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};

use macro_db_client::insight::user as user_insight;
use macro_db_client::insight::user::BatchError;
use model::insight_context::UserInsightRecord;
use model::user::UserContext;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema, utoipa::IntoParams)]
pub struct GetUserInsightsParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub generated: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct GetUserInsightsResponse {
    pub insights: Vec<UserInsightRecord>,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct InsightProcessingResponse {
    pub status: String,
    pub message: String,
    pub estimated_wait_minutes: Option<u32>,
}

/// Helper function to handle immediate processing for users without cached batches
/// or when cached batches need to be regenerated
async fn process_user_immediate_and_respond(
    ctx: &ApiContext,
    user_id: &str,
    params: &GetUserInsightsParams,
) -> Response {
    use crate::insight::batch_processor::InsightBatchProcessor;
    let processor = InsightBatchProcessor::new(ctx.macro_db.clone());

    match processor.process_user_immediate(user_id).await {
        Ok(_) => {
            // Processing succeeded, now try to get the batch
            tracing::debug!(
                "Successfully processed batch for user {}, fetching results",
                user_id
            );

            match user_insight::get_user_insight_batch(&ctx.macro_db, user_id).await {
                Ok(Some(batch)) => {
                    match user_insight::get_insights_by_batch(
                        &ctx.macro_db,
                        user_id,
                        &batch.insight_ids.unwrap_or_default(),
                    )
                    .await
                    {
                        Ok(insights) => {
                            let offset = params.offset.unwrap_or(0) as usize;
                            let limit = params.limit.unwrap_or(30) as usize;
                            let total = insights.len() as i64;
                            let paginated_insights: Vec<_> =
                                insights.into_iter().skip(offset).take(limit).collect();

                            Json(GetUserInsightsResponse {
                                insights: paginated_insights,
                                total,
                            })
                            .into_response()
                        }
                        Err(BatchError::IncompleteInsights { .. }) => {
                            // Even the newly created batch is incomplete - delete it and return empty
                            tracing::warn!(
                                "Newly created batch is also incomplete for user {}, deleting and returning empty",
                                user_id
                            );

                            if let Err(delete_err) =
                                user_insight::delete_user_insight_batch(&ctx.macro_db, user_id)
                                    .await
                            {
                                tracing::error!(error=?delete_err, "Failed to delete newly created corrupted batch for user {}", user_id);
                            }

                            Json(GetUserInsightsResponse {
                                insights: vec![],
                                total: 0,
                            })
                            .into_response()
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "Failed to fetch insights from newly created batch");
                            StatusCode::INTERNAL_SERVER_ERROR.into_response()
                        }
                    }
                }
                Ok(None) => {
                    // Still no batch after processing - user probably has no insights
                    Json(GetUserInsightsResponse {
                        insights: vec![],
                        total: 0,
                    })
                    .into_response()
                }
                Err(e) => {
                    tracing::error!(error=?e, "Failed to fetch newly created batch");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Err(e) => {
            tracing::error!(error=?e, "Failed to process user batch immediately");
            // Return 202 as fallback - batch processing failed but we can retry later
            (
                StatusCode::ACCEPTED,
                Json(InsightProcessingResponse {
                    status: "processing".to_string(),
                    message:
                        "Your insights are being generated. Please check back in a few minutes."
                            .to_string(),
                    estimated_wait_minutes: Some(5),
                }),
            )
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    tag = "user_insight",
    description = "get user insights",
    path = "/user_insight",
    params(GetUserInsightsParams),
    responses(
        (status = 200, body=GetUserInsightsResponse),
        (status = 202, body=InsightProcessingResponse),
        (status = 500, body=String),
        (status = 401, body=String)
    )
)]
#[tracing::instrument(skip(ctx, user_ctx))]
pub async fn handle_get_user_insights(
    State(ctx): State<ApiContext>,
    user_ctx: Extension<UserContext>,
    params: Query<GetUserInsightsParams>,
) -> impl IntoResponse {
    // For non-generated insights (user memories), use the original logic
    if params.generated == Some(false) {
        return handle_get_user_memories(&ctx, user_ctx, params).await;
    }

    // For generated insights, use cached batches
    match user_insight::get_user_insight_batch(&ctx.macro_db, &user_ctx.user_id).await {
        Ok(Some(batch)) => {
            // We have a valid cached batch
            tracing::debug!("Found cached insight batch for user {}", user_ctx.user_id);

            match user_insight::get_insights_by_batch(
                &ctx.macro_db,
                &user_ctx.user_id,
                &batch.insight_ids.unwrap_or_default(),
            )
            .await
            {
                Ok(insights) => {
                    // Apply offset and limit to cached results
                    let offset = params.offset.unwrap_or(0) as usize;
                    let limit = params.limit.unwrap_or(30) as usize;
                    let total = insights.len() as i64;
                    let paginated_insights: Vec<_> =
                        insights.into_iter().skip(offset).take(limit).collect();

                    Json(GetUserInsightsResponse {
                        insights: paginated_insights,
                        total,
                    })
                    .into_response()
                }
                Err(BatchError::IncompleteInsights { .. }) => {
                    // Some insights were deleted - remove the corrupted batch and regenerate
                    tracing::warn!(
                        "Incomplete insights detected for user {}, removing batch and regenerating",
                        user_ctx.user_id
                    );

                    if let Err(delete_err) =
                        user_insight::delete_user_insight_batch(&ctx.macro_db, &user_ctx.user_id)
                            .await
                    {
                        tracing::error!(error=?delete_err, "Failed to delete corrupted batch for user {}", user_ctx.user_id);
                    }

                    // Fall back to the same logic as Ok(None) - trigger immediate processing
                    tracing::info!(
                        "Triggering immediate processing for user {} after batch deletion",
                        user_ctx.user_id
                    );

                    process_user_immediate_and_respond(&ctx, &user_ctx.user_id, &params).await
                }
                Err(e) => {
                    tracing::error!(error=?e, "Failed to fetch insights from batch");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Ok(None) => {
            // No cached batch exists - trigger immediate processing
            tracing::info!(
                "No cached batch found for user {}, triggering immediate processing",
                user_ctx.user_id
            );

            process_user_immediate_and_respond(&ctx, &user_ctx.user_id, &params).await
        }
        Err(e) => {
            tracing::error!(error=?e, "Failed to check for cached batch");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// Handle user memories (non-generated insights) with original logic
async fn handle_get_user_memories(
    ctx: &ApiContext,
    user_ctx: Extension<UserContext>,
    params: Query<GetUserInsightsParams>,
) -> Response {
    let insights = user_insight::get_user_insights(
        &ctx.macro_db,
        &user_ctx.user_id,
        params.generated,
        params.limit.unwrap_or(30),
        params.offset.unwrap_or(0),
    )
    .await
    .context("failed to retrieve insights")
    .inspect_err(|e| {
        tracing::error!(error=?e, "Failed to retrieve insights");
    });

    if insights.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let insights = insights.unwrap();

    let count = user_insight::count_total(&ctx.macro_db, params.generated, &user_ctx.user_id)
        .await
        .context("failed to get total")
        .inspect_err(|e| {
            tracing::error!(error=?e, "failed to get total");
        });

    if count.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let count = count.unwrap();

    Json(GetUserInsightsResponse {
        insights,
        total: count,
    })
    .into_response()
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct UpdateInsightRequest {
    pub insight_id: String,
    pub content: String,
}

#[utoipa::path(
    patch,
    tag = "user_insight",
    description = "update_user_insight",
    path = "/user_insight",
    request_body=UpdateInsightRequest,
    responses(
        (status = 200, body=UserInsightRecord),
        (status = 500, body=String),
        (status = 404, body=String),
        (status = 401, body=String),
    )
)]
#[tracing::instrument(skip(ctx, user_ctx))]
pub async fn handle_update_user_insight(
    State(ctx): State<ApiContext>,
    user_ctx: Extension<UserContext>,
    Json(UpdateInsightRequest {
        insight_id,
        content,
    }): Json<UpdateInsightRequest>,
) -> Result<Response, Response> {
    let mut insight = user_insight::get_insight(&ctx.macro_db, &insight_id, &user_ctx.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "error fetching insight");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?
        .ok_or(StatusCode::NOT_FOUND.into_response())?;

    insight.content = content;
    insight.generated = false;

    let updated =
        user_insight::update_insights(&ctx.macro_db, &user_ctx.user_id, vec![insight.clone()])
            .await
            .map_err(|e| {
                tracing::error!(erro=?e, "error updating insight");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            })?
            .first()
            .map(String::to_owned)
            .ok_or(StatusCode::NOT_FOUND.into_response())?;

    if updated != insight_id {
        tracing::error!("How did we get here. (user insight update)(turn the server off)");
    }

    Ok(Json(insight).into_response())
}

#[derive(Clone, Debug, ToSchema, Serialize, Deserialize)]
pub struct IdList {
    pub ids: Vec<String>,
}

#[
    utoipa::path(
        delete,
        tag = "user_insight",
        description = "update_user_insight",
        path = "/user_insight",
        request_body=IdList,
        responses(
            (status = 200, body=IdList),
            (status = 500, body=String),
            (status = 404, body=String),
            (status = 401, body=String),
        )
    )
]
#[tracing::instrument(skip(ctx, user_ctx))]
pub async fn handle_delete_user_insights(
    State(ctx): State<ApiContext>,
    user_ctx: Extension<UserContext>,
    ids: Json<IdList>,
) -> Result<Response, Response> {
    let deleted = user_insight::delete_user_insights(&ctx.macro_db, &ids.ids, &user_ctx.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "error deleting insights");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server serror".to_string(),
            )
                .into_response()
        })?;
    Ok((StatusCode::OK, Json(IdList { ids: deleted })).into_response())
}

#[derive(Clone, Debug, ToSchema, Deserialize, Serialize)]
pub struct CreateInsightsRequest {
    pub insights: Vec<String>,
}

#[
    utoipa::path(
        post,
        tag = "user_insight",
        description = "update_user_insight",
        path = "/user_insight",
        request_body=CreateInsightsRequest,
        responses(
            (status = 200, body=IdList),
            (status = 500, body=String),
            (status = 404, body=String),
            (status = 401, body=String),
        )
    )
]
#[tracing::instrument(skip(ctx, user_ctx))]
pub async fn handle_create_insights(
    State(ctx): State<ApiContext>,
    user_ctx: Extension<UserContext>,
    insights: Json<CreateInsightsRequest>,
) -> Result<Response, Response> {
    let insights = insights
        .insights
        .iter()
        .map(|content| UserInsightRecord::user_created(content.to_owned(), &user_ctx.user_id))
        .collect::<Vec<_>>();

    let created = user_insight::create_insights(&ctx.macro_db, &insights, &user_ctx.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create insights");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;
    Ok(Json(IdList { ids: created }).into_response())
}

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(handle_get_user_insights))
        .route("/", post(handle_create_insights))
        .route("/", patch(handle_update_user_insight))
        .route("/", delete(handle_delete_user_insights))
}
