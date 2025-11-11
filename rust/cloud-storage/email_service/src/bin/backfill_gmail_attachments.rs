/// backfill_search.rs is used to trigger a backfill for email search across all threads available
/// in the email_db.
/// Required environment variables:
/// - DATABASE_URL
/// - SEARCH_EVENT_QUEUE
use anyhow::Context;
use base64::Engine;
use macro_entrypoint::MacroEntrypoint;
use model::document::response::CreateDocumentRequest;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;

#[derive(Clone)]
pub struct AttachmentMetadata {
    pub provider_id: String,
    pub provider_attachment_id: String,
    pub mime_type: String,
    pub file_name: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let dss_url = std::env::var("DSS_URL").context("DSS_URL not set")?;
    let source_gmail_access_token =
        std::env::var("GMAIL_ACCESS_TOKEN").context("GMAIL_ACCESS_TOKEN not set")?;
    let destination_macro_access_token =
        std::env::var("MACRO_ACCESS_TOKEN").context("MACRO_ACCESS_TOKEN not set")?;
    let macro_account_source =
        std::env::var("MACRO_ACCOUNT_SOURCE").context("MACRO_ACCOUNT_SOURCE not set")?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL not set")?;
    let db = PgPoolOptions::new()
        .min_connections(10)
        .max_connections(60)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let dss_client = document_storage_service_client::DocumentStorageServiceClient::new(
        "external_only".to_string(),
        dss_url,
    );
    let gmail_client = gmail_client::GmailClient::new("unused".to_string());

    // First get the link_id for the user
    let link_id = sqlx::query_scalar!(
        "SELECT id FROM email_links WHERE macro_id = $1",
        macro_account_source
    )
    .fetch_one(&db)
    .await
    .context("Failed to find link_id for macro_account")?;

    // attachments from threads where the user sent at least one message
    let attachments_condition_1 = sqlx::query_as!(
        AttachmentMetadata,
        r#"
    SELECT
        m.provider_id as "provider_id!",
        a.provider_attachment_id as "provider_attachment_id!",
        a.mime_type as "mime_type!",
        a.filename as "file_name!"
    FROM
        email_attachments a
    JOIN
        email_messages m ON a.message_id = m.id
    JOIN
        email_threads t ON m.thread_id = t.id
    WHERE
        t.link_id = $1
        AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics')
        AND EXISTS (
            SELECT 1
            FROM email_messages user_msg
            WHERE user_msg.thread_id = t.id
            AND user_msg.is_sent = true
        )
    ORDER BY
        a.created_at ASC
    "#,
        link_id
    )
    .fetch_all(&db)
    .await
    .context("Failed to fetch attachments for user threads")?;

    println!(
        "Number of attachments from condition 1: {}",
        attachments_condition_1.len()
    );

    // attachments from threads where the user has previously sent at least one message to one participant
    let attachments_condition_2 = sqlx::query_as!(
        AttachmentMetadata,
        r#"
        SELECT DISTINCT
            m.provider_id as "provider_id!",
            a.provider_attachment_id as "provider_attachment_id!",
            a.mime_type as "mime_type!",
            a.filename as "file_name!"
        FROM
            email_attachments a
        JOIN
            email_messages m ON a.message_id = m.id
        JOIN
            email_threads t ON m.thread_id = t.id
        WHERE
            t.link_id = $1
            AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics')
            AND EXISTS (
                SELECT 1
                FROM email_messages sent_msg
                JOIN email_message_recipients sent_recipients ON sent_msg.id = sent_recipients.message_id
                JOIN email_contacts sent_contact ON sent_recipients.contact_id = sent_contact.id
                WHERE sent_msg.link_id = $1
                AND sent_msg.is_sent = true
                AND EXISTS (
                    SELECT 1
                    FROM email_messages thread_msg
                    JOIN email_message_recipients thread_recipients ON thread_msg.id = thread_recipients.message_id
                    JOIN email_contacts thread_contact ON thread_recipients.contact_id = thread_contact.id
                    WHERE thread_msg.thread_id = t.id
                    AND thread_contact.email_address = sent_contact.email_address
                )
            );
        "#,
        link_id
    )
            .fetch_all(&db)
            .await
            .context("Failed to fetch attachments for user threads")?;

    println!(
        "Number of attachments from condition 2: {}",
        attachments_condition_2.len()
    );

    // attachments from threads where at least one message was labelled as IMPORTANT
    let attachments_condition_3 = sqlx::query_as!(
        AttachmentMetadata,
        r#"
    SELECT DISTINCT
        m.provider_id as "provider_id!",
        a.provider_attachment_id as "provider_attachment_id!",
        a.mime_type as "mime_type!",
        a.filename as "file_name!"
    FROM
        email_attachments a
    JOIN
        email_messages m ON a.message_id = m.id
    JOIN
        email_threads t ON m.thread_id = t.id
    WHERE
        t.link_id = $1
        AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics')
        AND EXISTS (
            -- Check if any message in this thread has the IMPORTANT label
            SELECT 1
            FROM email_messages thread_msg
            JOIN email_message_labels ml ON thread_msg.id = ml.message_id
            JOIN email_labels l ON ml.label_id = l.id
            WHERE thread_msg.thread_id = t.id
            AND l.name = 'IMPORTANT'
    );
    "#,
        link_id
    )
    .fetch_all(&db)
    .await
    .context("Failed to fetch attachments for user threads")?;

    println!(
        "Number of attachments from condition 3: {}",
        attachments_condition_3.len()
    );

    // attachments from threads where at least one message was sent by an address with the same company domain as the user
    let attachments_condition_4 = sqlx::query_as!(
        AttachmentMetadata,
        r#"
    SELECT DISTINCT
        m.provider_id as "provider_id!",
        a.provider_attachment_id as "provider_attachment_id!",
        a.mime_type as "mime_type!",
        a.filename as "file_name!"
    FROM
        email_attachments a
    JOIN
        email_messages m ON a.message_id = m.id
    JOIN
        email_threads t ON m.thread_id = t.id
    JOIN
        email_links el ON t.link_id = el.id
    WHERE
        t.link_id = $1
        AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics')
        AND EXISTS (
            -- Check if any message in this thread was sent by someone from the same company domain
            SELECT 1
            FROM email_messages thread_msg
            JOIN email_contacts c ON thread_msg.from_contact_id = c.id
            WHERE thread_msg.thread_id = t.id
            AND SPLIT_PART(c.email_address, '@', 2) = SPLIT_PART(el.email_address, '@', 2)
        );
    "#,
        link_id
    )
    .fetch_all(&db)
    .await
    .context("Failed to fetch attachments for user threads")?;

    println!(
        "Number of attachments from condition 4: {}",
        attachments_condition_4.len()
    );

    // Combine all attachment vectors
    let all_attachments = [
        attachments_condition_1,
        attachments_condition_2,
        attachments_condition_3,
        attachments_condition_4,
    ]
    .concat();

    // Create HashMap with unique attachments
    let unique_attachments: HashMap<(String, String), AttachmentMetadata> = all_attachments
        .into_iter()
        .map(|attachment| {
            let key = (
                attachment.provider_id.clone(),
                attachment.provider_attachment_id.clone(),
            );
            (key, attachment)
        })
        .collect();

    let unique_attachments_vec: Vec<AttachmentMetadata> =
        unique_attachments.into_values().collect();

    println!("Total unique attachments: {}", unique_attachments_vec.len());

    // upload attachments

    for db_attachment in unique_attachments_vec {
        let attachment_data = gmail_client
            .get_attachment_data(
                &source_gmail_access_token,
                &db_attachment.provider_id,
                &db_attachment.provider_attachment_id,
            )
            .await
            .unwrap();

        let mut hasher = Sha256::new();
        hasher.update(&attachment_data);
        let result = hasher.finalize();
        let base64_encoded_sha = base64::engine::general_purpose::STANDARD.encode(result);
        let result_string = format!("{:x}", result);

        let file_name = db_attachment
            .file_name
            .split('.')
            .next()
            .unwrap()
            .to_string();
        let file_type = match mime_guess::get_mime_extensions_str(&db_attachment.mime_type) {
            Some(extensions) => extensions[0].to_string(),
            None => continue,
        };

        // get presigned url from dss call
        let dss_response = dss_client
            .create_document(
                CreateDocumentRequest {
                    id: None,
                    sha: result_string,
                    document_name: file_name,
                    file_type: Some(file_type),
                    mime_type: Some(db_attachment.mime_type.clone()),
                    document_family_id: None,
                    branched_from_id: None,
                    branched_from_version_id: None,
                    job_id: None,
                    project_id: None,
                },
                &destination_macro_access_token,
            )
            .await?;

        let presigned_url = dss_response.data.document_response.presigned_url.unwrap();

        // Upload the file data to S3
        let upload_response = reqwest::Client::new()
            .put(&presigned_url)
            .header("content-type", dss_response.data.content_type)
            .header("x-amz-checksum-sha256", base64_encoded_sha)
            .body(attachment_data)
            .send()
            .await?;

        // Check if upload was successful
        if upload_response.status().is_success() {
            println!(
                "Successfully uploaded attachment: {}",
                db_attachment.file_name
            );
        } else {
            eprintln!(
                "Upload failed with status {}: {}",
                upload_response.status(),
                upload_response.text().await.unwrap_or_default()
            );
            // Handle error as needed
        }
    }

    // upload

    Ok(())
}
