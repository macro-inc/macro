use anyhow::Context;
use email_db_client::attachments::provider::upload_filters::{
    ATTACHMENT_MIME_TYPE_FILTERS, ATTACHMENT_WHITELISTED_DOMAINS,
};
use models_email::service::attachment::AttachmentUploadMetadata;
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
const PREVIOUSLY_CONTACTED_CONDITION_PREFIX: &str = r#"
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
    "#;

const PREVIOUSLY_CONTACTED_CONDITION_SUFFIX: &str = r#"
ORDER BY
    m.internal_date_ts DESC;
    "#;

/// Creates and returns a new PostgreSQL connection pool.
pub async fn create_db_pool(database_url: &str, min_connections: u32) -> anyhow::Result<PgPool> {
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
) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
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

    let rows_combined = sqlx::query_as::<_, AttachmentUploadMetadata>(&combined_query)
        .bind(link_id)
        .fetch_all(db)
        .await
        .with_context(|| "Failed to fetch attachments for conditions 1-4 (combined query)")?;

    println!("Conditions 1-4 returned {} rows", rows_combined.len());
    attachments.extend(rows_combined);

    // Query for condition 5: Previously contacted participants
    let previously_contacted_query = format!(
        "{}{}{}",
        PREVIOUSLY_CONTACTED_CONDITION_PREFIX,
        ATTACHMENT_MIME_TYPE_FILTERS,
        PREVIOUSLY_CONTACTED_CONDITION_SUFFIX
    );

    let rows5 = sqlx::query_as::<_, AttachmentUploadMetadata>(&previously_contacted_query)
        .bind(link_id)
        .fetch_all(db)
        .await
        .with_context(|| "Failed to fetch attachments for condition 5 (previously contacted)")?;

    println!("Condition 5 returned {} rows", rows5.len());

    attachments.extend(rows5);

    // Deduplicate by attachment_db_id
    let mut unique_attachments = std::collections::HashMap::new();
    for attachment in attachments {
        unique_attachments.insert(attachment.attachment_db_id, attachment);
    }

    let mut result: Vec<AttachmentUploadMetadata> = unique_attachments.into_values().collect();
    result.sort_by(|a, b| b.internal_date_ts.cmp(&a.internal_date_ts));

    println!("Total unique rows: {}", result.len());

    Ok(result)
}
