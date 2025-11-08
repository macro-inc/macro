use super::consumer::InsightContextConsumer;
use crate::{
    context::ServiceContext,
    insight::consumer::generator::{
        generate_email_insights_for_messages, generate_email_insights_for_threads,
    },
};
use anyhow::Context;
use macro_db_client::{insight, insights_backfill};
use model::insight_context::{
    ProvidedContext,
    email_insights::{EmailInfo, GenerateEmailInsightContext},
};
use std::{collections::HashSet, sync::Arc};

// TODO config
const INSIGHT_LIMIT: i64 = 300;

pub enum HandleContext {
    InsightsGenerated,
    NoAction,
}

pub async fn handle_context(
    service_context: Arc<ServiceContext>,
    context: ProvidedContext,
    consumer: Arc<dyn InsightContextConsumer>,
) -> Result<HandleContext, anyhow::Error> {
    tracing::debug!("Handle context");
    // 1. save new peice of context
    insight::context::create_insight_context(&service_context.macro_db, &context)
        .await
        .context("failed to create context entry")?;

    tracing::debug!("Fetching unprocessed context");
    // 2. fetch unprocessed context
    let context_size = consumer.trigger_generation_at_n_messages();
    let (ids, entries) = insight::context::read_pending_context(
        &service_context.macro_db,
        &consumer.source_name(),
        &context.user_id,
        context_size as i64,
    )
    .await
    .context("failed to read pending context entries")?
    .into_iter()
    .collect::<(Vec<_>, Vec<_>)>();
    let resource_ids = entries
        .iter()
        .map(|swag| swag.resource_id.clone())
        .collect::<Vec<_>>();
    tracing::debug!("found pending context {}", ids.len());

    tracing::debug!("context fetched -> No action");
    // if there is not enough context exit
    if entries.len() < context_size {
        tracing::debug!("Not enough context");
        return Ok(HandleContext::NoAction);
    }
    tracing::debug!("context fetched -> fetching related insights");
    // else generate insights and mark context as consumed
    let related_insights = insight::user::read_insights_for_context(
        &service_context.macro_db,
        &context.user_id,
        consumer.source_name(),
        None, // No specific keywords for general insight generation
        true, // Prefer actionable insights for context
        INSIGHT_LIMIT as usize,
    )
    .await
    .context("failed to fetch related insights")?;

    tracing::debug!("context fetched -> generating new insights ...");
    let new_insights = consumer
        .generate_insights(
            &resource_ids,
            &context.user_id,
            &related_insights,
            service_context.clone(),
        )
        .await
        .context("insight generation failed")?
        .into_iter()
        .map(|mut insight| {
            insight.generated = true;
            insight.source = consumer.source_name();
            insight
        })
        .collect::<Vec<_>>();

    tracing::debug!("new insights generated ({:#?})", new_insights);
    tracing::debug!("writing insights");

    insight::context::mark_consumed(&service_context.macro_db, &ids)
        .await
        .context("failed to update insight context")?;

    let replace_ids = related_insights
        .into_iter()
        .filter_map(|insight| insight.id)
        .collect::<Vec<_>>();

    insight::user::replace_insights(
        &service_context.macro_db,
        &replace_ids,
        &new_insights,
        &context.user_id,
    )
    .await?;

    tracing::debug!("done");
    Ok(HandleContext::InsightsGenerated)
}

pub async fn handle_email_context(
    service_context: Arc<ServiceContext>,
    context: GenerateEmailInsightContext,
    sqs_message_id: Option<&str>,
) -> Result<HandleContext, anyhow::Error> {
    match &context.info {
        EmailInfo::Backfill(batch) => {
            tracing::info!(
                user = %context.macro_user_id,
                user_emails = ?batch.user_emails,
                is_complete = %batch.is_complete,
                thread_count = batch.thread_ids.len(),
                "Processing email backfill batch"
            );
            let ids = match generate_email_insights_for_threads(
                service_context.clone(),
                &context.macro_user_id,
                &batch.user_emails,
                &batch.thread_ids,
            )
            .await
            {
                Ok(ids) => ids,
                Err(e) => {
                    tracing::error!(error=?e, batch_id=%batch.batch_id, job_id=%batch.job_id, "Failed to generate insights");

                    // Mark batch as failed
                    if let Err(mark_err) = insights_backfill::batch::update::update_insights_backfill_batch_status(
                        &service_context.macro_db,
                        &batch.batch_id,
                        model::insight_context::insights_backfill::InsightsBackfillBatchStatus::Failed,
                        Some(&format!("Insight generation failed: {}", e)),
                        sqs_message_id,
                    ).await {
                        tracing::error!(error=?mark_err, batch_id=%batch.batch_id, "Failed to mark batch as failed");
                    }

                    return Err(e);
                }
            };

            if ids.is_empty() {
                tracing::info!("no email user insights generated");
                return Ok(HandleContext::NoAction);
            }

            tracing::info!("email user insights generated with ids {:#?}", ids);

            // Handle backfill tracking - create job and batch if they don't exist, then update progress
            let job_id = &batch.job_id;
            let insights_generated_count = ids.len() as i32;
            let threads_processed_count = batch.thread_ids.len() as i32;

            // Ensure job exists (create if first batch for this job)
            if let Err(e) = ensure_backfill_job_exists(
                &service_context.macro_db,
                job_id,
                &context.macro_user_id,
            )
            .await
            {
                tracing::error!(error=?e, job_id=%job_id, "Failed to ensure job exists");
                // Continue processing even if job creation fails
            }

            // Handle batch-level tracking
            let batch_id = &batch.batch_id;

            // Ensure batch exists and mark as in progress
            if let Err(e) = ensure_batch_exists_and_start(
                &service_context.macro_db,
                batch_id,
                job_id,
                &batch.thread_ids,
                sqs_message_id,
            )
            .await
            {
                tracing::error!(error=?e, batch_id=%batch_id, job_id=%job_id, "Failed to ensure batch exists");
            }

            // Update batch results
            if let Err(e) = update_batch_results(
                &service_context.macro_db,
                batch_id,
                insights_generated_count,
                &ids,
            )
            .await
            {
                tracing::error!(error=?e, batch_id=%batch_id, "Failed to update batch results");
            }

            // Mark batch as complete
            if let Err(e) = mark_batch_complete(&service_context.macro_db, batch_id).await {
                tracing::error!(error=?e, batch_id=%batch_id, "Failed to mark batch as complete");
            }

            // Update job progress counters
            if let Err(e) = increment_job_progress(
                &service_context.macro_db,
                job_id,
                &context.macro_user_id,
                threads_processed_count,
                insights_generated_count,
            )
            .await
            {
                tracing::error!(error=?e, job_id=%job_id, "Failed to update job progress counters");
            }

            // If this is the last batch for the user, mark the job as complete
            if batch.is_complete
                && let Err(e) =
                    mark_job_complete(&service_context.macro_db, job_id, &context.macro_user_id)
                        .await
            {
                tracing::error!(error=?e, job_id=%job_id, "Failed to mark job as complete");
            }

            tracing::info!(
                job_id=%job_id,
                batch_id=%batch_id,
                user_id=%context.macro_user_id,
                insights_count=%insights_generated_count,
                threads_count=%threads_processed_count,
                is_complete=%batch.is_complete,
                "Updated backfill tracking"
            );

            Ok(HandleContext::InsightsGenerated)
        }
        EmailInfo::NewMessages(batch) => {
            let message_thread_ids = batch
                .messages
                .iter()
                .map(|m| (m.message_id.to_string(), m.thread_id.to_string()))
                .collect::<Vec<_>>();
            let user_emails: Vec<String> = batch
                .messages
                .iter()
                .map(|m| m.user_email.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            tracing::info!(
                user = %context.macro_user_id,
                new_msgs = ?batch,
                message_thread_ids = ?message_thread_ids,
                user_emails = ?user_emails,
                "Processing email new messages batch"
            );

            let ids = generate_email_insights_for_messages(
                service_context,
                &context.macro_user_id,
                &user_emails,
                &message_thread_ids,
            )
            .await?;

            if ids.is_empty() {
                tracing::info!("no email user insights generated");
                return Ok(HandleContext::NoAction);
            }

            tracing::info!("email user insights generated with ids {:#?}", ids);
            Ok(HandleContext::InsightsGenerated)
        }
        EmailInfo::LinkDeleted(link_info) => {
            tracing::info!(
                context = ?context,
                "link deleted - link_id: {:?}, email: {:?}",
                link_info.link_id,
                link_info.email_address
            );
            Ok(HandleContext::NoAction)
        }
    }
}

/// Ensure a backfill job exists, creating it if it doesn't
async fn ensure_backfill_job_exists(
    db: &sqlx::Pool<sqlx::Postgres>,
    job_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    // Check if this specific job already exists
    match insights_backfill::job::get::get_insights_backfill_job_by_id(db, job_id).await {
        Ok(Some(_)) => {
            // Job already exists
            tracing::debug!(job_id=%job_id, user_id=%user_id, "Job already exists");
            return Ok(());
        }
        Ok(None) => {
            // No job exists, create one
        }
        Err(e) => {
            tracing::warn!(error=?e, job_id=%job_id, user_id=%user_id, "Error checking for job, attempting to create");
        }
    }

    // Create the job with the provided job_id as the primary key
    let result =
        insights_backfill::job::insert::create_insights_backfill_job_with_id(db, job_id, user_id)
            .await;

    match result {
        Ok(()) => {
            tracing::info!(job_id=%job_id, user_id=%user_id, "Created backfill job");
        }
        Err(e) => {
            // Job might already exist due to concurrent processing
            tracing::warn!(error=?e, job_id=%job_id, user_id=%user_id, "Failed to create job (may already exist)");
        }
    }

    Ok(())
}

/// Increment job progress counters
async fn increment_job_progress(
    db: &sqlx::Pool<sqlx::Postgres>,
    job_id: &str,
    user_id: &str,
    threads_processed: i32,
    insights_generated: i32,
) -> anyhow::Result<()> {
    // Update the specific job by its ID
    match insights_backfill::job::update::increment_insights_backfill_job_results(
        db,
        job_id,
        threads_processed,
        insights_generated,
    )
    .await
    {
        Ok(()) => {
            tracing::debug!(
                job_id=%job_id,
                user_id=%user_id,
                threads_processed=%threads_processed,
                insights_generated=%insights_generated,
                "Incremented job progress"
            );
        }
        Err(e) => {
            tracing::error!(error=?e, job_id=%job_id, user_id=%user_id, "Failed to increment job progress");
            return Err(e);
        }
    }

    Ok(())
}

/// Mark job as complete if this is the final batch
async fn mark_job_complete(
    db: &sqlx::Pool<sqlx::Postgres>,
    job_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    // Update the specific job by its ID
    match insights_backfill::job::update::update_insights_backfill_job_status(
        db,
        job_id,
        model::insight_context::insights_backfill::InsightsBackfillJobStatus::Complete,
    )
    .await
    {
        Ok(()) => {
            tracing::info!(job_id=%job_id, user_id=%user_id, "Marked backfill job as complete");
        }
        Err(e) => {
            tracing::error!(error=?e, job_id=%job_id, user_id=%user_id, "Failed to mark job as complete");
            return Err(e);
        }
    }

    Ok(())
}

/// Ensure a batch exists and mark it as in progress
async fn ensure_batch_exists_and_start(
    db: &sqlx::Pool<sqlx::Postgres>,
    batch_id: &str,
    job_id: &str,
    thread_ids: &[String],
    sqs_message_id: Option<&str>,
) -> anyhow::Result<()> {
    use model::insight_context::insights_backfill::InsightsBackfillBatchStatus;

    // Check if batch already exists
    match insights_backfill::batch::get::get_insights_backfill_batch_by_id(db, batch_id).await {
        Ok(Some(batch)) => {
            // Batch exists, mark as in progress if not already
            if batch.status != InsightsBackfillBatchStatus::InProgress {
                insights_backfill::batch::update::update_insights_backfill_batch_status(
                    db,
                    batch_id,
                    InsightsBackfillBatchStatus::InProgress,
                    None,
                    None,
                )
                .await?;
                tracing::debug!(batch_id=%batch_id, "Marked existing batch as in progress");
            }
        }
        Ok(None) => {
            // Create new batch
            insights_backfill::batch::insert::create_insights_backfill_batch_with_id(
                db,
                batch_id,
                job_id,
                thread_ids,
                sqs_message_id,
            )
            .await?;

            // Immediately mark as in progress
            insights_backfill::batch::update::update_insights_backfill_batch_status(
                db,
                batch_id,
                InsightsBackfillBatchStatus::InProgress,
                None,
                sqs_message_id,
            )
            .await?;

            tracing::info!(batch_id=%batch_id, job_id=%job_id, "Created and started batch");
        }
        Err(e) => {
            tracing::warn!(error=?e, batch_id=%batch_id, "Error checking for batch, attempting to create");

            // Try to create the batch, but handle duplicate key errors gracefully
            match insights_backfill::batch::insert::create_insights_backfill_batch_with_id(
                db,
                batch_id,
                job_id,
                thread_ids,
                sqs_message_id,
            )
            .await
            {
                Ok(()) => {
                    // Successfully created, mark as in progress
                    if let Err(update_err) =
                        insights_backfill::batch::update::update_insights_backfill_batch_status(
                            db,
                            batch_id,
                            InsightsBackfillBatchStatus::InProgress,
                            None,
                            None,
                        )
                        .await
                    {
                        tracing::warn!(error=?update_err, batch_id=%batch_id, "Failed to mark newly created batch as in progress");
                    } else {
                        tracing::info!(batch_id=%batch_id, job_id=%job_id, "Created and started batch after error");
                    }
                }
                Err(create_err) => {
                    // Check if it's a duplicate key error
                    if create_err
                        .to_string()
                        .contains("duplicate key value violates unique constraint")
                    {
                        tracing::info!(batch_id=%batch_id, "Batch already exists (duplicate key), attempting to mark as in progress");
                        // Batch already exists, try to mark it as in progress
                        if let Err(update_err) =
                            insights_backfill::batch::update::update_insights_backfill_batch_status(
                                db,
                                batch_id,
                                InsightsBackfillBatchStatus::InProgress,
                                None,
                                None,
                            )
                            .await
                        {
                            tracing::warn!(error=?update_err, batch_id=%batch_id, "Failed to mark existing batch as in progress");
                        }
                    } else {
                        tracing::error!(error=?create_err, batch_id=%batch_id, "Failed to create batch with non-duplicate error");
                        return Err(create_err);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Update batch results with insights generated count and insight IDs
async fn update_batch_results(
    db: &sqlx::Pool<sqlx::Postgres>,
    batch_id: &str,
    insights_generated_count: i32,
    insight_ids: &[String],
) -> anyhow::Result<()> {
    insights_backfill::batch::update::update_insights_backfill_batch_results(
        db,
        batch_id,
        insights_generated_count,
        insight_ids.to_vec(),
    )
    .await?;

    tracing::debug!(batch_id=%batch_id, insights_generated_count=%insights_generated_count, insight_ids=?insight_ids, "Updated batch results");
    Ok(())
}

/// Mark batch as complete
async fn mark_batch_complete(
    db: &sqlx::Pool<sqlx::Postgres>,
    batch_id: &str,
) -> anyhow::Result<()> {
    use model::insight_context::insights_backfill::InsightsBackfillBatchStatus;

    insights_backfill::batch::update::update_insights_backfill_batch_status(
        db,
        batch_id,
        InsightsBackfillBatchStatus::Complete,
        None,
        None,
    )
    .await?;

    tracing::info!(batch_id=%batch_id, "Marked batch as complete");
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::insight::consumer::ChatInsightContextConsumer;
    use chrono::Utc;
    use document_cognition_service_client::DocumentCognitionServiceClient;
    use document_storage_service_client::DocumentStorageServiceClient;
    use email_service_client::EmailServiceClient;
    use lexical_client::LexicalClient;
    use model::insight_context::UserInsightRecord;
    use scribe::{ScribeClient, document::DocumentClient};
    use sqlx::{Pool, Postgres};
    use std::sync::Arc;
    use sync_service_client::SyncServiceClient;
    pub struct MockChatInsightConsumer;

    pub fn service_context_test_with_macro_db(macro_db: Pool<Postgres>) -> ServiceContext {
        let bad_dss = DocumentStorageServiceClient::new(String::new(), String::new());
        let bad_sync_service = SyncServiceClient::new(String::new(), String::new());
        let bad_email = EmailServiceClient::new(String::new(), String::new());
        let bad_dcs = DocumentCognitionServiceClient::new(String::new(), String::new());
        let bad_lexical = LexicalClient::new(String::new(), String::new());
        let content_client = ScribeClient::new()
            .with_document_client(
                DocumentClient::builder()
                    .with_dss_client(bad_dss)
                    .with_lexical_client(bad_lexical)
                    .with_sync_service_client(bad_sync_service)
                    .build(),
            )
            .with_email_client(bad_email)
            .with_dcs_client(bad_dcs);
        ServiceContext {
            macro_db,
            content_client,
        }
    }

    #[async_trait::async_trait]
    impl InsightContextConsumer for MockChatInsightConsumer {
        fn source_name(&self) -> String {
            ChatInsightContextConsumer.source_name()
        }
        fn trigger_generation_at_n_messages(&self) -> usize {
            ChatInsightContextConsumer.trigger_generation_at_n_messages()
        }

        async fn generate_insights(
            &self,
            _: &[String],
            user_id: &str,
            _: &[UserInsightRecord],
            _: Arc<ServiceContext>,
        ) -> Result<Vec<UserInsightRecord>, anyhow::Error> {
            let now = Utc::now();
            Ok(vec![UserInsightRecord {
                id: None,
                confidence: None,
                content: "test".to_string(),
                created_at: now,
                updated_at: now,
                generated: false,
                source: "swag".to_string(),
                source_location: None,
                span_end: None,
                span_start: None,
                user_id: user_id.to_string(),
                insight_type: None,
                relevance_keywords: None,
            }])
        }
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("users")))]
    async fn test_chat_context(db: Pool<Postgres>) -> Result<(), anyhow::Error> {
        let consumer: Arc<dyn InsightContextConsumer> = Arc::new(MockChatInsightConsumer);
        let service_context = Arc::new(service_context_test_with_macro_db(db));
        let trigger_at_limit = consumer.trigger_generation_at_n_messages();
        let user_id = "macro|user@user.com".to_string();
        let context = ProvidedContext {
            provider_source: consumer.source_name(),
            resource_id: "c1".to_string(),
            user_id: user_id.clone(),
        };
        for _ in 0..trigger_at_limit - 1 {
            let result = handle_context(service_context.clone(), context.clone(), consumer.clone())
                .await
                .expect("handle context - no action");
            assert!(
                matches!(result, HandleContext::NoAction),
                "expected no action"
            );
        }

        let result = handle_context(service_context.clone(), context.clone(), consumer.clone())
            .await
            .expect("handle context - generate");

        assert!(matches!(result, HandleContext::InsightsGenerated));

        let unconsumed = insight::context::read_pending_context(
            &service_context.macro_db,
            consumer.source_name().as_str(),
            user_id.as_str(),
            10000,
        )
        .await
        .expect("context");

        assert!(unconsumed.is_empty());

        let result = handle_context(service_context.clone(), context.clone(), consumer.clone())
            .await
            .expect("handle context - no action (2)");

        assert!(matches!(result, HandleContext::NoAction));

        let unconsumed = insight::context::read_pending_context(
            &service_context.macro_db,
            consumer.source_name().as_str(),
            user_id.as_str(),
            10000,
        )
        .await
        .expect("context");

        assert_eq!(unconsumed.len(), 1, "one peice of unconsumed context");
        let insights = insight::user::read_recent_insights(
            &service_context.macro_db,
            &user_id,
            1000,
            consumer.source_name(),
        )
        .await
        .expect("generated insights");

        assert_eq!(insights.len(), 1, "one generated insight");

        let insight = insights.first().expect("fist insight");

        assert_eq!(insight.content, "test".to_string(), "content");
        assert!(insight.generated, "generated");
        assert_eq!(insight.source, ChatInsightContextConsumer.source_name());

        Ok(())
    }
}
