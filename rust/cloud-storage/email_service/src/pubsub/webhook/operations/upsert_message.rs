use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::{cg_refresh_email, check_gmail_rate_limit};
use crate::pubsub::webhook::process;
use crate::util::process_pre_insert::{process_message_pre_insert, process_threads_pre_insert};
use crate::util::upload_attachment::upload_attachment;
use email_db_client::threads;
use email_db_client::threads::get::get_outbound_threads_by_thread_ids;
use email_utils::dedupe_emails;
use futures::future::join_all;
use insight_service_client::InsightContextProvider;
use model::contacts::ConnectionsMessage;
use model::insight_context::email_insights::{
    EMAIL_INSIGHT_PROVIDER_SOURCE_NAME, EmailInfo, GenerateEmailInsightContext, NewMessagePayload,
    NewMessagesPayload,
};
use model_notifications::{
    NewEmailMetadata, NotificationEntity, NotificationEvent, NotificationQueueMessage,
};
use models_email::email::service;
use models_email::email::service::link;
use models_email::email::service::message::SimpleMessage;
use models_email::email::service::thread::UserThreadIds;
use models_email::gmail::operations::GmailApiOperation;
use models_email::gmail::webhook::UpsertMessagePayload;
use models_email::service::message::Message;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_opensearch::SearchEntityType;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailMessage;
use sqs_client::search::name::EntityName;
use std::collections::{HashMap, HashSet};
use std::result;
use uuid::Uuid;

// upsert a message into the db. could be a new message or an existing one that had changes
#[tracing::instrument(skip(ctx))]
pub async fn upsert_message(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpsertMessagePayload,
) -> result::Result<(), ProcessingError> {
    let gmail_access_token = process::fetch_pubsub_gmail_token(ctx, link).await?;

    // we have to fetch the message to get its provider thread id
    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::MessagesGet,
        false,
    )
    .await?;
    let message = match ctx
        .gmail_client
        .get_message(&gmail_access_token, &payload.provider_message_id, link.id)
        .await
        .map_err(|e| {
            // retryable because we don't return an error if message doesn't exist, so this means
            // it had to be some sort of internal gmail api error
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get message from gmail api".to_string()),
            })
        })? {
        Some(msg) => msg,
        None => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in gmail when attempting to upsert");
            return Ok(());
        }
    };
    let message_attachment_count = message.attachments.len();

    // will always exist because we just fetched it
    let provider_thread_id = message.provider_thread_id.clone().unwrap();

    let is_sent = message.is_sent;

    // deduped list of all non-generic emails the message was sent to
    let recipient_emails = dedupe_emails(
        message
            .cc
            .iter()
            .map(|c| c.email.clone())
            .chain(message.to.iter().map(|t| t.email.clone()))
            .collect(),
    )
    .into_iter()
    .filter(|e| !email_utils::is_generic_email(e))
    .collect::<Vec<_>>();

    // determine if message's thread already exists in the database
    let thread_provider_to_db_map = threads::get::get_threads_by_link_id_and_provider_ids(
        &ctx.db,
        link.id,
        &HashSet::from([provider_thread_id.clone()]),
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to get threads by link id and provider ids".to_string()),
        })
    })?;

    // before upserting, figure out if the message is new so we can send a notification for it if so
    let new_message_provider_ids = email_db_client::messages::get::find_missing_provider_ids(
        &ctx.db,
        HashSet::from([payload.provider_message_id.clone()]),
        link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to find missing provider_ids".to_string()),
        })
    })?;

    // if the message's thread doesn't exist in the database, we need to fetch and insert the whole thread.
    // if it does exist in the database, we just need to insert the already fetched message.
    if let Some(thread_db_id) = thread_provider_to_db_map.get(&provider_thread_id) {
        process_and_insert_message(ctx, link.id, *thread_db_id, message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to process and insert message".to_string()),
                })
            })?;
    } else {
        fetch_and_insert_thread(ctx, &gmail_access_token, link.id, &provider_thread_id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch and insert thread".to_string()),
                })
            })?;
    }

    // trigger FE inbox refresh
    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        "upsert_message",
    )
    .await;

    // notify downstream services of new messages
    notify_for_new_messages(ctx, link, new_message_provider_ids).await?;

    handle_attachment_upload(
        ctx,
        &gmail_access_token,
        link,
        payload,
        message_attachment_count,
    )
    .await?;

    handle_contacts_sync(
        ctx,
        link,
        &recipient_emails,
        is_sent,
        &payload.provider_message_id,
    )
    .await?;

    Ok(())
}

#[tracing::instrument(skip(ctx, gmail_access_token))]
async fn handle_attachment_upload(
    ctx: &PubSubContext,
    gmail_access_token: &str,
    link: &link::Link,
    payload: &UpsertMessagePayload,
    message_attachment_count: usize,
) -> result::Result<(), ProcessingError> {
    // temporarily only for macro emails, for testing purposes
    if !link.macro_id.0.as_ref().ends_with("@macro.com")
        || cfg!(feature = "disable_attachment_upload")
        || message_attachment_count == 0
    {
        return Ok(());
    }

    // upload attachments to Macro
    let attachments =
        email_db_client::attachments::provider::upload::fetch_insertable_attachments_for_new_email(
            &ctx.db,
            &payload.provider_message_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch attachments to insert".to_string()),
            })
        })?;

    if !attachments.is_empty() {
        tracing::info!(
            "Uploading attachments ({:?}) to Macro for new email",
            attachments
                .iter()
                .map(|a| a.attachment_db_id)
                .collect::<Vec<_>>()
        );
    }

    for attachment in attachments {
        // keep processing if it fails, best effort
        if let Err(e) = upload_attachment(
            &ctx.redis_client,
            &ctx.gmail_client,
            &ctx.dss_client,
            gmail_access_token,
            link,
            &attachment,
        )
        .await
        {
            tracing::error!("Failed to upload attachment to Macro: {e}");
        }
    }

    Ok(())
}

#[tracing::instrument(skip(ctx, link, recipient_emails))]
async fn handle_contacts_sync(
    ctx: &PubSubContext,
    link: &link::Link,
    recipient_emails: &[String],
    is_sent: bool,
    provider_message_id: &str,
) -> result::Result<(), ProcessingError> {
    // if the user sent the message, upsert contacts for its recipients in contacts-service.
    if !cfg!(feature = "disable_contacts_sync") || !is_sent || recipient_emails.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "Upserting contacts {:?} for new sent message with id {}",
        recipient_emails,
        provider_message_id
    );

    // Create users list starting with the sender, then all recipients
    let mut users = vec![link.macro_id.to_string()];
    users.extend(
        recipient_emails
            .iter()
            .map(|email| format!("macro|{}", email)),
    );

    // Create connections from sender (index 0) to each recipient
    let connections = (1..users.len()).map(|i| (0, i)).collect::<Vec<_>>();

    let connections_message = ConnectionsMessage { users, connections };

    ctx.sqs_client
        .enqueue_contacts_add_connection(connections_message)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e.context(format!(
                    "Failed to enqueue contacts message for {}",
                    link.macro_id
                )),
            })
        })?;

    tracing::info!(
        "Successfully upserted contacts {:?} for new sent message with id {}",
        recipient_emails,
        provider_message_id
    );

    Ok(())
}

/// Sends new message context to the insight service
async fn generate_email_insights_for_new_messages(
    ctx: &PubSubContext,
    link: &service::link::Link,
    message_thread_ids: Vec<(Uuid, Uuid)>,
) -> anyhow::Result<()> {
    // maps macro user id to list of (thread_id, message_id)
    let mut user_messages: HashMap<String, Vec<NewMessagePayload>> = HashMap::new();
    for (message_id, thread_id) in message_thread_ids {
        // Use the correct macro_user_id for each message
        let macro_user_id = link.macro_id.clone();
        user_messages
            .entry(macro_user_id.to_string())
            .or_default()
            .push(NewMessagePayload {
                thread_id,
                message_id,
                user_email: link.email_address.0.as_ref().to_string(),
            });
    }

    let users_thread_ids: Vec<UserThreadIds> = user_messages
        .iter()
        .map(|(macro_user_id, messages)| UserThreadIds {
            macro_user_id: macro_user_id.clone(),
            thread_ids: messages.iter().map(|m| m.thread_id).collect(),
        })
        .collect();

    match get_outbound_threads_by_thread_ids(&ctx.db, users_thread_ids).await {
        Ok(users_outbound_threads) => {
            // for each user, filter out messages that are not part of an outbound thread
            let email_insight_new_message_payloads = user_messages
                .into_iter()
                .filter_map(|(macro_user_id, messages)| {
                    let user_outbound_thread_ids: HashSet<Uuid> = users_outbound_threads
                        .iter()
                        .filter_map(|t| {
                            if t.macro_user_id == macro_user_id {
                                Some(t.thread_ids.clone())
                            } else {
                                None
                            }
                        })
                        .flatten()
                        .collect();
                    let outbound_messages = messages
                        .iter()
                        .filter_map(|m| {
                            if user_outbound_thread_ids.contains(&m.thread_id) {
                                Some(m.clone())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    if outbound_messages.is_empty() {
                        return None;
                    }
                    Some(GenerateEmailInsightContext {
                        macro_user_id,
                        info: EmailInfo::NewMessages(NewMessagesPayload {
                            messages: outbound_messages,
                            batch_id: Uuid::new_v4().to_string(),
                        }),
                    })
                })
                .collect::<Vec<_>>();

            let contexts: Vec<_> = email_insight_new_message_payloads.into_iter().collect();

            let provider = InsightContextProvider::create(
                ctx.sqs_client.clone(),
                EMAIL_INSIGHT_PROVIDER_SOURCE_NAME,
            );

            // send per-user messages to insight service
            let results = join_all(
                contexts
                    .iter()
                    .map(|context| provider.provide_email_context(context.clone())),
            )
            .await;

            for (context, result) in contexts.into_iter().zip(results) {
                if let Err(err) = result {
                    tracing::error!(?context, error = %err, "Failed to provide email context to insight service");
                }
            }
        }
        Err(e) => {
            tracing::error!(error = ?e, "failed to get outbound threads");
        }
    }

    Ok(())
}

/// Process and insert email threads by handling attachments and images
#[tracing::instrument(skip(ctx, gmail_access_token))]
async fn fetch_and_insert_thread(
    ctx: &PubSubContext,
    gmail_access_token: &str,
    link_id: Uuid,
    provider_thread_id: &str,
) -> anyhow::Result<()> {
    // fetch threads
    check_gmail_rate_limit(
        &ctx.redis_client,
        link_id,
        GmailApiOperation::ThreadsGet,
        false,
    )
    .await?;
    let mut threads = ctx
        .gmail_client
        .get_threads(
            link_id,
            gmail_access_token,
            &vec![provider_thread_id.to_string()],
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get threads from gmail api".to_string()),
            })
        })?;

    // process threads
    process_threads_pre_insert(&ctx.db, &ctx.sfs_client, &mut threads).await;

    // insert threads into db
    for thread in threads.into_iter() {
        let thread_id = threads::insert::insert_thread_and_messages(&ctx.db, thread, link_id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to insert thread and messages".to_string()),
                })
            })?;

        // notify search about new entity
        ctx.sqs_client
            .send_message_to_search_event_queue(SearchQueueMessage::UpdateEntityName(EntityName {
                entity_id: thread_id,
                entity_type: SearchEntityType::Emails,
            }))
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to send message to search extractor queue"),
                })
            })?;
    }

    Ok(())
}

/// Process and insert message
#[tracing::instrument(skip(ctx))]
async fn process_and_insert_message(
    ctx: &PubSubContext,
    link_id: Uuid,
    thread_db_id: Uuid,
    mut message: Message,
) -> anyhow::Result<()> {
    process_message_pre_insert(&ctx.db, &ctx.sfs_client, &mut message).await;

    email_db_client::messages::insert::insert_message(
        &ctx.db,
        thread_db_id,
        &mut message,
        link_id,
        true,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to insert messages".to_string()),
        })
    })?;

    Ok(())
}

/// Notify downstream services about new messages in a user's inbox
#[tracing::instrument(skip(ctx, link, new_message_provider_ids))]
async fn notify_for_new_messages(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_ids: Vec<String>,
) -> result::Result<(), ProcessingError> {
    if new_message_provider_ids.is_empty() {
        return Ok(());
    }

    let new_message_db_ids =
        email_db_client::messages::get::get_message_thread_ids_by_provider_ids(
            &ctx.db,
            link.id,
            &new_message_provider_ids,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to get new message db ids".to_string()),
            })
        })?;

    // notify user of new messages
    send_notifications(ctx, link, new_message_provider_ids).await?;

    if !new_message_db_ids.is_empty() {
        // send message to search text extractor queue
        ctx.sqs_client
            .bulk_send_message_to_search_event_queue(
                new_message_db_ids
                    .iter()
                    .map(|(message_id, _thread_id)| {
                        SearchQueueMessage::ExtractEmailMessage(EmailMessage {
                            message_id: message_id.to_string(),
                            macro_user_id: link.macro_id.to_string(),
                        })
                    })
                    .collect(),
            )
            .await
            .inspect_err(
                |e| tracing::error!(error = ?e, "failed to send message to search extractor queue"),
            )
            .ok();

        generate_email_insights_for_new_messages(ctx, link, new_message_db_ids)
            .await
            .ok();
    }

    Ok(())
}

/// Send notifications for new inbound email messages
#[tracing::instrument(skip(ctx, link, new_message_provider_ids))]
async fn send_notifications(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_ids: Vec<String>,
) -> result::Result<(), ProcessingError> {
    if !ctx.notifications_enabled || new_message_provider_ids.is_empty() {
        return Ok(());
    }

    let notifiable_messages =
        filter_notifiable_messages(ctx, link, new_message_provider_ids).await?;

    if notifiable_messages.is_empty() {
        return Ok(());
    }

    let sender_address_ids: Vec<Uuid> = notifiable_messages
        .iter()
        .filter_map(|message| message.from_contact_id)
        .collect();

    let sender_contacts =
        email_db_client::contacts::get::fetch_contact_info_by_ids(&ctx.db, &sender_address_ids)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch contact info".to_string()),
                })
            })?;

    for message in notifiable_messages {
        // value is the sender's name if they have one, else their email address
        let sender = if let Some(from_id) = message.from_contact_id {
            sender_contacts.get(&from_id).map(|contact| {
                contact
                    .name
                    .clone()
                    .unwrap_or_else(|| contact.email.clone())
            })
        } else {
            None
        };

        let notification_metadata = NewEmailMetadata {
            sender,
            to_email: link.email_address.0.as_ref().to_string(),
            thread_id: message.thread_db_id.to_string(),
            subject: message.subject.unwrap_or_default(),
            snippet: message.snippet.unwrap_or_default(),
        };

        let notification_queue_message = NotificationQueueMessage {
            notification_entity: NotificationEntity::new_email(message.db_id.to_string()),
            notification_event: NotificationEvent::NewEmail(notification_metadata),
            sender_id: Some(link.macro_id.to_string()),
            recipient_ids: Some(vec![link.macro_id.to_string()]),
            is_important_v0: Some(false),
        };

        if let Err(e) = ctx
            .macro_notify_client
            .send_notification(notification_queue_message)
            .await
        {
            tracing::error!(error=?e, "unable to send notification");
        }
    }

    Ok(())
}

// filter out messages we don't want to send notifications for
#[tracing::instrument(skip(ctx, link, new_message_provider_ids))]
async fn filter_notifiable_messages(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_ids: Vec<String>,
) -> result::Result<Vec<SimpleMessage>, ProcessingError> {
    let new_messages = email_db_client::messages::get_simple_messages::get_simple_messages(
        &ctx.db,
        new_message_provider_ids,
        link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch simple messages".to_string()),
        })
    })?;

    // 1. filter out sent and draft messages
    let inbound_messages: Vec<SimpleMessage> = new_messages
        .into_iter()
        .filter(|message| !(message.is_sent || message.is_draft))
        .collect();

    if inbound_messages.is_empty() {
        return Ok(Vec::new());
    }

    // 2. filter out messages that don't make it to the user's inbox (spam, etc)
    let messages_labels_map = email_db_client::labels::get::fetch_message_labels_in_bulk(
        &ctx.db,
        &inbound_messages
            .iter()
            .map(|m| m.db_id)
            .collect::<Vec<Uuid>>(),
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch message labels".to_string()),
        })
    })?;

    let inbox_messages = inbound_messages
        .into_iter()
        .filter(|message| {
            let labels = messages_labels_map
                .get(&message.db_id)
                .unwrap_or(&Vec::new())
                .to_owned();

            labels
                .iter()
                .any(|label| label.name == service::label::system_labels::INBOX)
        })
        .collect();

    Ok(inbox_messages)
}
