//! Internal HTTP surface for every search-event backfill.
//!
//! Each POST handler kicks the orchestrator onto a background tokio task
//! and returns `202 Accepted` with a job id right away — prod-scale corpora
//! can take many minutes to drain, well past the ALB idle timeout. Clients
//! poll `GET /internal/backfill/{job_id}` for progress; the orchestrator
//! updates the shared progress counter in DynamoDB as each page lands. Any
//! SPS instance can answer the GET because state lives in DynamoDB, not
//! in process memory. On shutdown the registry's local cancellation tokens
//! fire so drains stop between pages instead of being killed mid-publish.
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
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use serde::Serialize;

use crate::BackfillServiceImpl;
use crate::api::context::{ApiContext, AuthorizationService};
use crate::domain::backfill_gate::BackfillGate;
use crate::domain::jobs::{BackfillJobs, JobId};
use crate::domain::models::{
    CalendarEventBackfillRequest, CallBackfillRequest, ChannelBackfillRequest, ChatBackfillRequest,
    DocumentBackfillRequest, EmailBackfillRequest, ProjectBackfillRequest,
    PropertiesBackfillRequest,
};
use crate::domain::ports::BackfillControl as _;
use crate::domain::service::BackfillService;
use crate::outbound::backfill_control::DynamoBackfillControl;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/agent-sessions", post(agent_sessions))
        .route("/calls", post(calls))
        .route("/chats", post(chats))
        .route("/deleted-chat-messages", post(deleted_chat_messages))
        .route("/database-rows", post(database_rows))
        .route("/channels", post(channels))
        .route("/documents", post(documents))
        .route("/email-attachment-status", post(email_attachment_status))
        .route("/emails", post(emails))
        .route("/properties", post(properties))
        .route("/projects", post(projects))
        .route("/calendar-events", post(calendar_events))
        .route("/pause", get(pause_state).put(set_pause))
        .route("/{job_id}", get(status))
}

#[derive(Debug, Serialize)]
struct AcceptedReceipt {
    job_id: JobId,
}

#[tracing::instrument(skip(service, jobs, gate, _internal_authorization, req))]
async fn agent_sessions(
    State(service): State<Arc<crate::AgentSessionIndexer>>,
    State(jobs): State<BackfillJobs>,
    State(gate): State<BackfillGate>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<
        crate::domain::agent_session_index::AgentSessionBackfillRequest,
    >,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "agent-sessions",
        move |svc, progress, cancel| async move { svc.backfill(req, &gate, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, gate, _internal_authorization, req))]
async fn database_rows(
    State(service): State<Arc<crate::DatabaseRowIndexer>>,
    State(jobs): State<BackfillJobs>,
    State(gate): State<BackfillGate>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<
        crate::domain::database_row_index::DatabaseRowBackfillRequest,
    >,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "database-rows",
        move |svc, progress, cancel| async move { svc.backfill(req, &gate, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn calls(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<CallBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "calls",
        move |svc, progress, cancel| async move { svc.backfill_calls(req, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn chats(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<ChatBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "chats",
        move |svc, progress, cancel| async move { svc.backfill_chats(req, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn channels(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<ChannelBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "channels",
        move |svc, progress, cancel| async move {
            svc.backfill_channels(req, progress, cancel).await
        },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn documents(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<DocumentBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "documents",
        move |svc, progress, cancel| async move {
            svc.backfill_documents(req, progress, cancel).await
        },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn email_attachment_status(
    State(service): State<Arc<crate::EmailAttachmentStatusBackfill>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<
        crate::domain::email_attachment_status::EmailAttachmentStatusBackfillRequest,
    >,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "email-attachment-status",
        move |svc, progress, cancel| async move { svc.backfill(req, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn deleted_chat_messages(
    State(service): State<Arc<crate::DeletedChatMessageRepair>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<
        crate::domain::chat_message_repair::DeletedChatMessageRepairRequest,
    >,
) -> Response {
    // The job record names the mode, since a dry run and a run report the
    // same counters.
    let entity = if req.dry_run {
        "deleted-chat-messages-dry-run"
    } else {
        "deleted-chat-messages"
    };
    spawn_backfill(
        service,
        jobs,
        entity,
        move |svc, progress, cancel| async move { svc.repair(req, progress, cancel).await },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn emails(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<EmailBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "emails",
        move |svc, progress, cancel| async move {
            svc.backfill_emails(req, progress, cancel).await
        },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn properties(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<PropertiesBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "properties",
        move |svc, progress, cancel| async move {
            svc.backfill_entity_properties(req, progress, cancel).await
        },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn projects(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<ProjectBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "projects",
        move |svc, progress, cancel| async move {
            svc.backfill_projects(req, progress, cancel).await
        },
    )
    .await
}

#[tracing::instrument(skip(service, jobs, _internal_authorization, req))]
async fn calendar_events(
    State(service): State<Arc<BackfillServiceImpl>>,
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<CalendarEventBackfillRequest>,
) -> Response {
    spawn_backfill(
        service,
        jobs,
        "calendar-events",
        move |svc, progress, cancel| async move {
            svc.backfill_calendar_events(req, progress, cancel).await
        },
    )
    .await
}

#[derive(Debug, serde::Deserialize, Serialize)]
struct PauseState {
    paused: bool,
}

/// Whether backfills are paused. Every task rereads the switch every
/// [`crate::domain::backfill_gate::PAUSE_POLL_INTERVAL`], so a change takes up to that long to stop or
/// start them.
#[tracing::instrument(skip(control, _internal_authorization))]
async fn pause_state(
    State(control): State<DynamoBackfillControl>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
) -> Response {
    match control.paused().await {
        Ok(paused) => axum::Json(PauseState { paused }).into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "failed to read the backfill pause switch");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "pause switch unavailable",
            )
                .into_response()
        }
    }
}

/// Pause or resume every backfill in every task: SQS backfill workers stop
/// taking messages, which wait on the queue, and direct backfills wait before
/// their next write. Work already admitted finishes.
#[tracing::instrument(skip(control, _internal_authorization))]
async fn set_pause(
    State(control): State<DynamoBackfillControl>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<PauseState>,
) -> Response {
    match control.set_paused(req.paused).await {
        Ok(()) => {
            tracing::info!(paused = req.paused, "backfill pause switch set");
            axum::Json(req).into_response()
        }
        Err(error) => {
            tracing::error!(error = ?error, "failed to set the backfill pause switch");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "pause switch unavailable",
            )
                .into_response()
        }
    }
}

#[tracing::instrument(skip(jobs, _internal_authorization))]
async fn status(
    State(jobs): State<BackfillJobs>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(job_id): Path<String>,
) -> Response {
    // Job ids are UUIDs; the table's other items, such as the pause switch,
    // are not jobs.
    if uuid::Uuid::parse_str(&job_id).is_err() {
        return (StatusCode::NOT_FOUND, "unknown job id").into_response();
    }
    match jobs.snapshot(&JobId::from(job_id)).await {
        Ok(Some(snap)) => axum::Json(snap).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "unknown job id").into_response(),
        Err(e) => {
            tracing::error!(error=?e, "failed to read backfill job snapshot");
            (StatusCode::INTERNAL_SERVER_ERROR, "registry unavailable").into_response()
        }
    }
}

/// Allocate a job slot in the registry, hand the progress + cancel token
/// to the worker future the caller built, spawn it, and return
/// `202 Accepted` with the job id. The worker future captures the request
/// body so the HTTP body reference doesn't outlive the handler.
async fn spawn_backfill<S, F, Fut>(
    service: Arc<S>,
    jobs: BackfillJobs,
    entity: &'static str,
    run: F,
) -> Response
where
    S: Send + Sync + 'static,
    F: FnOnce(
            Arc<S>,
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
    let handle = match jobs.start(entity).await {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(error=?e, entity, "failed to allocate backfill job in registry");
            return (StatusCode::INTERNAL_SERVER_ERROR, "registry unavailable").into_response();
        }
    };
    let id = handle.id.clone();
    let id_for_task = handle.id.clone();
    let jobs_for_task = jobs.clone();

    tracing::info!(job_id = %id, entity, "spawning backfill");

    tokio::spawn(async move {
        let result = run(service, handle.progress, handle.cancel).await;
        match &result {
            Err(e) => {
                tracing::error!(job_id = %id_for_task, entity, error = ?e, "backfill failed");
            }
            Ok(receipt) if receipt.not_queued > 0 => {
                tracing::error!(
                    job_id = %id_for_task,
                    entity,
                    enqueued = receipt.enqueued,
                    not_queued = receipt.not_queued,
                    "backfill left messages off the search event queue"
                );
            }
            Ok(receipt) => {
                tracing::info!(job_id = %id_for_task, entity, enqueued = receipt.enqueued, "backfill completed");
            }
        }
        if let Err(e) = jobs_for_task.finish(&id_for_task, result).await {
            tracing::error!(job_id = %id_for_task, error=?e, "failed to record backfill terminal status in registry");
        }
    });

    (
        StatusCode::ACCEPTED,
        axum::Json(AcceptedReceipt { job_id: id }),
    )
        .into_response()
}
