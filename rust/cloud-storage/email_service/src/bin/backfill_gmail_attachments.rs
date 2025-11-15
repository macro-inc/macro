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
//! - `INTERNAL_AUTH_KEY`: An access token for authenticating with internal Macro services.
//! - `MACRO_ID_SOURCE`: The Macro ID of the user account to fetch relevant attachments from.
//! - `MACRO_ID_DESTINATION`: The destination Macro ID for document storage.
//! - `UPLOAD_CONCURRENCY`: Number of concurrent uploads to process (optional, defaults to 10).

use crate::processing::AttachmentProcessor;
use anyhow::Context;
use futures::{StreamExt, stream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load configuration from environment variables. Fails early if anything is missing.
    println!("Loading configuration...");
    let config = config::Config::from_env().context("Failed to load configuration")?;

    // 2. Establish a connection pool to the database.
    println!("Connecting to the database...");
    let db_pool = database::create_db_pool(&config.database_url, config.upload_concurrency as u32)
        .await
        .context("Failed to create database pool")?;

    // 3. Set up clients for external services.
    let dss_client = document_storage_service_client::DocumentStorageServiceClient::new(
        config.internal_auth_key.clone(),
        config.dss_url.clone(),
    );
    let gmail_client = gmail_client::GmailClient::new("unused".to_string());

    // 4. Fetch the link_id associated with the user's account.
    let link_id =
        email_db_client::links::get::fetch_link_by_macro_id(&db_pool, &config.macro_id_source)
            .await?
            .ok_or_else(|| anyhow::anyhow!("No link found for macro account source"))?
            .id;

    // 5. Fetch all relevant attachment metadata from the database.
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
        config.macro_id_destination.clone(),
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
                        // ignore weird file types. annoying game of whack a mole
                        if e.to_string().contains("file extension") {
                            println!(
                                "Skipping '{}' (index: {}) due to unsupported mime type {}",
                                attachment.filename, index, attachment.mime_type
                            );
                            return;
                        }
                        panic!(
                            "Failed to upload attachment - filename: {}, provider_attachment_id: {}, provider_message_id: {}, index: {}, error: {:?}",
                            attachment.filename,
                            attachment.provider_attachment_id,
                            attachment.email_provider_id,
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
    use uuid::Uuid;

    /// Represents the metadata for an email attachment stored in our database.
    #[derive(Clone, Debug, FromRow)]
    pub struct AttachmentMetadata {
        pub attachment_db_id: Uuid,
        pub email_provider_id: String,
        pub provider_attachment_id: String,
        pub mime_type: String,
        pub filename: String,
        pub internal_date_ts: DateTime<Utc>,
    }
}

// --- Configuration ---

mod config {
    use anyhow::{Context, Result};

    /// Holds all configuration loaded from environment variables.
    pub struct Config {
        pub dss_url: String,
        pub gmail_access_token: String,
        pub internal_auth_key: String,
        pub macro_id_destination: String,
        pub macro_id_source: String,
        pub database_url: String,
        pub upload_concurrency: usize,
    }

    impl Config {
        /// Creates a new `Config` instance by reading from environment variables.
        /// Returns an error if any required variable is not set.
        pub fn from_env() -> Result<Self> {
            let upload_concurrency =
                std::env::var("UPLOAD_CONCURRENCY").context("UPLOAD_CONCURRENCY not set")?;
            let upload_concurrency = upload_concurrency
                .parse::<usize>()
                .context("UPLOAD_CONCURRENCY is not a number")?;

            Ok(Self {
                dss_url: std::env::var("DSS_URL").context("DSS_URL not set")?,
                gmail_access_token: std::env::var("GMAIL_ACCESS_TOKEN")
                    .context("GMAIL_ACCESS_TOKEN not set")?,
                internal_auth_key: std::env::var("INTERNAL_AUTH_KEY")
                    .context("INTERNAL_AUTH_KEY not set")?,
                macro_id_destination: std::env::var("MACRO_ID_DESTINATION")
                    .context("MACRO_ID_DESTINATION not set")?,
                macro_id_source: std::env::var("MACRO_ID_SOURCE")
                    .context("MACRO_ID_SOURCE not set")?,
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
    use email_db_client::attachments::provider::upload_filters::{
        ATTACHMENT_MIME_TYPE_FILTERS, ATTACHMENT_WHITELISTED_DOMAINS,
    };
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    /// Attachments for a thread should be uploaded if any message in the
    /// thread meets any of the following criteria:
    /// 1. the user sent the message
    /// 2. the message has the IMPORTANT label
    /// 3. the message came from someone with the same domain as the user
    /// 4. the domain the email was sent from is part of the whitelisted domains
    /// 5. the user has previously sent a message to any participant in the thread
    ///
    ///
    ///
    /// Combined query for conditions 1, 2, 3, and 4 - similar to fetch_insertable_attachments_for_new_email
    /// but modified to work for all threads for a given link_id instead of a specific message
    const COMBINED_CONDITIONS_QUERY_PREFIX: &str = r#"
        SELECT DISTINCT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id,
            a.mime_type,
            a.filename,
            m.internal_date_ts
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        JOIN email_threads t ON m.thread_id = t.id
        WHERE t.link_id = $1
        AND a.filename IS NOT NULL
    "#;

    const COMBINED_CONDITIONS_QUERY_SUFFIX: &str = r#"
            AND EXISTS ( -- only fetch if at least one message in the thread meets any of the criteria
                SELECT 1
                FROM email_messages m2
                LEFT JOIN email_message_labels ml ON m2.id = ml.message_id
                LEFT JOIN email_labels l ON ml.label_id = l.id
                LEFT JOIN email_contacts c ON m2.from_contact_id = c.id
                JOIN email_links link ON t.link_id = link.id
                WHERE m2.thread_id = t.id -- check against the thread
                    AND (
                        m2.is_sent = true -- condition 1
                        OR l.name = 'IMPORTANT' -- condition 2
                        OR (
                            -- condition 3: same domain
                            c.email_address IS NOT NULL
                            AND RIGHT(c.email_address, LENGTH(RIGHT(link.email_address,
                                LENGTH(link.email_address) - POSITION('@' IN link.email_address)))) =
                            RIGHT(link.email_address, LENGTH(link.email_address) - POSITION('@' IN link.email_address))
        )
    "#;

    const COMBINED_CONDITIONS_QUERY_END: &str = r#"
        )
        )
        ORDER BY m.internal_date_ts DESC
    "#;

    /// Condition 5 Query: Thread involves a recipient the user has previously sent mail to.
    const PREVIOUSLY_CONTACTED_CONDITION: &str = r#"
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
    a.id AS attachment_db_id,
    m.provider_id as email_provider_id,
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
        SELECT DISTINCT
            tp.thread_id
        FROM
            thread_participants tp
        INNER JOIN
            previously_contacted_emails pce ON tp.email_address = pce.email_address
    )
    -- Apply standard filters at the very end
    AND a.filename IS NOT NULL
    AND a.mime_type NOT LIKE 'image/%'
    AND a.mime_type NOT LIKE '%zip%'
    AND a.mime_type NOT LIKE 'video/%'
    AND a.mime_type NOT LIKE 'audio/%'
    AND a.mime_type NOT IN ('application/ics', 'application/x-sharing-metadata-xml')
ORDER BY
    m.internal_date_ts DESC;
    "#;

    /// Creates and returns a new PostgreSQL connection pool.
    pub async fn create_db_pool(
        database_url: &str,
        min_connections: u32,
    ) -> anyhow::Result<PgPool> {
        PgPoolOptions::new()
            .min_connections(min_connections)
            .max_connections(60)
            .connect(database_url)
            .await
            .context("Could not connect to db")
    }

    /// Fetches attachments from the database that match one of several conditions.
    /// Uses a combined query for conditions 1-4, and a separate query for condition 5.
    pub async fn fetch_unique_attachments(
        db: &PgPool,
        link_id: Uuid,
    ) -> anyhow::Result<Vec<AttachmentMetadata>> {
        let mut attachments = Vec::new();

        // Combined query for conditions 1-4: User sent, IMPORTANT label, same domain, whitelisted domains
        // Build the query by concatenating the parts with the filter constants
        let combined_query = format!(
            "{}{}{}{}{}",
            COMBINED_CONDITIONS_QUERY_PREFIX,
            ATTACHMENT_MIME_TYPE_FILTERS,
            COMBINED_CONDITIONS_QUERY_SUFFIX,
            ATTACHMENT_WHITELISTED_DOMAINS,
            COMBINED_CONDITIONS_QUERY_END
        );

        let rows_combined = sqlx::query_as::<_, AttachmentMetadata>(&combined_query)
            .bind(link_id)
            .fetch_all(db)
            .await
            .with_context(|| "Failed to fetch attachments for conditions 1-4 (combined query)")?;

        println!("Conditions 1-4 returned {} rows", rows_combined.len());
        attachments.extend(rows_combined);

        // Query for condition 5: Previously contacted participants
        let rows5 = sqlx::query_as::<_, AttachmentMetadata>(PREVIOUSLY_CONTACTED_CONDITION)
            .bind(link_id)
            .fetch_all(db)
            .await
            .with_context(
                || "Failed to fetch attachments for condition 5 (previously contacted)",
            )?;

        println!("Condition 5 returned {} rows", rows5.len());

        attachments.extend(rows5);

        // Deduplicate by attachment_db_id
        let mut unique_attachments = std::collections::HashMap::new();
        for attachment in attachments {
            unique_attachments.insert(attachment.attachment_db_id, attachment);
        }

        let mut result: Vec<AttachmentMetadata> = unique_attachments.into_values().collect();
        result.sort_by(|a, b| b.internal_date_ts.cmp(&a.internal_date_ts));

        println!("Total unique rows: {}", result.len());

        Ok(result)
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
        macro_id_destination: String,
    }

    impl AttachmentProcessor {
        pub fn new(
            dss_client: document_storage_service_client::DocumentStorageServiceClient,
            gmail_client: gmail_client::GmailClient,
            gmail_access_token: String,
            macro_id_destination: String,
        ) -> Self {
            Self {
                dss_client,
                gmail_client,
                gmail_access_token,
                macro_id_destination,
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
                    &attachment.email_provider_id,
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
                .create_document_internal(
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
                        created_at: Some(attachment.internal_date_ts),
                        email_attachment_id: Some(attachment.attachment_db_id),
                    },
                    &self.macro_id_destination,
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
