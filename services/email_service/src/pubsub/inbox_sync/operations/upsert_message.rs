use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::email_api_error::handle_operation_error;
use crate::pubsub::util::{
    CrmContactRecipient, build_notification_recipients, enqueue_populate_crm_contacts,
};
use crate::pubsub::util::{cg_refresh_email, publish_email_event};
use crate::util::process_pre_insert::{process_message_pre_insert, process_threads_pre_insert};
use crate::util::upload_attachment::{UploadAttachmentContext, upload_attachment};
use contacts::domain::models::messages::ContactConnection;
use contacts::domain::ports::ContactsIngress;
use email::domain::events::{
    EmailEventOrigin, EmailMacroEvent, MessageDraftSyncedMetadata, MessageReceivedMetadata,
    MessageSentMetadata,
};
use email::domain::models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel};
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use email_db_client::attachments::provider::upload_filters::{
    attachment_is_document, attachment_is_media,
};
use email_db_client::threads;
use email_utils::dedupe_emails;
use filter_ast::Expr;
use item_filters::{SharedEmailFilter, ast::email::EmailLiteral};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::NewEmailMetadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::db::address::EmailRecipientType;
use models_email::email::service::link;
use models_email::email::service::message::SimpleMessage;
use models_email::gmail::inbox_sync::{InboxSyncOperation, UpsertMessagePayload};
use models_email::service::attachment::{
    Attachment, AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use models_email::service::message::{Message, is_inbound, is_outbound, is_spam_or_trash};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::service::thread::Thread;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use std::collections::HashSet;
use std::result;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageSyncEventKind {
    DraftSynced,
    Received,
    Sent,
}

fn select_message_sync_event(
    existing_message_was_draft: Option<bool>,
    is_draft: bool,
    is_sent: bool,
) -> Option<MessageSyncEventKind> {
    if is_draft {
        return Some(MessageSyncEventKind::DraftSynced);
    }

    if existing_message_was_draft == Some(true) && is_sent {
        return Some(MessageSyncEventKind::Sent);
    }

    if existing_message_was_draft.is_some() {
        return None;
    }

    if is_sent {
        Some(MessageSyncEventKind::Sent)
    } else {
        Some(MessageSyncEventKind::Received)
    }
}

// upsert a message into the db. could be a new message or an existing one that had changes
#[tracing::instrument(skip(ctx))]
pub async fn upsert_message(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpsertMessagePayload,
) -> result::Result<(), ProcessingError> {
    let provider_message = ctx
        .email_api
        .get_message(link.id, &payload.provider_message_id)
        .await;
    let fetched = match provider_message {
        Ok(Some(fetched)) => fetched,
        Ok(None) => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in gmail when attempting to upsert");
            return Ok(());
        }
        Err(error) => {
            return Err(handle_operation_error(
                ctx,
                link.id,
                InboxSyncOperation::UpsertMessage(payload.clone()),
                error,
            )
            .await);
        }
    };
    let mut message = fetched.message;

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

    // Snapshot header-level fields for the macro.email event before
    // `message` is moved into the insert path. Bodies, snippets, and bcc
    // addresses are never published.
    let event_subject = message.subject.clone();
    let event_from = message.from.clone();
    let event_to_emails: Vec<String> = message.to.iter().map(|c| c.email.clone()).collect();
    let event_cc_emails: Vec<String> = message.cc.iter().map(|c| c.email.clone()).collect();
    let event_sent_at = message.sent_at.or(message.internal_date_ts);
    let event_received_at = message.internal_date_ts;

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

    // Snapshot the previous draft state before the upsert. Provider drafts are mutable,
    // and this state distinguishes a draft-to-sent transition from an unchanged message.
    let existing_message =
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &ctx.db,
            &payload.provider_message_id,
            &link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .context("Failed to fetch existing message before provider upsert".to_string()),
            })
        })?;
    let existing_message_was_draft = existing_message.as_ref().map(|message| message.is_draft);
    let message_already_exists = existing_message.is_some();

    let is_new_thread = !thread_provider_to_db_map.contains_key(&provider_thread_id);

    // if the message's thread doesn't exist in the database, we need to fetch and insert the whole thread.
    // if it does exist in the database, we just need to insert the already fetched message.
    if let Some(thread_db_id) = thread_provider_to_db_map.get(&provider_thread_id) {
        process_and_insert_message(ctx, link.id, *thread_db_id, &mut message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to process and insert message".to_string()),
                })
            })?;
    } else {
        // Propagated verbatim: fetch_and_insert_thread already routed provider
        // errors through handle_operation_error (retry queue vs redelivery),
        // and re-wrapping would double-process rate limits and mislabel
        // permanent failures as retryable.
        fetch_and_insert_thread(ctx, payload, link.id, &provider_thread_id).await?;
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

    // Publish to the macro.email topic immediately after the committed insert.
    // Drafts publish after every sync because their bodies are mutable. Existing
    // immutable messages remain suppressed except when a previously synced provider
    // draft becomes sent.
    if let Some(event_kind) =
        select_message_sync_event(existing_message_was_draft, is_draft, is_sent)
    {
        let event = match event_kind {
            MessageSyncEventKind::DraftSynced => {
                EmailMacroEvent::message_draft_synced(MessageDraftSyncedMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    message_id: message_db_id,
                    provider_message_id: payload.provider_message_id.clone(),
                    thread_id: thread_db_id,
                    provider_thread_id: provider_thread_id.clone(),
                    is_spam_or_trash,
                })
            }
            MessageSyncEventKind::Received => {
                EmailMacroEvent::message_received(MessageReceivedMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    message_id: message_db_id,
                    provider_message_id: payload.provider_message_id.clone(),
                    thread_id: thread_db_id,
                    provider_thread_id: provider_thread_id.clone(),
                    is_new_thread,
                    subject: event_subject,
                    from_email: event_from.as_ref().map(|contact| contact.email.clone()),
                    from_name: event_from.as_ref().and_then(|contact| contact.name.clone()),
                    to_emails: event_to_emails,
                    attachment_count: message_attachment_count as u32,
                    is_spam_or_trash,
                    received_at: event_received_at,
                })
            }
            MessageSyncEventKind::Sent => EmailMacroEvent::message_sent(MessageSentMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor: None,
                message_id: message_db_id,
                provider_message_id: payload.provider_message_id.clone(),
                thread_id: thread_db_id,
                provider_thread_id: provider_thread_id.clone(),
                subject: event_subject,
                to_emails: event_to_emails,
                cc_emails: event_cc_emails,
                origin: EmailEventOrigin::ProviderSync,
                sent_at: event_sent_at.unwrap_or_else(chrono::Utc::now),
            }),
        };
        publish_email_event(&ctx.macro_event_broker, &event);
    }

    handle_attachment_upload(ctx, link, payload, &message.attachments).await?;

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

#[tracing::instrument(skip(ctx, attachments), err)]
async fn handle_attachment_upload(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpsertMessagePayload,
    attachments: &[Attachment],
) -> result::Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    // Keep this parsed-attachment gate at least as permissive as the database claim filters.
    let eligibility = attachment_upload_eligibility(attachments);
    if !eligibility.documents && !eligibility.media {
        return Ok(());
    }

    // upload attachments to Macro
    let (document_atts, media_atts) = tokio::try_join!(
        async {
            if eligibility.documents {
                email_db_client::attachments::provider::upload::new_email_document_atts(
                    &ctx.db,
                    link.id,
                    &payload.provider_message_id,
                )
                .await
            } else {
                Ok(Vec::<AttachmentUploadMetadata>::new())
            }
        },
        async {
            if eligibility.media {
                email_db_client::attachments::provider::upload::new_email_media_atts(
                    &ctx.db,
                    link.id,
                    &payload.provider_message_id,
                )
                .await
            } else {
                Ok(Vec::<AttachmentUploadMetadata>::new())
            }
        }
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
                email_api: &ctx.email_api,
                dss_client: &ctx.dss_client,
                sfs_client: &ctx.sfs_client,
                system_properties_service: &ctx.system_properties_service,
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

#[derive(Debug, Default, PartialEq, Eq)]
struct AttachmentUploadEligibility {
    documents: bool,
    media: bool,
}

fn attachment_upload_eligibility(attachments: &[Attachment]) -> AttachmentUploadEligibility {
    let mut eligibility = AttachmentUploadEligibility::default();

    for attachment in attachments {
        let Some(mime_type) = attachment.mime_type.as_deref() else {
            continue;
        };

        eligibility.documents |= attachment_is_document(mime_type, attachment.filename.as_deref());
        eligibility.media |= attachment_is_media(mime_type);
    }

    eligibility
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

    let connections = connection_emails
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
                    link.macro_id
                )),
            })
        })?;

    Ok(())
}

/// Process and insert email threads by handling attachments and images
#[tracing::instrument(skip(ctx))]
async fn fetch_and_insert_thread(
    ctx: &PubSubContext,
    payload: &UpsertMessagePayload,
    link_id: Uuid,
    provider_thread_id: &str,
) -> result::Result<(), ProcessingError> {
    let messages = match ctx.email_api.get_thread(link_id, provider_thread_id).await {
        Ok(messages) => messages,
        Err(error) => {
            return Err(handle_operation_error(
                ctx,
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
#[tracing::instrument(skip(ctx))]
async fn process_and_insert_message(
    ctx: &PubSubContext,
    link_id: Uuid,
    thread_db_id: Uuid,
    message: &mut Message,
) -> anyhow::Result<()> {
    process_message_pre_insert(message).await;

    email_db_client::messages::insert::insert_message(
        &ctx.db,
        thread_db_id,
        message,
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

/// Who should get an in-app / push `new_email` notification for a synced inbox
/// message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NewEmailNotifyPolicy {
    /// Every non-sent, non-draft inbox message. Used for `@macro.com` dogfood.
    AllInbox,
    /// Signal-tab messages only. Default for customers.
    SignalOnly,
}

fn new_email_notify_policy(user_id: &MacroUserIdStr<'_>) -> NewEmailNotifyPolicy {
    if user_id.is_macro_staff() {
        NewEmailNotifyPolicy::AllInbox
    } else {
        NewEmailNotifyPolicy::SignalOnly
    }
}

/// Inbox-view filter for a synced thread. `AllInbox` keeps the Inbox view
/// (so spam, trash, and archive stay out) and skips only Signal predicates.
fn new_email_preview_filter(thread_id: Uuid, policy: NewEmailNotifyPolicy) -> Expr<EmailLiteral> {
    let thread = Expr::Literal(EmailLiteral::ThreadId(thread_id));
    match policy {
        NewEmailNotifyPolicy::AllInbox => thread,
        NewEmailNotifyPolicy::SignalOnly => Expr::and(
            thread,
            Expr::and(
                Expr::Literal(EmailLiteral::Importance(true)),
                Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
            ),
        ),
    }
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

    // 2. Inbox view membership, scoped to this thread. SignalOnly also
    //    requires Importance(true) AND Shared(exclude).
    let preview_filter = new_email_preview_filter(
        new_message.thread_db_id,
        new_email_notify_policy(&link.macro_id),
    );

    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![link.id],
        limit: 1,
        query: models_pagination::Query::Sort(
            models_pagination::SimpleSortMethod::UpdatedAt,
            Some(Arc::new(preview_filter)),
        ),
        team_id: None,
    };

    let previews = EmailPgRepo::new(ctx.db.clone())
        .previews_for_view_cursor(query, link.macro_id.clone())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::new(e).context("Failed to evaluate Signal tab membership"),
            })
        })?;

    Ok((!previews.is_empty()).then_some(new_message))
}
