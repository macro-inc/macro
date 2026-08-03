use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::cg_refresh_email;
use contacts::domain::models::messages::ContactConnection;
use contacts::domain::ports::ContactsIngress;
use email_db_client::backfill::job::update::BackfillCompletion;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::api::refresh::{BackfillStatus, RefreshEmailEvent};
use models_email::db::address::EmailRecipientType;
use models_email::service::attachment::{
    AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use models_email::service::backfill::{
    BackfillAttachmentPayload, BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage,
    JobScopedPayload, UpdateMetadataPayload,
};
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// Emit a `refresh_email` event once per this many completed threads, plus on
/// the first completed thread and at job completion, rather than per-thread.
/// The first-thread emit ensures backfills smaller than this interval still
/// surface a progress event before completing.
const REFRESH_EMAIL_THREAD_INTERVAL: i32 = 50;

#[cfg(test)]
mod test;

/// called when a thread has completed processing. checks if it is the last thread to be processed
/// for the job, and if so, performs the necessary actions for job completion.
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_threads(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    let progress = ctx
        .redis_client
        .incr_completed_threads(job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context("Failed to increment completed thread count"),
            })
        })?;

    if progress.job_complete {
        tracing::info!(
            job_id = job_id.to_string(),
            "All threads for job have been processed"
        );
        handle_job_completed(ctx, job_id, None).await?;
    } else if progress.completed_threads == 1
        || progress.completed_threads % REFRESH_EMAIL_THREAD_INTERVAL == 0
    {
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::BackfillProgress {
                link_id: link.id,
                status: BackfillStatus::Progress,
                completed_threads: progress.completed_threads,
                total_threads: progress.total_threads,
            },
        )
        .await;
    }

    Ok(())
}

/// If this message was the last one in the thread to be processed, proceed to next stage of backfill for thread
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_messages(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    let thread_backfill_complete = ctx
        .redis_client
        .incr_completed_messages(job_id, &p.thread_provider_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context(format!(
                    "Handle completed message for {} failed",
                    p.message_provider_id
                )),
            })
        })?;

    if thread_backfill_complete {
        handle_thread_completed(ctx, link, job_id, p).await?;
    }

    Ok(())
}

/// performs actions when all threads and messages have been backfilled for the user.
#[tracing::instrument(skip(ctx))]
pub(crate) async fn handle_job_completed(
    ctx: &PubSubContext,
    job_id: Uuid,
    init_lease_token: Option<Uuid>,
) -> Result<(), ProcessingError> {
    tracing::info!("Backfill complete for job {}", job_id);
    let outcome =
        email_db_client::backfill::job::update::complete_backfill_job_and_calendar_extraction(
            &ctx.db,
            job_id,
            init_lease_token,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to complete email and calendar backfill jobs"),
            })
        })?;

    completion_result(job_id, outcome)
}

fn completion_result(job_id: Uuid, outcome: BackfillCompletion) -> Result<(), ProcessingError> {
    match outcome {
        BackfillCompletion::Completed | BackfillCompletion::AlreadyTerminal => Ok(()),
        BackfillCompletion::LeaseLost => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::EmailBackfillInitBusy,
            source: anyhow::anyhow!("email backfill completion lease was lost for job {job_id}"),
        })),
        BackfillCompletion::NotFound => Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::BackfillJobNotFound,
            source: anyhow::anyhow!("email backfill job {job_id} was not found"),
        })),
    }
}

/// Runs durable completion effects published from the completion outbox.
#[tracing::instrument(skip(ctx))]
pub(crate) async fn finalize_backfill(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    let Some(lease_token) =
        email_db_client::backfill::job::update::claim_completion_effects(&ctx.db, job_id)
            .await
            .map_err(|error| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: error.context("Failed to claim backfill completion effects"),
                })
            })?
    else {
        let pending =
            email_db_client::backfill::job::update::completion_effects_pending(&ctx.db, job_id)
                .await
                .map_err(|error| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: error.context("Failed to load backfill completion effects"),
                    })
                })?;
        if !pending {
            return Ok(());
        }
        return Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::anyhow!("backfill completion effects are already leased"),
        }));
    };

    let result = finalize_claimed_backfill(ctx, link_id, job_id, lease_token).await;
    if result.is_err() {
        email_db_client::backfill::job::update::release_completion_effects(
            &ctx.db,
            job_id,
            lease_token,
        )
        .await
        .inspect_err(|error| {
            tracing::error!(
                error = ?error,
                job_id = %job_id,
                "failed to release backfill completion-effects lease"
            );
        })
        .ok();
    }
    result
}

async fn finalize_claimed_backfill(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError> {
    let Some(job) = email_db_client::backfill::job::get::get_backfill_job(&ctx.db, job_id)
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to load completed backfill job"),
            })
        })?
    else {
        return Ok(());
    };
    match job.status {
        models_email::service::backfill::BackfillJobStatus::Complete => {}
        // A job that failed or was cancelled after its completion message
        // published will never become Complete; retrying such a delivery
        // only burns receives, so retire its effects instead.
        models_email::service::backfill::BackfillJobStatus::Failed
        | models_email::service::backfill::BackfillJobStatus::Cancelled => {
            tracing::warn!(%job_id, status = ?job.status, "retiring completion effects for a terminal, non-complete job");
            return retire_completion_effects(ctx, job_id, lease_token).await;
        }
        models_email::service::backfill::BackfillJobStatus::Init
        | models_email::service::backfill::BackfillJobStatus::InProgress => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::anyhow!(
                    "backfill completion effects published before job completion"
                ),
            }));
        }
    }
    let Some(canonical_link_id) = job.link_id else {
        return retire_completion_effects(ctx, job_id, lease_token).await;
    };
    if canonical_link_id != link_id {
        tracing::warn!(
            message_link_id = %link_id,
            canonical_link_id = %canonical_link_id,
            "using the completed backfill job's canonical link"
        );
    }
    let Some(link) = email_db_client::links::get::fetch_link_by_id(&ctx.db, canonical_link_id)
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to load link for backfill completion"),
            })
        })?
    else {
        return retire_completion_effects(ctx, job_id, lease_token).await;
    };

    let effects = async {
        handle_attachment_upload(ctx, &link, job_id)
            .await
            .map_err(completion_effect_retry)?;
        handle_contacts_sync(ctx, &link)
            .await
            .map_err(completion_effect_retry)?;
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::BackfillProgress {
                link_id: canonical_link_id,
                status: BackfillStatus::Complete,
                completed_threads: job.total_threads,
                total_threads: job.total_threads,
            },
        )
        .await;
        Ok(())
    };
    tokio::pin!(effects);
    let lease_heartbeat = maintain_completion_effects_lease(ctx.db.clone(), job_id, lease_token);
    tokio::pin!(lease_heartbeat);
    tokio::select! {
        biased;
        lease_result = &mut lease_heartbeat => lease_result?,
        effects_result = &mut effects => effects_result?,
    }

    retire_completion_effects(ctx, job_id, lease_token).await
}

async fn maintain_completion_effects_lease(
    db: sqlx::PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError> {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let renewed = email_db_client::backfill::job::update::renew_completion_effects(
            &db,
            job_id,
            lease_token,
        )
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to renew backfill completion-effects lease"),
            })
        })?;
        if !renewed {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::anyhow!("backfill completion-effects lease was lost"),
            }));
        }
    }
}

async fn retire_completion_effects(
    ctx: &PubSubContext,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError> {
    email_db_client::backfill::job::update::mark_completion_effects_complete(
        &ctx.db,
        job_id,
        lease_token,
    )
    .await
    .map_err(|error| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: error.context("Failed to finish backfill completion effects"),
        })
    })
}

fn completion_effect_retry(error: ProcessingError) -> ProcessingError {
    match error {
        ProcessingError::NonRetryable(detail) => ProcessingError::Retryable(detail),
        error => error,
    }
}

#[tracing::instrument(skip(ctx))]
async fn handle_attachment_upload(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    let attachments =
        email_db_client::attachments::provider::upload::fetch_job_attachments_for_backfill(
            &ctx.db, link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch job attachment backfill metadata".to_string()),
            })
        })?;

    if !attachments.is_empty() {
        tracing::debug!(
            "Found {} condition 5 attachments to backfill for job {}",
            attachments.len(),
            job_id
        );

        send_attachment_backfill_messages(ctx, link.id, job_id, attachments).await?;
    }

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_contacts_sync(ctx: &PubSubContext, link: &Link) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "contacts_sync")) {
        return Ok(());
    }

    let email_addresses =
        email_db_client::contacts::get::fetch_contacts_emails_by_link_id(&ctx.db, link.id)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch contact email addresses".to_string()),
                })
            })?;

    let length = email_addresses.len();

    tracing::info!(
        "Populating {} contacts for macro email {}",
        length,
        link.macro_id
    );

    let connections = email_addresses
        .iter()
        .map(|email| {
            MacroUserIdStr::try_from_email(email)
                .map(|contact| ContactConnection::new(link.macro_id.clone(), contact))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!(e).context("invalid user email for contacts"),
            })
        })?;

    ctx.contacts_ingress
        .enqueue_contact_connections(connections)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!("{e:?}").context(format!(
                    "Failed to enqueue contacts message for {}",
                    email_addresses.join(", ")
                )),
            })
        })?;

    tracing::info!(
        "Successfully populated {} contacts for macro email {}",
        length,
        link.macro_id
    );

    Ok(())
}

/// when a thread is done being backfilled, update its metadata and backfill its attachments.
#[tracing::instrument(skip(ctx))]
async fn handle_thread_completed(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    let new_payload = UpdateMetadataPayload {
        thread_provider_id: p.thread_provider_id.clone(),
        thread_db_id: p.thread_db_id,
    };

    let ps_message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::UpdateThreadMetadata(JobScopedPayload {
            link_id: link.id,
            job_id,
            payload: new_payload,
        }),
    };

    ctx.sqs_client
        .enqueue_email_backfill_message(ps_message)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e.context("Failed to enqueue metadata message".to_string()),
            })
        })?;

    handle_thread_attachment_upload(ctx, link, job_id, p.thread_db_id).await?;

    Ok(())
}

/// Creates BackfillAttachmentPayload messages and enqueues them via SQS for the given attachments
#[tracing::instrument(skip(ctx, attachments))]
async fn send_attachment_backfill_messages(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
    attachments: Vec<AttachmentUploadMetadata>,
) -> Result<(), ProcessingError> {
    if attachments.is_empty() {
        return Ok(());
    }

    let message_ids = attachments
        .iter()
        .map(|a| a.message_db_id)
        .collect::<Vec<_>>();

    let message_recipients =
        email_db_client::contacts::get::fetch_db_recipients_in_bulk(&ctx.db, &message_ids)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context(
                        "Failed to fetch db recipients for thread attachment backfill".to_string(),
                    ),
                })
            })?;

    for attachment in attachments {
        // get the email addresses of the recipients of the message
        let recipient_emails: Vec<String> = message_recipients
            .get(&attachment.message_db_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|(_, recipient_type)| *recipient_type == EmailRecipientType::To)
            .filter_map(|(contact, _)| contact.email_address.clone())
            .collect();

        let upload_destination = if matches!(
            attachment.mime_type.split('/').next(),
            Some("image" | "video")
        ) {
            AttachmentUploadDestination::Sfs
        } else {
            AttachmentUploadDestination::Dss
        };

        let attachment_upload_args = AttachmentUploadArgs {
            recipient_emails,
            attachment_metadata: attachment,
            backfill: true,
            upload_destination,
        };

        let new_payload = BackfillAttachmentPayload {
            metadata: attachment_upload_args,
        };

        let ps_message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::BackfillAttachment(JobScopedPayload {
                link_id,
                job_id,
                payload: new_payload,
            }),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue attachment backfill message".to_string()),
                })
            })?;
    }

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_attachment_upload(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    thread_db_id: Uuid,
) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    let (attachments, attachments2) = tokio::try_join!(
        email_db_client::attachments::provider::upload::thread_document_atts_for_backfill(
            &ctx.db,
            thread_db_id,
        ),
        email_db_client::attachments::provider::upload::thread_media_atts_for_backfill(
            &ctx.db,
            thread_db_id,
        )
    )
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch thread attachment backfill metadata".to_string()),
        })
    })?;

    let mut all_attachments = attachments;
    all_attachments.extend(attachments2);

    if !all_attachments.is_empty() {
        tracing::debug!(
            "Found {} attachments to backfill for thread {}",
            all_attachments.len(),
            thread_db_id
        );

        send_attachment_backfill_messages(ctx, link.id, job_id, all_attachments).await?;
    }

    Ok(())
}
