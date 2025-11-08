use anyhow::{Context, anyhow};
use futures::{StreamExt, stream};
use gmail_client::GmailClient;
use models_email::service::contact::Contact;
use models_email::service::link::Link;
use models_email::service::pubsub::SFSUploaderMessage;
use models_email::service::sync_token::SyncTokens;
use sqlx::PgPool;
use sqs_client::SQS;
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

    match gmail_client
        .get_self_contact(gmail_access_token, link.id)
        .await
    {
        Ok(response) => {
            all_new_contacts.push(response);
            tracing::info!(
                link_id = %link.id,
                "Fetched own contact"
            );
        }
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link.id, "Failed to get own contact");
        }
    };

    let primary_start = Instant::now();
    match gmail_client
        .get_contacts(gmail_access_token, link.id, contacts_sync_token.as_deref())
        .await
    {
        Ok(response) => {
            let length = response.contacts.len();
            new_contacts_token = Some(response.next_sync_token);
            all_new_contacts.extend(response.contacts);
            tracing::info!(
                duration = ?primary_start.elapsed(),
                num_contacts = length,
                link_id = %link.id,
                "Fetched primary contacts"
            );
        }
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link.id, "Failed to get primary contacts");
        }
    };

    let other_start = Instant::now();
    match gmail_client
        .get_other_contacts(
            gmail_access_token,
            link.id,
            other_contacts_sync_token.as_deref(),
        )
        .await
    {
        Ok(response) => {
            let length = response.contacts.len();
            new_other_contacts_token = Some(response.next_sync_token);
            all_new_contacts.extend(response.contacts);
            tracing::info!(
                duration = ?other_start.elapsed(),
                num_contacts = length,
                link_id = %link.id,
                "Fetched other contacts"
            );
        }
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link.id, "Failed to get other contacts");
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

    if cfg!(feature = "disable_sfs_map") {
        return Ok(());
    }
    // Async enqueue messages to sfs_uploader worker that populates the sfs_url for the contacts profile images
    let sqs_start = Instant::now();
    let link_id = link.id;
    let sqs_client = sqs_client.clone();
    let contacts_for_sqs = contacts.clone();

    tokio::spawn(async move {
        const MAX_CONCURRENT_ENQUEUES: usize = 50;
        let mut successful_enqueues = 0;
        let mut failed_enqueues = 0;

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

        while let Some(result) = stream.next().await {
            match result {
                Ok(_) => successful_enqueues += 1,
                Err(_) => failed_enqueues += 1,
            }
        }

        tracing::info!(
            duration = ?sqs_start.elapsed(),
            successful_enqueues = successful_enqueues,
            failed_enqueues = failed_enqueues,
            link_id = %link_id,
            "Completed SQS enqueuing"
        );
    });

    Ok(())
}
