use crate::attachments::provider::upload_filters::{
    ATTACHMENT_MIME_TYPE_FILTERS, ATTACHMENT_WHITELISTED_DOMAINS,
};
use models_email::service::attachment::AttachmentUploadMetadata;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres, Row};

/// fetch attachments for a thread to upload to Macro during the backfill process.
/// all attachments for a thread should be uploaded if any message in the thread meets any of the
/// following criteria:
/// 1. the user sent the message
/// 2. the message has the IMPORTANT label
/// 3. the message came from someone with the same domain as the user
/// 4. the domain the email was sent from is part of the whitelisted domains
///
/// we also upload attachments for any threads where at least one participant is someone the user has
/// sent a message to in the past. but those attachments are fetched once backfill is complete, in
/// a different call.
#[tracing::instrument(skip(db), err)]
pub async fn fetch_thread_attachments_for_backfill(
    db: &Pool<Postgres>,
    thread_id: Uuid,
) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
    let query = format!(
        r#"
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id as provider_attachment_id,
            a.filename as filename,
            a.mime_type as mime_type,
            m.internal_date_ts as internal_date_ts
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        WHERE m.thread_id = $1
            -- attachment mime type filters injected below
            {}
            AND EXISTS ( -- only fetch if at least one message in the thread meets any of the criteria
                SELECT 1
                FROM email_messages m2
                LEFT JOIN email_message_labels ml ON m2.id = ml.message_id
                LEFT JOIN email_labels l ON ml.label_id = l.id
                LEFT JOIN email_contacts c ON m2.from_contact_id = c.id
                JOIN email_threads t ON m2.thread_id = t.id
                JOIN email_links link ON t.link_id = link.id
                WHERE m2.thread_id = $1
                    AND (
                        m2.is_sent = true -- condition 1
                        OR l.name = 'IMPORTANT' -- condition 2
                        OR (
                            -- condition 3
                            c.email_address IS NOT NULL
                            AND RIGHT(c.email_address, LENGTH(RIGHT(link.email_address,
                                LENGTH(link.email_address) - POSITION('@' IN link.email_address)))) =
                            RIGHT(link.email_address, LENGTH(link.email_address) - POSITION('@' IN link.email_address))
                        )
                        -- whitelisted domain check injected below
                        {}
                    )
            )
        ORDER BY a.id
        "#,
        ATTACHMENT_MIME_TYPE_FILTERS, ATTACHMENT_WHITELISTED_DOMAINS
    );

    let rows = sqlx::query(&query).bind(thread_id).fetch_all(db).await?;

    let attachments = rows
        .into_iter()
        .map(|row| AttachmentUploadMetadata {
            attachment_db_id: row.get("attachment_db_id"),
            email_provider_id: row.get("email_provider_id"),
            provider_attachment_id: row.get("provider_attachment_id"),
            filename: row.get("filename"),
            mime_type: row.get("mime_type"),
            internal_date_ts: row.get("internal_date_ts"),
        })
        .collect();

    Ok(attachments)
}

/// Fetch attachment metadata across all threads for the user where at least one participant
/// is someone the user has previously contacted (excluding the user themselves).
/// This is called after email backfill completion to identify additional attachments
/// that should be uploaded based on the user's interaction history. This isn't done at time of thread
/// completion like fetch_thread_attachments_for_backfill because this can only be known at time
/// of job completion, as we don't know everyone the user has sent messages to until all their
/// messages have been backfilled.
///
/// There will be overlap between the attachments returned by this query and the ones returned by
/// fetch_attachment_threads_for_backfill, but the BackfillAttachment job has logic to ensure
/// duplicate attachments are not inserted by checking the DocumentEmail table.
#[tracing::instrument(skip(db), err)]
pub async fn fetch_job_attachments_for_backfill(
    db: &Pool<Postgres>,
    link_id: Uuid,
) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
    let query = format!(
        r#"
        -- Step 1: Get the user's own email address from the link_id. This is our exclusion criteria.
        WITH
        user_email AS (
            SELECT email_address
            FROM public.email_links
            WHERE id = $1
        ),

        -- Step 2: Create a distinct list of OTHER people this user has ever sent mail to.
        previously_contacted_emails AS (
            SELECT DISTINCT ec.email_address
            FROM public.email_messages em
            JOIN public.email_message_recipients emr ON em.id = emr.message_id
            JOIN public.email_contacts ec ON emr.contact_id = ec.id
            WHERE em.link_id = $1
                AND em.is_sent = true
                AND ec.email_address != (SELECT email_address FROM user_email)
        ),

        -- Step 3: For each thread, create a complete list of OTHER participant email addresses.
        thread_participants AS (
            -- Get all senders in each thread (excluding the user)
            SELECT DISTINCT em.thread_id, ec.email_address
            FROM public.email_messages em
            JOIN public.email_contacts ec ON em.from_contact_id = ec.id
            WHERE em.link_id = $1
                AND ec.email_address != (SELECT email_address FROM user_email)

            UNION

            -- Get all recipients in each thread (excluding the user)
            SELECT DISTINCT em.thread_id, ec.email_address
            FROM public.email_messages em
            JOIN public.email_message_recipients emr ON em.id = emr.message_id
            JOIN public.email_contacts ec ON emr.contact_id = ec.id
            WHERE em.link_id = $1
                AND ec.email_address != (SELECT email_address FROM user_email)
        )

        -- Final Step: Select attachments from threads where AT LEAST ONE of the OTHER participants
        --             is in the list of OTHER previously_contacted_emails.
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id as provider_attachment_id,
            a.filename as filename,
            a.mime_type as mime_type,
            m.internal_date_ts as internal_date_ts
        FROM public.email_attachments a
        JOIN public.email_messages m ON a.message_id = m.id
        JOIN public.email_contacts from_contact ON m.from_contact_id = from_contact.id
        WHERE m.thread_id IN (
                SELECT DISTINCT tp.thread_id
                FROM thread_participants tp
                INNER JOIN previously_contacted_emails pce ON tp.email_address = pce.email_address
            )
            -- attachment mime type filters injected below
            {}
            AND a.filename IS NOT NULL
        ORDER BY m.internal_date_ts DESC
        "#,
        ATTACHMENT_MIME_TYPE_FILTERS
    );

    let rows = sqlx::query(&query).bind(link_id).fetch_all(db).await?;

    let attachments = rows
        .into_iter()
        .map(|row| AttachmentUploadMetadata {
            attachment_db_id: row.get("attachment_db_id"),
            email_provider_id: row.get("email_provider_id"),
            provider_attachment_id: row.get("provider_attachment_id"),
            filename: row.get("filename"),
            mime_type: row.get("mime_type"),
            internal_date_ts: row.get("internal_date_ts"),
        })
        .collect();

    Ok(attachments)
}

/// fetch attachments for a specific message to upload to Macro. This is called when a new email is
/// inserted for a user. Attachments for the message should be uploaded if any message in the
/// message's thread meets any of the following criteria:
/// 1. the user sent the message
/// 2. the message has the IMPORTANT label
/// 3. the message came from someone with the same domain as the user
/// 4. the domain the email was sent from is part of the whitelisted domains
/// 5. the user has previously sent a message to any participant in the thread
///
/// For simplicity's sake, conditions 1 2 3 and 4 are evaluated in the first query, and condition 5
/// is evaluated in a separate query. These queries are very similar to fetch_thread_attachments_for_backfill
/// and fetch_job_attachments_for_backfill respectively, except they also verify the attachment
/// doesn't already exist in document_email table.
#[tracing::instrument(skip(db), err)]
pub async fn fetch_insertable_attachments_for_new_email(
    db: &Pool<Postgres>,
    message_provider_id: &str,
) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
    // query for conditions 1 2 and 3
    let query1 = format!(
        r#"
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id as provider_attachment_id,
            a.filename as filename,
            a.mime_type as mime_type,
            m.internal_date_ts as internal_date_ts
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        LEFT JOIN document_email de ON de.email_attachment_id = a.id
        WHERE m.provider_id = $1
            -- attachment mime type filters injected below
            {}
            AND de.email_attachment_id IS NULL
            AND EXISTS ( -- only fetch if at least one message in the thread meets any of the criteria
                SELECT 1
                FROM email_messages m2
                LEFT JOIN email_message_labels ml ON m2.id = ml.message_id
                LEFT JOIN email_labels l ON ml.label_id = l.id
                LEFT JOIN email_contacts c ON m2.from_contact_id = c.id
                JOIN email_threads t ON m2.thread_id = t.id
                JOIN email_links link ON t.link_id = link.id
                WHERE m2.thread_id = m.thread_id -- check against the message's thread
                    AND (
                        m2.is_sent = true -- condition 1
                        OR l.name = 'IMPORTANT' -- condition 2
                        OR (
                            -- condition 3
                            c.email_address IS NOT NULL
                            AND RIGHT(c.email_address, LENGTH(RIGHT(link.email_address,
                                LENGTH(link.email_address) - POSITION('@' IN link.email_address)))) =
                            RIGHT(link.email_address, LENGTH(link.email_address) - POSITION('@' IN link.email_address))
                        )
                        -- whitelisted domain check injected below
                        {}
                    )
            )
        ORDER BY a.id
        "#,
        ATTACHMENT_MIME_TYPE_FILTERS, ATTACHMENT_WHITELISTED_DOMAINS
    );

    let rows = sqlx::query(&query1)
        .bind(message_provider_id)
        .fetch_all(db)
        .await?;

    let attachments: Vec<AttachmentUploadMetadata> = rows
        .into_iter()
        .map(|row| AttachmentUploadMetadata {
            attachment_db_id: row.get("attachment_db_id"),
            email_provider_id: row.get("email_provider_id"),
            provider_attachment_id: row.get("provider_attachment_id"),
            filename: row.get("filename"),
            mime_type: row.get("mime_type"),
            internal_date_ts: row.get("internal_date_ts"),
        })
        .collect();

    // if one or more condition has already been met, return - don't need to check condition 5
    if !attachments.is_empty() {
        return Ok(attachments);
    }

    // query for condition 4
    let query2 = format!(
        r#"
        -- Step 1: Get the user's own email address and thread_id from the message
        WITH
        message_info AS (
            SELECT m.thread_id, l.email_address as user_email, m.link_id
            FROM public.email_messages m
            JOIN public.email_threads t ON m.thread_id = t.id
            JOIN public.email_links l ON t.link_id = l.id
            WHERE m.provider_id = $1
        ),

        -- Step 2: Create a distinct list of OTHER people this user has ever sent mail to.
        previously_contacted_emails AS (
            SELECT DISTINCT ec.email_address
            FROM public.email_messages em
            JOIN public.email_message_recipients emr ON em.id = emr.message_id
            JOIN public.email_contacts ec ON emr.contact_id = ec.id
            WHERE em.link_id = (SELECT link_id FROM message_info)
                AND em.is_sent = true
                AND ec.email_address != (SELECT user_email FROM message_info)
        ),

        -- Step 3: For the message's thread, create a complete list of OTHER participant email addresses.
        thread_participants AS (
            -- Get all senders in the thread (excluding the user)
            SELECT DISTINCT ec.email_address
            FROM public.email_messages em
            JOIN public.email_contacts ec ON em.from_contact_id = ec.id
            WHERE em.thread_id = (SELECT thread_id FROM message_info)
                AND ec.email_address != (SELECT user_email FROM message_info)

            UNION

            -- Get all recipients in the thread (excluding the user)
            SELECT DISTINCT ec.email_address
            FROM public.email_messages em
            JOIN public.email_message_recipients emr ON em.id = emr.message_id
            JOIN public.email_contacts ec ON emr.contact_id = ec.id
            WHERE em.thread_id = (SELECT thread_id FROM message_info)
                AND ec.email_address != (SELECT user_email FROM message_info)
        )

        -- Final Step: Select attachments from the specific message if AT LEAST ONE of the OTHER participants
        --             in the thread is in the list of OTHER previously_contacted_emails.
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as email_provider_id,
            a.provider_attachment_id as provider_attachment_id,
            a.filename as filename,
            a.mime_type as mime_type,
            m.internal_date_ts as internal_date_ts
        FROM public.email_attachments a
        JOIN public.email_messages m ON a.message_id = m.id
        LEFT JOIN public.document_email de ON de.email_attachment_id = a.id
        WHERE m.provider_id = $1
            AND de.email_attachment_id IS NULL
            AND EXISTS (
                SELECT 1
                FROM thread_participants tp
                INNER JOIN previously_contacted_emails pce ON tp.email_address = pce.email_address
            )
            -- attachment mime type filters injected below
            {}
            AND a.filename IS NOT NULL
        ORDER BY a.id
        "#,
        ATTACHMENT_MIME_TYPE_FILTERS
    );

    let rows = sqlx::query(&query2)
        .bind(message_provider_id)
        .fetch_all(db)
        .await?;

    let attachments = rows
        .into_iter()
        .map(|row| AttachmentUploadMetadata {
            attachment_db_id: row.get("attachment_db_id"),
            email_provider_id: row.get("email_provider_id"),
            provider_attachment_id: row.get("provider_attachment_id"),
            filename: row.get("filename"),
            mime_type: row.get("mime_type"),
            internal_date_ts: row.get("internal_date_ts"),
        })
        .collect();

    Ok(attachments)
}

pub async fn fetch_attachment_upload_metadata_by_id(
    db: &Pool<Postgres>,
    link_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<Option<AttachmentUploadMetadata>> {
    let row = sqlx::query_as!(
        AttachmentUploadMetadata,
        r#"
        SELECT
            a.id AS attachment_db_id,
            m.provider_id as "email_provider_id!",
            a.provider_attachment_id as "provider_attachment_id!",
            a.filename as "filename!",
            a.mime_type as "mime_type!",
            m.internal_date_ts as "internal_date_ts!"
        FROM email_attachments a
        JOIN email_messages m ON a.message_id = m.id
        JOIN email_threads t ON m.thread_id = t.id
        WHERE a.id = $1 AND t.link_id = $2
        "#,
        attachment_id,
        link_id
    )
    .fetch_optional(db)
    .await?;

    Ok(row)
}

#[cfg(test)]
mod test;
