//! Internal HTTP surface for every search-event backfill.
//!
//! Each POST handler kicks the orchestrator onto a background tokio task
//! and returns `202 Accepted` with a job id right away — prod-scale corpora
//! can take many minutes to drain, well past the ALB idle timeout.
//! Clients poll `GET /internal/backfill/{job_id}` for progress; the
//! orchestrator updates the shared progress counter as each page lands.
//! On shutdown the registry's cancellation tokens fire so drains stop
//! between pages instead of being killed mid-publish.
//!
//! Adding a new entity is one POST handler + one `.route(...)`; the status
//! handler is generic.

use std::sync::Arc;

use axum::{
    Router,
    extract::{self, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Serialize;

use crate::BackfillServiceImpl;
use crate::api::context::ApiContext;
use crate::domain::jobs::{BackfillJobs, JobId};
use crate::domain::models::{
    CallBackfillRequest, ChannelBackfillRequest, ChatBackfillRequest, DocumentBackfillRequest,
    EmailBackfillRequest,
};
use crate::domain::service::BackfillService;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/calls", post(calls))
        .route("/chats", post(chats))
        .route("/channels", post(channels))
        .route("/documents", post(documents))
        .route("/emails", post(emails))
        .route("/{job_id}", get(status))
}

#[derive(Debug, Serialize)]
struct AcceptedReceipt {
    job_id: JobId,
}

#[tracing::instrument(skip(service, jobs, req))]
async fn calls(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    extract::Json(req): extract::Json<CallBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "calls",
        move |svc, progress, cancel| async move { svc.backfill_calls(req, progress, cancel).await },
    )
}

#[tracing::instrument(skip(service, jobs, req))]
async fn chats(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    extract::Json(req): extract::Json<ChatBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "chats",
        move |svc, progress, cancel| async move { svc.backfill_chats(req, progress, cancel).await },
    )
}

#[tracing::instrument(skip(service, jobs, req))]
async fn channels(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    extract::Json(req): extract::Json<ChannelBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "channels",
        move |svc, progress, cancel| async move { svc.backfill_channels(req, progress, cancel).await },
    )
}

#[tracing::instrument(skip(service, jobs, req))]
async fn documents(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    extract::Json(req): extract::Json<DocumentBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "documents",
        move |svc, progress, cancel| async move { svc.backfill_documents(req, progress, cancel).await },
    )
}

#[tracing::instrument(skip(service, jobs, req))]
async fn emails(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    extract::Json(req): extract::Json<EmailBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "emails",
        move |svc, progress, cancel| async move { svc.backfill_emails(req, progress, cancel).await },
    )
}

#[tracing::instrument(skip(jobs))]
async fn status(State(jobs): State<BackfillJobs>, Path(job_id): Path<String>) -> Response {
    match jobs.snapshot(&JobId::from(job_id)) {
        Some(snap) => axum::Json(snap).into_response(),
        None => (StatusCode::NOT_FOUND, "unknown job id").into_response(),
    }
}

/// Allocate a job slot, hand the progress + cancel token to the worker
/// future the caller built, spawn it, and return `202 Accepted` with the
/// job id. The worker future captures the request body so the HTTP body
/// reference doesn't outlive the handler.
fn spawn_backfill<F, Fut>(
    service: Arc<BackfillServiceImpl>,
    jobs: BackfillJobs,
    entity: &'static str,
    run: F,
) -> Response
where
    F: FnOnce(
            Arc<BackfillServiceImpl>,
            Arc<crate::domain::jobs::JobProgress>,
            tokio_util::sync::CancellationToken,
        ) -> Fut
        + Send
        + 'static,
    Fut: std::future::Future<
            Output = Result<
                crate::domain::models::BackfillReceipt,
                crate::domain::models::BackfillError,
            >,
        > + Send,
{
    let handle = jobs.start();
    let id = handle.id.clone();
    let id_for_task = handle.id.clone();
    let jobs_for_task = jobs.clone();

    tracing::info!(job_id = %id, entity, "spawning backfill");

    tokio::spawn(async move {
        let result = run(service, handle.progress, handle.cancel).await;
        if let Err(e) = &result {
            tracing::error!(job_id = %id_for_task, entity, error = ?e, "backfill failed");
        } else {
            tracing::info!(job_id = %id_for_task, entity, "backfill completed");
        }
        jobs_for_task.finish(&id_for_task, result);
    });

    (
        StatusCode::ACCEPTED,
        axum::Json(AcceptedReceipt { job_id: id }),
    )
        .into_response()
}
