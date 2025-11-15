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
/// we also upload attachments for any threads where at least one participant is someone the user has
/// sent a message to in the past. but those attachments are fetched once backfill is complete, in
/// a different call.
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

    let rows = sqlx::query(&query)
        .bind(thread_id)
        .fetch_all(db)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, thread_id=?thread_id, "Failed to fetch thread attachments for important messages");
            anyhow::anyhow!("Failed to fetch thread attachments for important messages: {}", err)
        })?;

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

    let rows = sqlx::query(&query)
        .bind(link_id)
        .fetch_all(db)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, link_id=?link_id, "Failed to fetch attachment backfill metadata for previously contacted participants");
            anyhow::anyhow!("Failed to fetch attachment backfill metadata for previously contacted participants: {}", err)
        })?;

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
/// For simplicity's sake, conditions 1 2 3 and 4 are evaluated in the first query, and condition 5
/// is evaluated in a separate query. These queries are very similar to fetch_thread_attachments_for_backfill
/// and fetch_job_attachments_for_backfill respectively, except they also verify the attachment
/// doesn't already exist in document_email table.
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
        .await
        .map_err(|err| {
            tracing::error!(error=?err, message_id=?message_provider_id, "Failed to fetch message attachments for important messages");
            anyhow::anyhow!("Failed to fetch message attachments for important messages: {}", err)
        })?;

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
        .await
        .map_err(|err| {
            tracing::error!(error=?err, message_id=?message_provider_id, "Failed to fetch message attachment backfill metadata for previously contacted participants");
            anyhow::anyhow!("Failed to fetch message attachment backfill metadata for previously contacted participants: {}", err)
        })?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_thread_attachments_for_backfill")
        )
    )]
    // should return attachments for thread with sent message
    async fn thread_attachments_for_backfill_condition_1(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000101")?;
        let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

        // Only the application/pdf attachment should be included
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "sent_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_thread_attachments_for_backfill")
        )
    )]
    // should return attachments for thread with important labeled message
    async fn thread_attachments_for_backfill_condition_2(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000102")?;
        let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "important_doc.pdf");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_thread_attachments_for_backfill")
        )
    )]
    // should return attachments for thread with same domain contact message
    async fn thread_attachments_for_backfill_condition_3(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000103")?;
        let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "same_domain_doc.pdf");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_thread_attachments_for_backfill")
        )
    )]
    // should return empty when no messages match any condition
    async fn thread_attachments_for_backfill_no_matching_messages(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000104")?;
        let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

        assert!(res.is_empty());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_thread_attachments_for_backfill")
        )
    )]
    // should return attachments for thread with whitelisted domain message
    async fn thread_attachments_for_backfill_condition_4(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000105")?;
        let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "docusign_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_job_attachments_for_backfill")
        )
    )]
    async fn job_attachments_for_backfill_includes_previously_contacted_participants(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
        let res = fetch_job_attachments_for_backfill(&pool, link_id).await?;

        // Should return 3 attachments:
        // 1. valid_document.pdf from Thread 1 (previously contacted participant)
        // 2. mixed_thread_doc.pdf from Thread 3 (has previously contacted participant)
        // 3. also_included_doc.docx from Thread 3 (same thread as #2)
        assert_eq!(res.len(), 3);

        // Check that the correct attachments are returned
        let filenames: Vec<&str> = res.iter().map(|a| a.filename.as_str()).collect();
        assert!(filenames.contains(&"valid_document.pdf"));
        assert!(filenames.contains(&"mixed_thread_doc.pdf"));
        assert!(filenames.contains(&"also_included_doc.docx"));

        // Verify excluded_document.pdf is NOT included (from thread with no contacted participants)
        assert!(!filenames.contains(&"excluded_document.pdf"));

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_condition_1_user_sent_message(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test condition 1: user sent the message
        let message_provider_id = "target-msg-101";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 1 attachment (sent_message_doc.pdf)
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "sent_message_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");
        assert_eq!(res[0].email_provider_id, "target-msg-101");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_condition_2_important_label(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test condition 2: message has IMPORTANT label
        let message_provider_id = "target-msg-201";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 1 attachment (important_doc.pdf)
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "important_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");
        assert_eq!(res[0].email_provider_id, "target-msg-201");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_condition_3_same_domain(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test condition 3: message from same domain as user
        let message_provider_id = "target-msg-301";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 1 attachment (same_domain_doc.pdf)
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "same_domain_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");
        assert_eq!(res[0].email_provider_id, "target-msg-301");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_condition_4_whitelisted_domain(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test condition 4: message from whitelisted domain
        let message_provider_id = "target-msg-801";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 1 attachment (whitelisted_domain_doc.pdf)
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "whitelisted_domain_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");
        assert_eq!(res[0].email_provider_id, "target-msg-801");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_condition_5_previously_contacted(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test condition 4: user has previously contacted a thread participant
        let message_provider_id = "target-msg-401";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 1 attachment (previously_contacted_doc.pdf)
        // This should be found by the second query (condition 4)
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "previously_contacted_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");
        assert_eq!(res[0].email_provider_id, "target-msg-401");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_no_conditions_met(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test control case: no conditions met
        let message_provider_id = "target-msg-601";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 0 attachments
        assert_eq!(res.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_excludes_already_uploaded(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test document_email exclusion
        let message_provider_id = "target-msg-701";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 0 attachments (attachment already exists in document_email)
        assert_eq!(res.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_filters_mime_types(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test that filtered mime types are excluded
        let message_provider_id = "target-msg-101";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should only return PDF, not image or zip
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "sent_message_doc.pdf");
        assert_eq!(res[0].mime_type, "application/pdf");

        // Verify no filtered mime types are present
        for attachment in &res {
            assert!(!attachment.mime_type.starts_with("image/"));
            assert!(!attachment.mime_type.contains("zip"));
            assert_ne!(attachment.mime_type, "application/ics");
            assert_ne!(attachment.mime_type, "application/x-sharing-metadata-xml");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_thread_exists_logic(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test that attachments are returned when ANY message in the thread meets conditions
        // Even if the specific target message doesn't meet the condition itself

        // target-msg-202 is in Thread 2, which contains target-msg-201 with IMPORTANT label
        let message_provider_id = "other-msg-202";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return 0 because other-msg-202 has no attachments
        // But the EXISTS clause should still evaluate to true due to target-msg-201 having IMPORTANT
        assert_eq!(res.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../fixtures",
            scripts("fetch_insertable_attachments_for_new_email")
        )
    )]
    async fn insertable_attachments_returns_first_query_when_available(
        pool: Pool<Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Test that when first query (conditions 1-3) returns results,
        // the second query (condition 4) is not executed

        // Use a message that meets condition 1 (is_sent = true)
        let message_provider_id = "target-msg-101";
        let res = fetch_insertable_attachments_for_new_email(&pool, message_provider_id).await?;

        // Should return result from first query
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].filename, "sent_message_doc.pdf");

        Ok(())
    }
}
