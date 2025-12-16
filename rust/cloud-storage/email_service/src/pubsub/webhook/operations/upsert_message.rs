use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::cg_refresh_email;
use crate::pubsub::webhook::operations::shared::notify_search;
use crate::pubsub::webhook::process;
use crate::pubsub::webhook::process::check_gmail_rate_limit_webhook;
use crate::util::process_pre_insert::{process_message_pre_insert, process_threads_pre_insert};
use crate::util::upload_attachment::{UploadAttachmentContext, upload_attachment};
use anyhow::Context;
use email_db_client::threads;
use email_utils::dedupe_emails;
use insight_service_client::InsightContextProvider;
use macro_user_id::user_id::MacroUserIdStr;
use model::contacts::ConnectionsMessage;
use model::insight_context::email_insights::{
    EMAIL_INSIGHT_PROVIDER_SOURCE_NAME, EmailInfo, GenerateEmailInsightContext, NewMessagePayload,
    NewMessagesPayload,
};
use model_entity::EntityType;
use model_notifications::{NewEmailMetadata, NotificationEvent, NotificationQueueMessage};
use models_email::db::address::EmailRecipientType;
use models_email::email::service;
use models_email::email::service::link;
use models_email::email::service::message::SimpleMessage;
use models_email::gmail::operations::GmailApiOperation;
use models_email::gmail::webhook::{UpsertMessagePayload, WebhookOperation};
use models_email::service::attachment::{AttachmentUploadArgs, AttachmentUploadDestination};
use models_email::service::message::Message;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_opensearch::SearchEntityType;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::name::EntityName;
use std::collections::HashSet;
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
    check_gmail_rate_limit_webhook(
        ctx,
        link.id,
        GmailApiOperation::MessagesGet,
        WebhookOperation::UpsertMessage(payload.clone()),
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
    let message_already_exists = email_db_client::messages::get::message_exists_by_provider_id(
        &ctx.db,
        &payload.provider_message_id,
        link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e
                .context("Failed to check whether provider_message_id already exists".to_string()),
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
        fetch_and_insert_thread(
            ctx,
            payload,
            &gmail_access_token,
            link.id,
            &provider_thread_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch and insert thread".to_string()),
            })
        })?;
    }

    let (message_db_id, thread_db_id) =
        email_db_client::messages::get::get_message_and_thread_id_by_provider_id(
            &ctx.db,
            link.id,
            &payload.provider_message_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to get new message db id".to_string()),
            })
        })?;

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

    notify_search(ctx, link, message_db_id).await?;

    // trigger FE inbox refresh
    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        "upsert_message",
    )
    .await;

    // notify downstream services of new messages
    if !message_already_exists {
        notify_for_new_message(
            ctx,
            link,
            &payload.provider_message_id,
            message_db_id,
            thread_db_id,
        )
        .await?;
    }

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
        || cfg!(not(feature = "attachment_upload"))
        || message_attachment_count == 0
    {
        return Ok(());
    }

    // upload attachments to Macro
    let (document_atts, media_atts) = tokio::try_join!(
        email_db_client::attachments::provider::upload::new_email_document_atts(
            &ctx.db,
            &payload.provider_message_id,
        ),
        email_db_client::attachments::provider::upload::new_email_media_atts(
            &ctx.db,
            &payload.provider_message_id,
        )
    )
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch attachments to insert".to_string()),
        })
    })?;

    let mut attachments = document_atts;
    attachments.extend(media_atts);
    if !attachments.is_empty() {
        tracing::info!(
            "Uploading attachments ({:?}) to Macro for new email",
            attachments
                .iter()
                .map(|a| a.attachment_db_id)
                .collect::<Vec<_>>()
        );

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
                            "Failed to fetch db recipients for thread attachment backfill"
                                .to_string(),
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
                backfill: false,
                upload_destination,
            };

            let ctx_upload = UploadAttachmentContext {
                db: &ctx.db,
                redis_client: &ctx.redis_client,
                gmail_client: &ctx.gmail_client,
                dss_client: &ctx.dss_client,
                sfs_client: &ctx.sfs_client,
                system_properties_service: &ctx.system_properties_service,
                access_token: gmail_access_token,
                link,
            };

            // keep processing if it fails, best effort
            if let Err(e) = upload_attachment(ctx_upload, &attachment_upload_args).await {
                tracing::error!("Failed to upload attachment to Macro: {e}");
            }
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
    if cfg!(not(feature = "contacts_sync")) || !is_sent || recipient_emails.is_empty() {
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
async fn generate_email_insights_for_new_message(
    ctx: &PubSubContext,
    link: &service::link::Link,
    message_id: Uuid,
    thread_id: Uuid,
) -> anyhow::Result<()> {
    // Fetch the thread and ensure it's an outbound thread (has latest_outbound)
    let thread =
        email_db_client::threads::get::get_thread_by_id_and_link_id(&ctx.db, thread_id, link.id)
            .await
            .context("Failed to fetch thread for new message")?;

    let Some(thread) = thread else {
        tracing::warn!(%thread_id, link_id = %link.id, "Thread not found; skipping insight generation");
        return Ok(());
    };

    if thread.latest_outbound_message_ts.is_none() {
        tracing::debug!(
            %thread_id,
            link_id = %link.id,
            "Thread has no latest_outbound_message_ts; skipping insight generation"
        );
        return Ok(());
    }

    let macro_user_id = link.macro_id.to_string();

    let context = GenerateEmailInsightContext {
        macro_user_id: macro_user_id.clone(),
        info: EmailInfo::NewMessages(NewMessagesPayload {
            messages: vec![NewMessagePayload {
                thread_id,
                message_id,
                user_email: link.email_address.0.as_ref().to_string(),
            }],
            batch_id: Uuid::new_v4().to_string(),
        }),
    };

    let provider =
        InsightContextProvider::create(ctx.sqs_client.clone(), EMAIL_INSIGHT_PROVIDER_SOURCE_NAME);

    if let Err(err) = provider.provide_email_context(context.clone()).await {
        tracing::error!(?context, error = %err, "Failed to provide email context to insight service");
    }

    Ok(())
}

/// Process and insert email threads by handling attachments and images
#[tracing::instrument(skip(ctx, gmail_access_token))]
async fn fetch_and_insert_thread(
    ctx: &PubSubContext,
    payload: &UpsertMessagePayload,
    gmail_access_token: &str,
    link_id: Uuid,
    provider_thread_id: &str,
) -> anyhow::Result<()> {
    // fetch threads
    check_gmail_rate_limit_webhook(
        ctx,
        link_id,
        GmailApiOperation::ThreadsGet,
        WebhookOperation::UpsertMessage(payload.clone()),
    )
    .await
    .map_err(anyhow::Error::from)?;

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

        // when a thread is created, add an entry into the names index for it
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

/// Notify downstream services about new message in a user's inbox
#[tracing::instrument(skip(ctx, link, new_message_provider_id))]
async fn notify_for_new_message(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_id: &str,
    message_db_id: Uuid,
    thread_id: Uuid,
) -> result::Result<(), ProcessingError> {
    // notify user of new messages
    send_notifications(ctx, link, new_message_provider_id).await?;

    generate_email_insights_for_new_message(ctx, link, message_db_id, thread_id)
        .await
        .ok();

    Ok(())
}

/// Send notifications for new inbound email messages

#[tracing::instrument(skip(ctx, link))]
async fn send_notifications(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_id: &str,
) -> result::Result<(), ProcessingError> {
    if !ctx.notifications_enabled {
        return Ok(());
    }

    let notifiable_message = filter_notifiable_message(ctx, link, new_message_provider_id).await?;

    let Some(message) = notifiable_message else {
        return Ok(());
    };

    let message_ids: Vec<Uuid> = vec![message.db_id];

    let sender_contacts =
        email_db_client::contacts::get::fetch_sender_contact_info(&ctx.db, &message_ids)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch contact info".to_string()),
                })
            })?;

    let sender_contact = message
        .from_contact_id
        .and_then(|from_id| sender_contacts.get(&from_id));

    let sender = sender_contact.map(|contact| {
        contact
            .name
            .clone()
            .unwrap_or_else(|| contact.email.clone())
    });

    let sender_id = sender_contact
        .and_then(|contact| MacroUserIdStr::try_from_email(&contact.email).ok())
        .map(|id| id.to_string());

    let notification_metadata = NewEmailMetadata {
        sender,
        to_email: link.email_address.0.as_ref().to_string(),
        thread_id: message.thread_db_id.to_string(),
        subject: message.subject.unwrap_or_default(),
        snippet: message.snippet.unwrap_or_default(),
    };

    let notification_queue_message = NotificationQueueMessage {
        notification_entity: EntityType::Email.with_entity_string(message.db_id.to_string()),
        notification_event: NotificationEvent::NewEmail(notification_metadata),
        sender_id,
        recipient_ids: Some(vec![link.macro_id.to_string()]),
    };

    if let Err(e) = ctx
        .macro_notify_client
        .send_notification(notification_queue_message)
        .await
    {
        tracing::error!(error=?e, "unable to send notification");
    }

    Ok(())
}

// filter out messages we don't want to send notifications for
#[tracing::instrument(skip(ctx, link))]
async fn filter_notifiable_message(
    ctx: &PubSubContext,
    link: &link::Link,
    new_message_provider_id: &str,
) -> result::Result<Option<SimpleMessage>, ProcessingError> {
    let new_message =
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &ctx.db,
            new_message_provider_id,
            &link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch simple message".to_string()),
            })
        })?;

    let Some(new_message) = new_message else {
        return Ok(None);
    };

    // 1. filter out sent and draft messages
    if new_message.is_sent || new_message.is_draft {
        return Ok(None);
    }

    // 2. filter out messages that don't make it to the user's inbox (spam, etc)
    let labels = email_db_client::labels::get::fetch_message_labels(&ctx.db, new_message.db_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch message labels".to_string()),
            })
        })?;

    let is_inbox = labels
        .iter()
        .any(|label| label.name == service::label::system_labels::INBOX);

    if !is_inbox {
        return Ok(None);
    }

    Ok(Some(new_message))
}
