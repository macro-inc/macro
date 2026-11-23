use super::*;
/// Process and insert email threads by handling attachments and images
#[tracing::instrument(skip(ctx))]
pub(super) async fn fetch_and_insert_thread<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    payload: &UpsertMessagePayload,
    link_id: Uuid,
    provider_thread_id: &str,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let messages = match ctx.gmail.thread(link_id, provider_thread_id).await {
        Ok(fetched) => fetched.into_iter().map(|fetched| fetched.message).collect(),
        Err(error) => {
            return Err(handle_operation_error(
                &ctx.queue,
                ctx.retry_worker,
                link_id,
                InboxSyncOperation::UpsertMessage(payload.clone()),
                error,
            )
            .await);
        }
    };
    let mut threads = vec![thread_from_normalized_messages(
        link_id,
        provider_thread_id,
        messages,
    )];

    // process threads
    ctx.effects.prepare_threads(&mut threads).await;

    // insert threads into db
    for thread in threads.into_iter() {
        ctx.repository
            .insert_thread(link_id, thread)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e
                        .into_original()
                        .context("Failed to insert thread and messages".to_string()),
                })
            })?;
    }

    Ok(())
}

fn thread_from_normalized_messages(
    link_id: Uuid,
    provider_thread_id: &str,
    mut messages: Vec<Message>,
) -> Thread {
    messages.sort_by_key(|message| message.internal_date_ts);
    let inbox_visible = messages.iter().any(|message| {
        message.labels.iter().any(|label| {
            label.provider_label_id == models_email::service::label::system_labels::INBOX
        })
    });
    let is_read = messages.iter().all(|message| message.is_read);
    let latest_inbound_message_ts = messages
        .iter()
        .rfind(|message| is_inbound(message))
        .and_then(|message| message.internal_date_ts);
    let latest_outbound_message_ts = messages
        .iter()
        .rfind(|message| is_outbound(message))
        .and_then(|message| message.internal_date_ts);
    let latest_non_spam_message_ts = messages
        .iter()
        .rfind(|message| !is_spam_or_trash(message))
        .and_then(|message| message.internal_date_ts);
    let thread_db_id = Uuid::now_v7();
    for message in &mut messages {
        message.thread_db_id = thread_db_id;
    }
    let now = chrono::Utc::now();

    Thread {
        db_id: thread_db_id,
        provider_id: Some(provider_thread_id.to_string()),
        link_id,
        inbox_visible,
        is_read,
        latest_inbound_message_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
        created_at: now,
        updated_at: now,
        messages,
    }
}

/// Process and insert message
#[tracing::instrument(skip(db, preparation, message, resync), fields(message_provider_id = ?message.provider_id))]
pub async fn process_and_insert_message<R: InboxSyncImportRepository, P: InboxSyncPreparation>(
    db: &R,
    preparation: &P,
    link_id: Uuid,
    thread_db_id: Uuid,
    message: &mut Message,
    resync: Option<&InboxSyncResync>,
) -> result::Result<(), ProcessingError> {
    preparation.prepare_message(message).await;

    db.insert_message(link_id, thread_db_id, message, resync)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to insert message".to_string()),
            })
        })
}
