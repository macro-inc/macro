use crate::convert::map_person_to_contact;
use anyhow::{Context, anyhow};
use futures::{StreamExt, stream};
use gmail_client::GmailClient;
use models_email::service::contact::Contact;
use models_email::service::link::Link;
use models_email::service::pubsub::SFSUploaderMessage;
use models_email::service::sync_token::SyncTokens;
use sqlx::PgPool;
use sqs_client::SQS;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailThreadBatchMessage;
use std::collections::HashSet;
use std::time::Instant;

/// Syncs user's contacts with gmail
pub async fn sync_contacts(
    link: &Link,
    db: &PgPool,
    gmail_client: &GmailClient,
    sqs_client: &SQS,
    gmail_access_token: &str,
) -> anyhow::Result<()> {
    // 1. Get existing sync tokens from our DB
    let (contacts_sync_token, other_contacts_sync_token) =
        fetch_existing_sync_tokens(db, link).await?;

    // 2. Fetch new contacts and the corresponding new sync tokens from the Gmail API
    let (new_contacts, new_tokens) = fetch_new_contacts_from_google(
        gmail_client,
        link,
        gmail_access_token,
        contacts_sync_token,
        other_contacts_sync_token,
    )
    .await;

    // 3. If we received any new/updated contacts, process and store them.
    if !new_contacts.is_empty() {
        process_and_store_contacts(db, sqs_client, link, new_contacts).await?;
    }

    // 4. Store the new sync tokens in our DB
    email_db_client::sync_tokens::insert::insert_sync_tokens(db, new_tokens)
        .await
        .with_context(|| format!("Unable to insert new sync tokens for link_id: {}", link.id))?;

    Ok(())
}

/// Retrieves the current contact and other_contact sync tokens from the database for a given link.
async fn fetch_existing_sync_tokens(
    db: &PgPool,
    link: &Link,
) -> anyhow::Result<(Option<String>, Option<String>)> {
    let sync_tokens = email_db_client::sync_tokens::get::get_sync_tokens_by_link_id(db, link.id)
        .await
        .with_context(|| "Unable to fetch sync tokens for link")?;

    let tokens = sync_tokens
        .map(|t| (t.contacts_sync_token, t.other_contacts_sync_token))
        .unwrap_or((None, None));

    Ok(tokens)
}

/// Fetches primary and "other" contacts from the Google API.
/// Errors from the API are logged but do not cause this function to fail.
async fn fetch_new_contacts_from_google(
    gmail_client: &GmailClient,
    link: &Link,
    gmail_access_token: &str,
    contacts_sync_token: Option<String>,
    other_contacts_sync_token: Option<String>,
) -> (Vec<Contact>, SyncTokens) {
    let mut all_new_contacts: Vec<Contact> = Vec::new();
    let mut new_contacts_token = None;
    let mut new_other_contacts_token = None;

    match gmail_client.get_self_contact(gmail_access_token).await {
        Ok(person_resource) => {
            let contact = map_person_to_contact(link.id, person_resource);
            all_new_contacts.push(contact);
        }
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link.id, "Failed to get own contact");
        }
    };

    match gmail_client
        .get_contacts(gmail_access_token, contacts_sync_token.as_deref())
        .await
    {
        Ok((person_resources, sync_token)) => {
            new_contacts_token = Some(sync_token);
            let contacts = person_resources
                .into_iter()
                .map(|p| map_person_to_contact(link.id, p));
            all_new_contacts.extend(contacts);
        }
        Err(e) => {
            tracing::debug!(error = ?e, link_id = %link.id, "Failed to get primary contacts");
        }
    };

    match gmail_client
        .get_other_contacts(gmail_access_token, other_contacts_sync_token.as_deref())
        .await
    {
        Ok((person_resources, sync_token)) => {
            new_other_contacts_token = Some(sync_token);
            let contacts = person_resources
                .into_iter()
                .map(|p| map_person_to_contact(link.id, p));
            all_new_contacts.extend(contacts);
        }
        Err(e) => {
            tracing::debug!(error = ?e, link_id = %link.id, "Failed to get other contacts");
        }
    };

    let new_sync_tokens = SyncTokens {
        contacts_sync_token: new_contacts_token,
        other_contacts_sync_token: new_other_contacts_token,
        link_id: link.id,
    };

    (all_new_contacts, new_sync_tokens)
}

/// Handles processing (SFS uploads) and database storage for a list of contacts.
async fn process_and_store_contacts(
    db: &PgPool,
    sqs_client: &SQS,
    link: &Link,
    contacts: Vec<Contact>,
) -> anyhow::Result<()> {
    // deduplicate on email_address and resize image to 128px instead of 100px
    let mut seen_emails: HashSet<String> = HashSet::new();
    let mut deduplicated_contacts: Vec<Contact> = Vec::new();

    for mut contact in contacts {
        if let Some(email) = &contact.email_address {
            let normalized_email = email.trim().to_lowercase();
            if !normalized_email.is_empty() && seen_emails.insert(normalized_email) {
                // s___ at the end of the url specifies the height/width of the image
                if let Some(original_photo_url) = &contact.original_photo_url
                    && original_photo_url.ends_with("s100")
                {
                    let updated_url =
                        original_photo_url.strip_suffix("s100").unwrap().to_string() + "s128";
                    contact.original_photo_url = Some(updated_url);
                }

                deduplicated_contacts.push(contact);
            }
        }
    }
    let contacts = deduplicated_contacts;

    let db_start = Instant::now();
    // Insert the processed contacts into the database without sfs_urls
    let (_rows_affected, changed_contact_ids) =
        email_db_client::contacts::upsert_sync::upsert_contacts(db, &contacts)
            .await
            .map_err(|e| {
                let error_message = "Unable to upsert contacts into DB";
                tracing::error!(error = ?e, link_id = %link.id, error_message);
                anyhow!(error_message)
            })?;

    tracing::info!(
        duration = ?db_start.elapsed(),
        num_contacts = contacts.len(),
        link_id = %link.id,
        "Inserted contacts into DB"
    );

    if !changed_contact_ids.is_empty() {
        reindex_threads_for_changed_contacts(db, sqs_client, link, &changed_contact_ids).await;
    }

    if cfg!(not(feature = "sfs_map")) {
        return Ok(());
    }
    // Async enqueue messages to sfs_uploader worker that populates the sfs_url for the contacts profile images
    let sqs_client = sqs_client.clone();
    let contacts_for_sqs = contacts.clone();

    tokio::spawn(async move {
        const MAX_CONCURRENT_ENQUEUES: usize = 50;

        let mut stream = stream::iter(contacts_for_sqs)
            // only enqueue contacts that have a photo_url
            .filter(|contact| futures::future::ready(contact.original_photo_url.is_some()))
            .map(|contact| {
                let sqs_client = sqs_client.clone();
                async move {
                    sqs_client
                        .enqueue_email_sfs_uploader_message(SFSUploaderMessage { contact })
                        .await
                        .map_err(|e| {
                            tracing::error!(error = ?e, "Unable to enqueue SFSUploaderMessage");
                            e
                        })
                }
            })
            .buffer_unordered(MAX_CONCURRENT_ENQUEUES);

        while stream.next().await.is_some() {}
    });

    Ok(())
}

const REINDEX_BATCH_SIZE: usize = 50;

#[tracing::instrument(skip(db, sqs_client, link, changed_contact_ids))]
async fn reindex_threads_for_changed_contacts(
    db: &PgPool,
    sqs_client: &SQS,
    link: &Link,
    changed_contact_ids: &[uuid::Uuid],
) {
    let thread_ids = match email_db_client::threads::get::get_thread_ids_by_contact_ids(
        db,
        changed_contact_ids,
    )
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!(error=?e, link_id=%link.id, "Failed to get thread IDs for changed contacts");
            return;
        }
    };

    if thread_ids.is_empty() {
        return;
    }

    let macro_user_id = link.macro_id.to_string();

    tracing::info!(
        num_threads = thread_ids.len(),
        num_changed_contacts = changed_contact_ids.len(),
        link_id = %link.id,
        "Re-indexing threads for contacts with name changes"
    );

    let messages: Vec<SearchQueueMessage> = thread_ids
        .chunks(REINDEX_BATCH_SIZE)
        .map(|chunk| {
            SearchQueueMessage::ExtractEmailThreadBatch(EmailThreadBatchMessage {
                thread_ids: chunk.iter().map(|id| id.to_string()).collect(),
                macro_user_id: macro_user_id.clone(),
                index_override: None,
            })
        })
        .collect();

    if let Err(e) = sqs_client
        .bulk_send_message_to_search_event_queue(messages)
        .await
    {
        tracing::error!(error=?e, link_id=%link.id, "Failed to enqueue search re-index messages for contact name changes");
    }
}
