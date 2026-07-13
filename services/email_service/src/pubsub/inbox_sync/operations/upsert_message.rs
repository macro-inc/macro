use crate::convert::{map_message_resource_to_service, map_thread_resources_to_service};
use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::operations::shared::notify_search;
use crate::pubsub::inbox_sync::process;
use crate::pubsub::inbox_sync::process::check_gmail_rate_limit_inbox_sync;
use crate::pubsub::util::cg_refresh_email;
use crate::pubsub::util::{
    CrmContactRecipient, build_notification_recipients, enqueue_populate_crm_contacts,
};
use crate::util::process_pre_insert::{process_message_pre_insert, process_threads_pre_insert};
use crate::util::upload_attachment::{UploadAttachmentContext, upload_attachment};
use contacts::domain::ports::ContactsIngress;
use email::domain::models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel};
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use email_db_client::threads;
use email_utils::dedupe_emails;
use filter_ast::Expr;
use item_filters::{SharedEmailFilter, ast::email::EmailLiteral};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::NewEmailMetadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::db::address::EmailRecipientType;
use models_email::email::service::link;
use models_email::email::service::message::SimpleMessage;
use models_email::gmail::inbox_sync::{InboxSyncOperation, UpsertMessagePayload};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::attachment::{AttachmentUploadArgs, AttachmentUploadDestination};
use models_email::service::message::{Message, is_spam_or_trash};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use std::collections::HashSet;
use std::result;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

// upsert a message into the db. could be a new message or an existing one that had changes
#[tracing::instrument(skip(ctx))]
pub async fn upsert_message(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpsertMessagePayload,
) -> result::Result<(), ProcessingError> {
    let gmail_access_token = process::fetch_pubsub_gmail_token(ctx, link).await?;

    // we have to fetch the message to get its provider thread id
    check_gmail_rate_limit_inbox_sync(
        ctx,
        link.id,
        GmailApiOperation::MessagesGet,
        InboxSyncOperation::UpsertMessage(payload.clone()),
    )
    .await?;

    let message_resource = match ctx
        .gmail_client
        .get_message(&gmail_access_token, &payload.provider_message_id)
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

    // Map Gmail resource to service model (IDs are generated in the parse function)
    let message = map_message_resource_to_service(message_resource, link.id).map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            source: e.context("Failed to map message resource to service".to_string()),
        })
    })?;
    let message_attachment_count = message.attachments.len();

    // will always exist because we just fetched it
    let provider_thread_id = message.provider_thread_id.clone().unwrap();

    let is_sent = message.is_sent;
    let is_spam_or_trash = is_spam_or_trash(&message);

    let sender_email = message
        .from
        .as_ref()
        .map(|from| from.email.clone())
        .filter(|e| !email_utils::is_generic_email(e));

    // deduped list of all non-generic emails the message was sent to
    let recipient_emails = dedupe_emails(
        message
            .to
            .iter()
            .chain(&message.cc)
            .chain(&message.bcc)
            .map(|c| c.email.clone())
            .collect(),
    )
    .into_iter()
    .filter(|e| !email_utils::is_generic_email(e))
    .collect::<Vec<_>>();

    // Snapshot `(email, name, first_at, last_at)` tuples for the CRM
    // populate fan-out below. Captured here (before `message` is moved
    // into `process_and_insert_message`) so the consumer can write
    // `crm_contacts.name` without a separate email_contacts lookup.
    //
    // Single message → single timestamp covers both endpoints; the
    // consumer merges with the stored range over time. Sent: enumerate
    // to/cc/bcc. Received: enumerate `from`. Drafts are skipped — they
    // don't represent real correspondence. No producer-side filtering
    // of addresses — the crm crate is the single source of truth.
    let is_draft = message.is_draft;
    // `Utc::now()` fallback when Gmail returned no internal_date_ts.
    let at = message.internal_date_ts.unwrap_or_else(chrono::Utc::now);
    let crm_recipients: Vec<CrmContactRecipient> = if is_draft {
        Vec::new()
    } else if is_sent {
        message
            .to
            .iter()
            .chain(&message.cc)
            .chain(&message.bcc)
            .map(|c| (c.email.clone(), c.name.clone(), at, at))
            .collect()
    } else {
        message
            .from
            .iter()
            .map(|c| (c.email.clone(), c.name.clone(), at, at))
            .collect()
    };

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
        sender_email.as_deref(),
        is_sent,
    )
    .await?;

    // Fan out a PopulateCrmContact job per address. Mirrors
    // `backfill_message.rs`: sent → to/cc/bcc, received → from,
    // drafts → skipped. The consumer branches on `is_sent` for the
    // company-insert gate.
    if !crm_recipients.is_empty() {
        let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
        enqueue_populate_crm_contacts(ctx, link.id, &self_email, crm_recipients, is_sent).await?;
    }

    notify_search(ctx, link, message_db_id, is_spam_or_trash).await?;

    // trigger FE inbox refresh
    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        RefreshEmailEvent::UpsertMessage { link_id: link.id },
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
    if cfg!(not(feature = "attachment_upload")) || message_attachment_count == 0 {
        return Ok(());
    }

    // upload attachments to Macro
    let (document_atts, media_atts) = tokio::try_join!(
        email_db_client::attachments::provider::upload::new_email_document_atts(
            &ctx.db,
            link.id,
            &payload.provider_message_id,
        ),
        email_db_client::attachments::provider::upload::new_email_media_atts(
            &ctx.db,
            link.id,
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

#[tracing::instrument(skip(ctx, link, recipient_emails, sender_email))]
async fn handle_contacts_sync(
    ctx: &PubSubContext,
    link: &link::Link,
    recipient_emails: &[String],
    sender_email: Option<&str>,
    is_sent: bool,
) -> result::Result<(), ProcessingError> {
    if cfg!(not(feature = "contacts_sync")) {
        return Ok(());
    }

    // Determine which emails to create connections to based on message direction
    let connection_emails: Vec<&str> = if is_sent {
        recipient_emails.iter().map(String::as_str).collect()
    } else {
        sender_email.into_iter().collect()
    };

    if connection_emails.is_empty() {
        return Ok(());
    }

    let users: std::collections::HashSet<MacroUserIdStr<'static>> =
        std::iter::once(Ok(link.macro_id.clone()))
            .chain(
                connection_emails
                    .iter()
                    .map(|email| MacroUserIdStr::try_from_email(email)),
            )
            .collect::<Result<_, _>>()
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: anyhow::anyhow!(e).context("invalid user email for contacts"),
                })
            })?;

    ctx.contacts_ingress
        .enqueue_contacts(users)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!("{e:?}").context(format!(
                    "Failed to enqueue contacts message for {}",
                    link.macro_id
                )),
            })
        })?;

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
    check_gmail_rate_limit_inbox_sync(
        ctx,
        link_id,
        GmailApiOperation::ThreadsGet,
        InboxSyncOperation::UpsertMessage(payload.clone()),
    )
    .await
    .map_err(anyhow::Error::from)?;

    let thread_resource = ctx
        .gmail_client
        .get_thread(gmail_access_token, provider_thread_id)
        .await
        .map_err(|e| {
            // retryable because a failure here is likely a transient Gmail API error,
            // matching the get_message error handling above
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get thread from gmail api".to_string()),
            })
        })?;

    // Map Gmail resources to service models (IDs are generated in the parse functions)
    let mut threads = map_thread_resources_to_service(vec![thread_resource], link_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to map thread resources: {}", e),
            })
        })?;

    // process threads
    process_threads_pre_insert(&mut threads).await;

    // insert threads into db
    for thread in threads.into_iter() {
        threads::insert::insert_thread_and_messages(&ctx.db, thread, link_id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to insert thread and messages".to_string()),
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
    process_message_pre_insert(&mut message).await;

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

    let sender_id =
        sender_contact.and_then(|contact| MacroUserIdStr::try_from_email(&contact.email).ok());

    let notification = NewEmailMetadata {
        sender,
        to_email: link.email_address.0.as_ref().to_string(),
        thread_id: message.thread_db_id.to_string(),
        subject: message.subject.unwrap_or_default(),
        snippet: message.snippet.unwrap_or_default(),
    };

    let primaries = macro_db_client::macro_user_links::get_primaries_for_link(
        &ctx.db,
        link.macro_id.as_ref(),
        link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch delegated primaries".to_string()),
        })
    })?;

    let recipient_ids = build_notification_recipients(&link.macro_id, primaries);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::EmailThread
            .with_entity_string(message.thread_db_id.to_string()),
        secondary_notification_entity: None,
        notification,
        sender_id,
        recipient_ids,
    }
    .into_request()
    .with_conn_gateway();

    if let Err(e) = ctx
        .notification_ingress_service
        .send_notification(request)
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

    // 2. Use the same dynamic email preview path as the Signal tab:
    //    emailView=inbox AND ef=(Importance(true) AND Shared(exclude)), scoped to this thread.
    let signal_filter = Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(new_message.thread_db_id)),
        Expr::and(
            Expr::Literal(EmailLiteral::Importance(true)),
            Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
        ),
    );

    let macro_id_str = link.macro_id.to_string();
    let user_id = MacroUserIdStr::parse_from_str(&macro_id_str).map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::InvalidData,
            source: anyhow::anyhow!("failed to parse macro user id: {}", e),
        })
    })?;

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![link.id],
        limit: 1,
        query: models_pagination::Query::Sort(
            models_pagination::SimpleSortMethod::UpdatedAt,
            Some(Arc::new(signal_filter)),
        ),
        team_id: None,
    };

    let previews = EmailPgRepo::new(ctx.db.clone())
        .previews_for_view_cursor(query, user_id.into_owned())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::new(e).context("Failed to evaluate Signal tab membership"),
            })
        })?;

    Ok((!previews.is_empty()).then_some(new_message))
}
