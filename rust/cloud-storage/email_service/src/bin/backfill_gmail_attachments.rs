//! # Attachment Backfill Utility
//!
//! This binary is used to find and upload relevant email attachments for a given user account.
//! It fetches attachment metadata from the local database based on several heuristics,
//! downloads the actual attachment data from Gmail, and uploads it to a document storage service.
//!
//! ## Required Environment Variables:
//! - `DATABASE_URL`: The connection string for the PostgreSQL database.
//! - `DSS_URL`: The URL for the Document Storage Service.
//! - `GMAIL_ACCESS_TOKEN`: An OAuth token to access the user's Gmail account.
//! - `MACRO_ACCESS_TOKEN`: An access token for authenticating with internal Macro services.
//! - `MACRO_ACCOUNT_SOURCE`: The Macro ID of the user account to process.

use crate::processing::AttachmentProcessor;
use anyhow::Context;
use futures::{StreamExt, stream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
// --- Main Application Logic ---

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initializes logging and other boilerplate.

    // 1. Load configuration from environment variables. Fails early if anything is missing.
    println!("Loading configuration...");
    let config = config::Config::from_env().context("Failed to load configuration")?;

    // 2. Establish a connection pool to the database.
    println!("Connecting to the database...");
    let db_pool = database::create_db_pool(&config.database_url)
        .await
        .context("Failed to create database pool")?;

    // 3. Set up clients for external services.
    let dss_client = document_storage_service_client::DocumentStorageServiceClient::new(
        "external_only".to_string(),
        config.dss_url.clone(),
    );
    let gmail_client = gmail_client::GmailClient::new("unused".to_string());

    // 4. Fetch the link_id associated with the user's account.
    let link_id = database::get_link_id(&db_pool, &config.macro_account_source)
        .await
        .context("Could not find a link_id for the specified MACRO_ACCOUNT_SOURCE")?;

    // 5. Fetch all relevant attachment metadata from the database, running queries concurrently.
    println!("Fetching unique attachment metadata from database...");
    let attachments = database::fetch_unique_attachments(&db_pool, link_id)
        .await
        .context("Failed to fetch attachment metadata")?;
    println!("Found {} unique attachments to process.", attachments.len());

    // 6. Process and upload each attachment.
    let processor = Arc::new(processing::AttachmentProcessor::new(
        dss_client,
        gmail_client,
        config.gmail_access_token.clone(),
        config.macro_access_token.clone(),
    ));

    let success_count = Arc::new(AtomicUsize::new(0));
    let total_attachments = attachments.len();

    println!("Starting concurrent upload process...");

    stream::iter(attachments.into_iter().enumerate())
        .for_each_concurrent(config.upload_concurrency, |(index, attachment)| {
            let processor: Arc<AttachmentProcessor> = Arc::clone(&processor);
            let success_count = Arc::clone(&success_count);

            async move {
                match processor.upload(&attachment).await {
                    Ok(_) => {
                        success_count.fetch_add(1, Ordering::Relaxed);
                        println!("Successfully uploaded '{}' (index: {})", attachment.filename, index);
                    }
                    Err(e) => {
                        if e.to_string().contains("file extension") {
                            println!(
                                "Skipping '{}' (index: {}) due to unsupported mime type {}",
                                attachment.filename, index, attachment.mime_type
                            );
                            return;
                        }
                        // Using structured logging is better for concurrent tasks
                        panic!(
                            "Failed to upload attachment - filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, error: {:?}",
                            attachment.filename,
                            attachment.provider_attachment_id,
                            attachment.provider_id,
                            index,
                            e
                        );
                    }
                }
            }
        })
        .await;

    let final_success_count = success_count.load(Ordering::SeqCst);
    println!(
        "Processing complete. Successfully uploaded {} out of {} attachments.",
        final_success_count, total_attachments
    );

    Ok(())
}

// --- Data Models ---

mod models {
    use sqlx::FromRow;
    use sqlx::types::chrono::{DateTime, Utc};

    /// Represents the metadata for an email attachment stored in our database.
    #[derive(Clone, Debug, FromRow)]
    pub struct AttachmentMetadata {
        pub provider_id: String,
        pub provider_attachment_id: String,
        pub mime_type: String,
        pub filename: String,
        pub internal_date_ts: DateTime<Utc>,
    }
}

// --- Configuration ---

mod config {
    use anyhow::{Context, Result};
    use url::form_urlencoded::parse;

    /// Holds all configuration loaded from environment variables.
    pub struct Config {
        pub dss_url: String,
        pub gmail_access_token: String,
        pub macro_access_token: String,
        pub macro_account_source: String,
        pub database_url: String,
        pub upload_concurrency: usize,
    }

    impl Config {
        /// Creates a new `Config` instance by reading from environment variables.
        /// Returns an error if any required variable is not set.
        pub fn from_env() -> Result<Self> {
            // --- NEW: Load concurrency level from env with a default ---
            let upload_concurrency =
                std::env::var("UPLOAD_CONCURRENCY").context("UPLOAD_CONCURRENCY not set")?;
            let upload_concurrency = upload_concurrency
                .parse::<usize>()
                .context("UPLOAD_CONCURRENCY is not a number")?;

            Ok(Self {
                dss_url: std::env::var("DSS_URL").context("DSS_URL not set")?,
                gmail_access_token: std::env::var("GMAIL_ACCESS_TOKEN")
                    .context("GMAIL_ACCESS_TOKEN not set")?,
                macro_access_token: std::env::var("MACRO_ACCESS_TOKEN")
                    .context("MACRO_ACCESS_TOKEN not set")?,
                macro_account_source: std::env::var("MACRO_ACCOUNT_SOURCE")
                    .context("MACRO_ACCOUNT_SOURCE not set")?,
                database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
                upload_concurrency,
            })
        }
    }
}

// --- Database Operations ---

mod database {
    use super::models::AttachmentMetadata;
    use anyhow::Context;
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;
    use std::collections::HashMap;
    use uuid::Uuid;

    // SQL queries are defined as constants for clarity and reuse.
    const BASE_ATTACHMENT_QUERY_PREFIX: &str = r#"
        SELECT DISTINCT
            m.provider_id,
            a.provider_attachment_id,
            a.mime_type,
            a.filename,
            m.internal_date_ts
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        JOIN email_threads t ON m.thread_id = t.id
    "#;

    const ATTACHMENT_FILTERS: &str = r#"
        WHERE t.link_id = $1
        AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics', 'application/zip', 'application/x-zip-compressed', 'application/x-sharing-metadata-xml')
        AND a.filename IS NOT NULL
    "#;

    // Condition 1: User sent a message in the thread.
    const SENT_IN_THREAD_CONDITION: &str = r#"
        AND EXISTS (
            SELECT 1 FROM email_messages user_msg
            WHERE user_msg.thread_id = t.id AND user_msg.is_sent = true
        )
    "#;

    // Condition 2: Thread involves a recipient the user has previously sent mail to.
    const PREVIOUSLY_CONTACTED_CONDITION: &str = r#"
-- Use CTEs to define our sets of data logically before joining them.
WITH
-- Step 1: Get the user's own email address from the link_id. This is our exclusion criteria.
user_email AS (
    SELECT
        email_address
    FROM
        public.email_links
    WHERE
        id = $1 -- Your link_id
),

-- Step 2: Create a distinct list of OTHER people this user has ever sent mail to.
previously_contacted_emails AS (
    SELECT DISTINCT
        ec.email_address
    FROM
        public.email_messages em
    JOIN
        public.email_message_recipients emr ON em.id = emr.message_id
    JOIN
        public.email_contacts ec ON emr.contact_id = ec.id
    WHERE
        em.link_id = $1
        AND em.is_sent = true
        AND ec.email_address != (SELECT email_address FROM user_email)
),

-- Step 3: For each thread, create a complete list of OTHER participant email addresses.
thread_participants AS (
    -- Get all senders in each thread (excluding the user)
    SELECT DISTINCT
        em.thread_id,
        ec.email_address
    FROM
        public.email_messages em
    JOIN
        public.email_contacts ec ON em.from_contact_id = ec.id
    WHERE
        em.link_id = $1
        AND ec.email_address != (SELECT email_address FROM user_email)

    UNION

    -- Get all recipients in each thread (excluding the user)
    SELECT DISTINCT
        em.thread_id,
        ec.email_address
    FROM
        public.email_messages em
    JOIN
        public.email_message_recipients emr ON em.id = emr.message_id
    JOIN
        public.email_contacts ec ON emr.contact_id = ec.id
    WHERE
        em.link_id = $1
        AND ec.email_address != (SELECT email_address FROM user_email)
)

-- Final Step: Select attachments from threads where AT LEAST ONE of the OTHER participants
--             is in the list of OTHER previously_contacted_emails.
SELECT
    m.provider_id,
    a.provider_attachment_id,
    a.filename,
    a.mime_type,
    m.internal_date_ts
FROM
    public.email_attachments a
JOIN
    public.email_messages m ON a.message_id = m.id
JOIN
    public.email_contacts from_contact ON m.from_contact_id = from_contact.id
WHERE
    m.thread_id IN (
        -- This subquery now identifies the threads that ARE "familiar"
        SELECT DISTINCT
            tp.thread_id
        FROM
            thread_participants tp
        -- An INNER JOIN finds the intersection between thread participants and known contacts.
        -- This is the only part that changed.
        INNER JOIN
            previously_contacted_emails pce ON tp.email_address = pce.email_address
    )
    -- Apply your standard filters at the very end
    AND a.mime_type NOT IN ('image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'application/ics', 'application/zip', 'application/x-zip-compressed', 'application/x-sharing-metadata-xml')
    AND a.filename IS NOT NULL
ORDER BY
    m.internal_date_ts DESC;
    "#;

    // Condition 3: Thread contains a message labeled "IMPORTANT".
    const IMPORTANT_LABEL_CONDITION: &str = r#"
        AND EXISTS (
            SELECT 1 FROM email_messages thread_msg
            JOIN email_message_labels ml ON thread_msg.id = ml.message_id
            JOIN email_labels l ON ml.label_id = l.id
            WHERE thread_msg.thread_id = t.id AND l.name = 'IMPORTANT'
        )
    "#;

    // Condition 4: Thread contains a message from the user's own company domain.
    const SAME_DOMAIN_CONDITION: &str = r#"
        AND EXISTS (
            SELECT 1 FROM email_messages thread_msg
            JOIN email_contacts c ON thread_msg.from_contact_id = c.id
            JOIN email_links el ON t.link_id = el.id
            WHERE thread_msg.thread_id = t.id
            AND SPLIT_PART(c.email_address, '@', 2) = SPLIT_PART(el.email_address, '@', 2)
        )
    "#;

    /// Creates and returns a new PostgreSQL connection pool.
    pub async fn create_db_pool(database_url: &str) -> anyhow::Result<PgPool> {
        PgPoolOptions::new()
            .min_connections(10)
            .max_connections(60)
            .connect(database_url)
            .await
            .context("Could not connect to db")
    }

    /// Fetches the `link_id` for a given `macro_id`.
    pub async fn get_link_id(db: &PgPool, macro_id: &str) -> anyhow::Result<Uuid> {
        sqlx::query_scalar!("SELECT id FROM email_links WHERE macro_id = $1", macro_id)
            .fetch_one(db)
            .await
            .context("Failed to find link_id for macro_account")
    }

    /// Fetches attachments from the database that match one of several conditions.
    /// The queries are run concurrently, and the results are de-duplicated.
    pub async fn fetch_unique_attachments(
        db: &PgPool,
        link_id: Uuid,
    ) -> anyhow::Result<Vec<AttachmentMetadata>> {
        let q1 = format!(
            "{} {} {}",
            BASE_ATTACHMENT_QUERY_PREFIX, ATTACHMENT_FILTERS, SENT_IN_THREAD_CONDITION
        );
        let q2 = PREVIOUSLY_CONTACTED_CONDITION;
        let q3 = format!(
            "{} {} {}",
            BASE_ATTACHMENT_QUERY_PREFIX, ATTACHMENT_FILTERS, IMPORTANT_LABEL_CONDITION
        );
        let q4 = format!(
            "{} {} {}",
            BASE_ATTACHMENT_QUERY_PREFIX, ATTACHMENT_FILTERS, SAME_DOMAIN_CONDITION
        );

        // Run all queries concurrently for better performance.
        let (res1, res2, res3, res4) = tokio::try_join!(
            sqlx::query_as(&q1).bind(link_id).fetch_all(db),
            sqlx::query_as(&q2).bind(link_id).fetch_all(db),
            sqlx::query_as(&q3).bind(link_id).fetch_all(db),
            sqlx::query_as(&q4).bind(link_id).fetch_all(db),
        )?;

        println!(
            "Attachments found by condition: [sent_in_thread: {}, previously_contacted: {}, important_label: {}, same_domain: {}]",
            res1.len(),
            res2.len(),
            res3.len(),
            res4.len()
        );

        // Combine and de-duplicate the results.
        let all_attachments = [res1, res2, res3, res4].concat();
        let unique_attachments: HashMap<(String, String), AttachmentMetadata> = all_attachments
            .into_iter()
            .map(|attachment: AttachmentMetadata| {
                let key = (
                    attachment.provider_id.clone(),
                    attachment.provider_attachment_id.clone(),
                );
                (key, attachment)
            })
            .collect();

        let mut unique_attachments: Vec<AttachmentMetadata> =
            unique_attachments.into_values().collect();
        // insert oldest attachments first, so they show up last
        unique_attachments.sort_by_key(|a| a.internal_date_ts);

        Ok(unique_attachments)
    }
}

// --- Attachment Processing and Uploading ---

mod processing {
    use super::models::AttachmentMetadata;
    use anyhow::{Context, bail};
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use model::document::response::CreateDocumentRequest;
    use sha2::{Digest, Sha256};
    use tracing::instrument;

    /// A helper struct to manage clients and tokens required for processing.
    pub struct AttachmentProcessor {
        dss_client: document_storage_service_client::DocumentStorageServiceClient,
        gmail_client: gmail_client::GmailClient,
        gmail_access_token: String,
        macro_access_token: String,
    }

    impl AttachmentProcessor {
        pub fn new(
            dss_client: document_storage_service_client::DocumentStorageServiceClient,
            gmail_client: gmail_client::GmailClient,
            gmail_access_token: String,
            macro_access_token: String,
        ) -> Self {
            Self {
                dss_client,
                gmail_client,
                gmail_access_token,
                macro_access_token,
            }
        }

        /// Orchestrates the full upload process for a single attachment.
        #[instrument(skip(self), fields(file_name = %attachment.filename, mime_type = %attachment.mime_type))]
        pub async fn upload(&self, attachment: &AttachmentMetadata) -> anyhow::Result<()> {
            // 1. Fetch attachment data from Gmail.
            let data = self.fetch_gmail_data(attachment).await?;

            // 2. Calculate hashes required for validation.
            let (sha256_hex, sha256_base64) = Self::calculate_hashes(&data);

            // 3. Get a presigned URL from the Document Storage Service.
            let (presigned_url, content_type) =
                self.get_presigned_url(attachment, &sha256_hex).await?;

            // 4. Upload the data to the presigned URL (e.g., S3).
            self.upload_to_storage(&presigned_url, &content_type, &sha256_base64, data)
                .await?;

            Ok(())
        }

        /// Fetches the raw attachment data from the Gmail API.
        async fn fetch_gmail_data(
            &self,
            attachment: &AttachmentMetadata,
        ) -> anyhow::Result<Vec<u8>> {
            self.gmail_client
                .get_attachment_data(
                    &self.gmail_access_token,
                    &attachment.provider_id,
                    &attachment.provider_attachment_id,
                )
                .await
                .context("Failed to get attachment data from Gmail")
        }

        /// Calculates the hex and base64 encoded SHA256 hash of the attachment data.
        fn calculate_hashes(data: &[u8]) -> (String, String) {
            let mut hasher = Sha256::new();
            hasher.update(data);
            let hash_bytes = hasher.finalize();

            let hex_hash = format!("{:x}", hash_bytes);
            let base64_hash = STANDARD.encode(hash_bytes);

            (hex_hash, base64_hash)
        }

        /// Requests a pre-signed upload URL from the Document Storage Service.
        async fn get_presigned_url(
            &self,
            attachment: &AttachmentMetadata,
            sha256_hex: &str,
        ) -> anyhow::Result<(String, String)> {
            let file_name = attachment
                .filename
                .split('.')
                .next()
                .unwrap_or(&attachment.filename)
                .to_string();

            let file_type = mime_guess::get_mime_extensions_str(&attachment.mime_type)
                .and_then(|exts| exts.first().map(|s| s.to_string()))
                .context("Could not determine file extension from MIME type")?;

            let dss_response = self
                .dss_client
                .create_document(
                    CreateDocumentRequest {
                        id: None,
                        sha: sha256_hex.to_string(),
                        document_name: file_name,
                        file_type: Some(file_type),
                        mime_type: Some(attachment.mime_type.clone()),
                        document_family_id: None,
                        branched_from_id: None,
                        branched_from_version_id: None,
                        job_id: None,
                        project_id: None,
                    },
                    &self.macro_access_token,
                )
                .await
                .context("DSS create_document call failed")?;

            let presigned_url = dss_response
                .data
                .document_response
                .presigned_url
                .context("DSS response did not include a presigned URL")?;

            Ok((presigned_url, dss_response.data.content_type))
        }

        /// Performs the final PUT request to upload the file data to cloud storage.
        async fn upload_to_storage(
            &self,
            url: &str,
            content_type: &str,
            sha256_base64: &str,
            data: Vec<u8>,
        ) -> anyhow::Result<()> {
            let response = reqwest::Client::new()
                .put(url)
                .header("content-type", content_type)
                .header("x-amz-checksum-sha256", sha256_base64)
                .body(data)
                .send()
                .await
                .context("HTTP request to presigned URL failed")?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                bail!(
                    "Upload to storage failed with status {}. Body: {}",
                    status,
                    body
                );
            }

            Ok(())
        }
    }
}
