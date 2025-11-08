use crate::api::ApiContext;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage,
};
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct BackfillParams {
    pub link_ids: Vec<Uuid>,
    pub num_threads: Option<i32>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BackfillResponse {
    pub pairs: Vec<LinkJobPair>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct LinkJobPair {
    pub link_id: Uuid,
    pub job_id: Uuid,
}

/// Internal endpoint to backfill email threads for users.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(req_body): Json<BackfillParams>,
) -> Result<Response, Response> {
    let mut link_job_pairs: Vec<LinkJobPair> = Vec::new();

    for link_id in req_body.link_ids {
        let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id)
            .await
            .map_err(|e| {
                tracing::warn!(error=?e, "error fetching link for backfill");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: format!("error fetching link for id {}", link_id).as_ref(),
                    }),
                )
                    .into_response()
            })?
            .ok_or_else(|| {
                tracing::warn!("link id not found for backfill: {}", link_id);
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "link id does not exist",
                    }),
                )
                    .into_response()
            })?;

        if !link.is_sync_active {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: format!("sync must be enabled for link {}", link_id).as_ref(),
                }),
            )
                .into_response());
        }

        let backfill_job = email_db_client::backfill::job::insert::create_backfill_job(
            &ctx.db,
            link.id,
            link.fusionauth_user_id.as_str(),
            req_body.num_threads,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error creating backfill_job");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: format!("error creating backfill job for link {}", link_id).as_ref(),
                }),
            )
                .into_response()
        })?;

        link_job_pairs.push(LinkJobPair {
            link_id,
            job_id: backfill_job.id,
        });

        let ps_message = BackfillPubsubMessage {
            link_id: link.id,
            job_id: backfill_job.id,
            backfill_operation: BackfillOperation::Init,
        };

        ctx.sqs_client.enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                // Log the error
                tracing::error!(error = ?e, backfill_id = %backfill_job.id, "Failed to enqueue backfill message");

                // Update the job status to Failed
                let db_pool = ctx.db.clone();
                let job_id = backfill_job.id;
                tokio::spawn(async move {
                    if let Err(update_err) = email_db_client::backfill::job::update::update_backfill_job_status(
                        &db_pool,
                        job_id,
                        BackfillJobStatus::Failed,
                    ).await {
                        tracing::error!(
                        error = ?update_err,
                        backfill_id = %job_id,
                        "Failed to update backfill job status to Failed"
                    );
                    }
                });

                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: format!("Failed to enqueue backfill message for link {}", link_id).as_ref(),
                    }),
                )
                    .into_response()
            })?;
    }
    Ok((
        StatusCode::OK,
        Json(BackfillResponse {
            pairs: link_job_pairs,
        }),
    )
        .into_response())
}
