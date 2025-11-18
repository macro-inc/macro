use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
        scripts("fetch_thread_attachments_for_backfill")
    )
)]
// should return empty when no messages match any condition
async fn thread_attachments_for_backfill_no_matching_messages(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000104")?;
    let res = fetch_thread_attachments_for_backfill(&pool, thread_id).await?;

    assert!(res.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
        scripts("fetch_insertable_attachments_for_new_email")
    )
)]
async fn insertable_attachments_condition_1_user_sent_message(pool: Pool<Postgres>) -> Result<()> {
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
        path = "../../../../fixtures",
        scripts("fetch_insertable_attachments_for_new_email")
    )
)]
async fn insertable_attachments_condition_2_important_label(pool: Pool<Postgres>) -> Result<()> {
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
        scripts("fetch_insertable_attachments_for_new_email")
    )
)]
async fn insertable_attachments_condition_4_whitelisted_domain(pool: Pool<Postgres>) -> Result<()> {
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
        path = "../../../../fixtures",
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
