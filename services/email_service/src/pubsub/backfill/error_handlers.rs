use crate::pubsub::backfill::increment_counters::{
    incr_completed_messages, incr_completed_threads,
};
use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::cg_refresh_email;
use calendar_events::domain::{
    models::{CalendarBackfillFailureDisposition, CalendarBackfillJobKey},
    service::GoogleCalendarBackfillRunError,
};
use models_email::api::refresh::{BackfillStatus, RefreshEmailEvent};
use models_email::email::service::backfill::{
    BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage, JobScopedPayload,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, LinkManagerMessage};
use sqs_worker::cleanup_message;
use uuid::Uuid;

/// Handles non-retryable errors by updating the appropriate status in the database and cleaning up the SQS message
#[tracing::instrument(skip(ctx, message))]
pub async fn handle_non_retryable_error(
    ctx: &PubSubContext,
    message: &aws_sdk_sqs::types::Message,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::error!(
        error = %e,
        source = { format!("{:#}", e.source) },
        "Non-retryable error processing message. The message will be deleted."
    );

    match &data.backfill_operation {
        BackfillOperation::Init(scope) => mark_job_failed(ctx, scope.job_id).await?,
        BackfillOperation::ListThreads(scope) => mark_job_failed(ctx, scope.job_id).await?,
        BackfillOperation::BackfillThread(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await?;
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await?;
        }
        BackfillOperation::BackfillMessage(scope) => {
            handle_message_failure(ctx, scope).await?;
        }
        BackfillOperation::BackfillAttachment(_) => {}
        BackfillOperation::FinalizeBackfill(scope) => {
            // The message is about to be deleted; without republishing the
            // completion-outbox row, the backfill would finish silently
            // missing attachment fan-out, contacts sync, and the final
            // refresh event. Deterministic failures resurface via the DLQ.
            sqlx::query!(
                r#"
                UPDATE email_backfill_completion_outbox
                SET published_at = NULL
                WHERE backfill_job_id = $1
                "#,
                scope.job_id,
            )
            .execute(&ctx.db)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, job_id = %scope.job_id, "failed to republish completion outbox after terminal finalize failure");
            })
            .ok();
        }
        BackfillOperation::CalendarGoogleBackfill(scope) => {
            let coordinator_reauth_transitioned = coordinator_reauth_edge(&e.source);
            let prelease_reauth_transitioned = if coordinator_reauth_transitioned.is_none() {
                let disposition = if e.reason == FailureReason::AccessTokenFetchFailed {
                    CalendarBackfillFailureDisposition::ReauthRequired
                } else {
                    CalendarBackfillFailureDisposition::Permanent
                };
                ctx.calendar_backfills
                    .google_failure
                    .fail_unclaimed(
                        CalendarBackfillJobKey {
                            job_id: scope.payload.calendar_job_id,
                            email_link_id: scope.link_id,
                        },
                        disposition,
                        &format!("{:#}", e.source),
                    )
                    .await
                    .map_err(|error| anyhow::anyhow!("{error:?}"))?
                    .link_reauth_transitioned
            } else {
                false
            };
            if coordinator_reauth_transitioned == Some(true) || prelease_reauth_transitioned {
                ctx.sqs_client
                    .enqueue_link_manager_notification(LinkManagerMessage::NotifyReauthRequired {
                        link_id: scope.link_id,
                    })
                    .await
                    .inspect_err(|error| {
                        tracing::error!(
                            error=?error,
                            link_id=%scope.link_id,
                            "Failed to enqueue reauth notification after calendar backfill failure"
                        );
                    })
                    .ok();
            }
        }
        // Best-effort side seed — a failure must not fail the backfill job.
        BackfillOperation::SeedSentContact(_) => {}
        BackfillOperation::PopulateCrmContact(_) => {}
        BackfillOperation::DepopulateCrmContact(_) => {}
        BackfillOperation::PopulateCrmForUser(_) => {}
        BackfillOperation::DepopulateCrmForUser(_) => {}
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

fn coordinator_reauth_edge(error: &anyhow::Error) -> Option<bool> {
    error.chain().find_map(|cause| {
        cause
            .downcast_ref::<GoogleCalendarBackfillRunError>()
            .map(|error| {
                matches!(
                    error,
                    GoogleCalendarBackfillRunError::ReauthRequired {
                        link_reauth_transitioned: true,
                        ..
                    }
                )
            })
    })
}

#[tracing::instrument(skip(ctx), err)]
async fn mark_job_failed(ctx: &PubSubContext, job_id: Uuid) -> anyhow::Result<()> {
    let transitioned =
        email_db_client::backfill::job::update::fail_backfill_job(&ctx.db, job_id).await?;

    if transitioned {
        notify_job_failed(ctx, job_id).await;
    }
    Ok(())
}

/// Resolves the failed job's link and signals the failure over the connection
/// gateway so an active client stops waiting on the job.
#[tracing::instrument(skip(ctx))]
async fn notify_job_failed(ctx: &PubSubContext, job_id: Uuid) {
    let Ok(Some(job)) =
        email_db_client::backfill::job::get::get_backfill_job(&ctx.db, job_id).await
    else {
        return;
    };
    let Some(link_id) = job.link_id else {
        return;
    };

    if let Ok(Some(link)) = email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::Backfill {
                link_id,
                status: BackfillStatus::Failed,
            },
        )
        .await;
    }
}

#[cfg(test)]
mod test;

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument(
    skip(data, _e),
    fields(link_id = ?data.backfill_operation.link_id(), error = tracing::field::Empty)
)]
pub async fn handle_retryable_error(
    data: &BackfillPubsubMessage,
    _e: &DetailedError,
) -> anyhow::Result<()> {
    let error_chain = format!("{:#}", _e.source);
    tracing::Span::current().record("error", &error_chain);

    match &data.backfill_operation {
        BackfillOperation::Init(_) => {
            tracing::warn!("Retryable error in Init")
        }
        BackfillOperation::ListThreads(_) => {
            tracing::warn!("Retryable error listing threads")
        }
        BackfillOperation::BackfillThread(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error backfilling thread"
            );
        }
        BackfillOperation::BackfillMessage(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                message_id = %scope.payload.message_provider_id,
                "Retryable error backfilling message"
            );
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error updating thread metadata"
            );
        }
        BackfillOperation::BackfillAttachment(scope) => {
            tracing::warn!(
                attachment_db_id = %scope.payload.metadata.attachment_metadata.attachment_db_id,
                "Retryable error backfilling attachment"
            )
        }
        BackfillOperation::FinalizeBackfill(scope) => {
            tracing::warn!(
                job_id = %scope.job_id,
                "Retryable error finalizing completed backfill"
            )
        }
        BackfillOperation::CalendarGoogleBackfill(scope) => {
            tracing::warn!(
                calendar_job_id = %scope.payload.calendar_job_id,
                "Retryable error backfilling Google Calendar"
            )
        }
        BackfillOperation::SeedSentContact(scope) => {
            tracing::warn!(
                message_id = %scope.payload.message_provider_id,
                "Retryable error seeding contact from sent message"
            )
        }
        BackfillOperation::PopulateCrmContact(scope) => {
            tracing::warn!(
                contact_email = %scope.payload.contact_email,
                "Retryable error populating CRM contact"
            )
        }
        BackfillOperation::DepopulateCrmContact(scope) => {
            tracing::warn!(
                contact_email = %scope.payload.contact_email,
                "Retryable error depopulating CRM contact"
            )
        }
        BackfillOperation::PopulateCrmForUser(payload) => {
            tracing::warn!(
                macro_id = %payload.macro_id,
                "Retryable error populating CRM for user"
            )
        }
        BackfillOperation::DepopulateCrmForUser(payload) => {
            tracing::warn!(
                macro_id = %payload.macro_id,
                "Retryable error depopulating CRM for user"
            )
        }
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_failure(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
) -> anyhow::Result<()> {
    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Link is gone — `incr_completed_threads` can't run without
            // it, so this thread will never complete on its own. Mark the
            // parent job failed instead of silently dropping the message
            // (the SQS message gets cleaned up after this returns, so a
            // silent return strands the job in InProgress forever).
            tracing::error!(
                link_id = link_id.to_string(),
                job_id = job_id.to_string(),
                "Link not found in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await?;
            return Ok(());
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = job_id.to_string(),
                "Failed to fetch link in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await?;
            return Ok(());
        }
    };

    if let Err(err) = incr_completed_threads(ctx, &link, job_id).await {
        tracing::error!(
            error = %err,
            job_id = job_id.to_string(),
            "Failed to check if job is completed in handle thread failure"
        );
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
pub async fn handle_message_failure(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillMessagePayload>,
) -> anyhow::Result<()> {
    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, scope.link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Same defense as handle_thread_failure — without a link we
            // can't increment counters, and a silent return leaves the
            // parent job in InProgress forever after the SQS message is
            // cleaned up.
            tracing::error!(
                link_id = scope.link_id.to_string(),
                job_id = scope.job_id.to_string(),
                "Link not found in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await?;
            return Ok(());
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = scope.job_id.to_string(),
                "Failed to fetch link in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await?;
            return Ok(());
        }
    };

    if let Err(err) = incr_completed_messages(ctx, &link, scope.job_id, &scope.payload).await {
        tracing::error!(
            error = %err,
            job_id = scope.job_id.to_string(),
            "Failed to check if thread is completed in handle message failure"
        );
    }
    Ok(())
}
