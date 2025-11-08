use crate::{api::ApiContext, util::backfill::backfill_insights::backfill_email_insights};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::insight_context::email_insights::BackfillEmailInsightsFilter;

/// Internal endpoint to backfill insights from emails
#[tracing::instrument(skip_all)]
pub async fn backfill_insights_handler(
    State(ctx): State<ApiContext>,
    Json(req_body): Json<BackfillEmailInsightsFilter>,
) -> Result<Response, Response> {
    let sqs_client = ctx.sqs_client.as_ref().clone();
    let db = ctx.db.clone();
    match backfill_email_insights(sqs_client, &db, req_body).await {
        Ok(response) => Ok((StatusCode::OK, Json(response)).into_response()),
        Err(e) => {
            tracing::error!(error=?e, "backfill insights failed");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "backfill insights failed",
            )
                .into_response())
        }
    }
}
