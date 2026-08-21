use crate::backfill_completion_service;
use crate::pubsub::backfill::email_api_error::map_email_api_error;
use crate::pubsub::context::PubSubContext;
use crate::util::process_pre_insert::sync_labels::sync_labels;
use crate::util::sync_contacts::sync_contacts;
use email_db_client::backfill::job::update::{InitLeaseClaim, InitLeaseRenewal};
use models_email::email::service::backfill::{InitPayload, JobScopedPayload};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::email::service::{backfill, link};
use std::cmp::min;
use uuid::Uuid;

/// This step is invoked via the API when a new job is created.
/// Populates total_threads value in backfill_job row, and sends the first ListThreads message.
#[tracing::instrument(skip(ctx))]
pub async fn init_backfill(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<InitPayload>,
    link: &link::Link,
    backfill_job: &backfill::BackfillJob,
) -> Result<(), ProcessingError> {
    let lease_token =
        match email_db_client::backfill::job::update::claim_init_lease(&ctx.db, scope.job_id)
            .await
            .map_err(database_error)?
        {
            InitLeaseClaim::Claimed(lease_token) => lease_token,
            InitLeaseClaim::Complete => return Ok(()),
            InitLeaseClaim::Busy => return Err(init_lease_busy()),
            InitLeaseClaim::NotFound => {
                return Err(ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::BackfillJobNotFound,
                    source: anyhow::anyhow!("email backfill job was not found"),
                }));
            }
        };

    let initialization = initialize_backfill(ctx, scope, link, backfill_job, lease_token);
    tokio::pin!(initialization);
    let heartbeat = maintain_init_lease(ctx.db.clone(), scope.job_id, lease_token);
    tokio::pin!(heartbeat);
    let result = tokio::select! {
        biased;
        lease_result = &mut heartbeat => lease_result,
        initialization_result = &mut initialization => initialization_result,
    };
    if result.is_err() {
        email_db_client::backfill::job::update::release_init_lease(
            &ctx.db,
            scope.job_id,
            lease_token,
        )
        .await
        .inspect_err(|error| {
            tracing::error!(
                error = ?error,
                job_id = %scope.job_id,
                "failed to release email backfill init lease"
            );
        })
        .ok();
    }
    result
}

async fn initialize_backfill(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<InitPayload>,
    link: &link::Link,
    backfill_job: &backfill::BackfillJob,
    lease_token: Uuid,
) -> Result<(), ProcessingError> {
    tracing::info!("Initializing backfill job");

    // ensure we have the user's labels in the db
    let labels = ctx
        .email_api
        .list_labels(link.id)
        .await
        .map_err(|error| map_email_api_error(error, "Failed to list provider labels"))?;
    sync_labels(&ctx.db, link.id, &labels).await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to reconcile labels"),
        })
    })?;

    if let Err(e) = sync_contacts(
        link,
        &ctx.db,
        &ctx.email_api,
        &ctx.sqs_client,
        &ctx.macro_event_broker,
    )
    .await
    {
        tracing::error!(error = ?e, "Failed to sync contacts");
    }

    let threads_requested_limit = backfill_job.threads_requested_limit;

    // get the total number of threads the user has in their account
    let total_threads = ctx
        .email_api
        .get_thread_count(link.id)
        .await
        .map_err(|error| map_email_api_error(error, "Failed to get provider thread count"))?;
    let total_threads = i32::try_from(total_threads).map_err(|error| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::InvalidData,
            source: anyhow::Error::new(error).context("Provider thread count exceeds i32"),
        })
    })?;

    // If thread count is not specified, populate all available threads. Otherwise,
    // populate up to the requested number or total available, whichever is smaller
    let total_threads = match threads_requested_limit {
        Some(requested) => min(total_threads, requested),
        None => total_threads,
    };

    email_db_client::backfill::job::update::update_job_total_threads(
        &ctx.db,
        scope.job_id,
        total_threads,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to update total_threads"),
        })
    })?;

    // With no threads to list, no per-thread message is ever enqueued, so the
    // per-thread completion path that finalizes the job never runs. Complete
    // the job directly instead. Completion atomically clears this init lease;
    // if it fails, the outer error path releases the lease so a retry can
    // finish both the email and associated calendar jobs.
    if total_threads == 0 {
        backfill_completion_service::handle_job_completed(ctx, scope.job_id, Some(lease_token))
            .await?;
        return Ok(());
    }

    ctx.redis_client
        .init_backfill_job_progress(scope.job_id, total_threads)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context("Failed to create entry in redis for job"),
            })
        })?;

    if !email_db_client::backfill::job::update::finalize_initialization(
        &ctx.db,
        scope.job_id,
        lease_token,
    )
    .await
    .map_err(database_error)?
    {
        return Err(init_lease_busy());
    }

    Ok(())
}

async fn maintain_init_lease(
    db: sqlx::PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError> {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let renewal =
            email_db_client::backfill::job::update::renew_init_lease(&db, job_id, lease_token)
                .await;
        match renewal {
            Ok(InitLeaseRenewal::Renewed) => {}
            Ok(InitLeaseRenewal::Complete) => return Ok(()),
            Ok(InitLeaseRenewal::Lost) => return Err(init_lease_busy()),
            Ok(InitLeaseRenewal::NotFound) => {
                return Err(ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::BackfillJobNotFound,
                    source: anyhow::anyhow!("email backfill job was not found"),
                }));
            }
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    job_id = %job_id,
                    "failed to extend email backfill init lease"
                );
                return Err(database_error(error));
            }
        }
    }
}

fn init_lease_busy() -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::EmailBackfillInitBusy,
        source: anyhow::anyhow!("email backfill init is already leased"),
    })
}

fn database_error(error: anyhow::Error) -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::DatabaseQueryFailed,
        source: error,
    })
}
