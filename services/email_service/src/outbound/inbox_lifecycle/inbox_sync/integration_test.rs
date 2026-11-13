use super::*;
use crate::outbound::backfill_jobs::PgBackfillJobs;
use email::domain::mailbox::inbox_sync::{
    ensure_recovery_backfill_job, process_and_insert_message, repair_stale_cursor,
    upload_claimed_attachments,
};
use email_api_client::domain::models::{CalendarPart, RateLimitOrigin};
use email_db_client::attachments::provider::upload::new_email_media_atts;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::attachment::{AttachmentUploadArgs, AttachmentUploadDestination};
use models_email::service::link::UserProvider;
use models_email::service::message::Message;
use models_email::service::pubsub::ProcessingError;
use std::time::Duration;

struct Preparation;
impl InboxSyncPreparation for Preparation {
    fn prepare_message<'a>(&'a self, message: &'a mut Message) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_message_pre_insert(
            message,
        ))
    }
    fn prepare_threads<'a>(
        &'a self,
        threads: &'a mut Vec<models_email::service::thread::Thread>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_threads_pre_insert(
            threads,
        ))
    }
    fn save_invitations<'a>(
        &'a self,
        _: Uuid,
        _: &'a str,
        _: Uuid,
        _: &'a [CalendarPart],
    ) -> BoxFuture<'a, ()> {
        unreachable!()
    }
}
fn received_message(link_id: Uuid, thread_db_id: Uuid) -> Message {
    let now = chrono::Utc::now();
    Message {
        db_id: Uuid::now_v7(),
        provider_id: Some("provider-message".to_string()),
        thread_db_id,
        provider_thread_id: Some("provider-thread".to_string()),
        replying_to_id: None,
        global_id: Some("<received@example.com>".to_string()),
        link_id,
        subject: Some("hello".to_string()),
        snippet: None,
        provider_history_id: None,
        internal_date_ts: Some(now),
        sent_at: Some(now),
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: false,
        from: None,
        to: vec![],
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_text: Some("body".to_string()),
        body_html_sanitized: None,
        body_macro: None,
        attachments: vec![],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: now,
        updated_at: now,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inserting_into_a_concurrently_deleted_thread_is_retryable(pool: PgPool) {
    let link_id = Uuid::now_v7();
    let thread_db_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, 'macro|deleted-thread@example.com', 'fa-user', 'deleted-thread@example.com', 'GMAIL')",
    )
    .bind(link_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read)
         VALUES ($1, 'provider-thread', $2, TRUE, FALSE)",
    )
    .bind(thread_db_id)
    .bind(link_id)
    .execute(&pool)
    .await
    .unwrap();
    // The thread lookup found this row; a delete of its last message then
    // removes it before the insert runs.
    sqlx::query("DELETE FROM email_threads WHERE id = $1")
        .bind(thread_db_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut message = received_message(link_id, thread_db_id);
    let result = process_and_insert_message(
        &PgInboxSync(pool.clone()),
        &Preparation,
        link_id,
        thread_db_id,
        &mut message,
        None,
    )
    .await;

    match result {
        Err(ProcessingError::Retryable(e)) => assert!(
            format!("{:#}", e.source).contains("email_messages_thread_id_fkey"),
            "unexpected insert error: {:#}",
            e.source
        ),
        other => panic!("expected a retryable insert failure, got {other:?}"),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_refused_attachment_fetch_is_claimed_again_by_the_retry(
    pool: PgPool,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000c01")?;
    let image = Uuid::parse_str("00000000-0000-0000-0000-00000c2a0201")?;
    let video = Uuid::parse_str("00000000-0000-0000-0000-00000c2a0202")?;
    let animation = Uuid::parse_str("00000000-0000-0000-0000-00000c2a0203")?;
    sqlx::query!(
        "INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type)
         VALUES ($1, '00000000-0000-0000-0000-0000000ec201', 'claim-test-media-att-3', 'animation.gif', 'image/gif')",
        animation
    )
    .execute(&pool)
    .await?;

    let claimed = new_email_media_atts(&pool, link_id, "claim-test-media-msg").await?;
    assert_eq!(
        claimed
            .iter()
            .map(|a| a.attachment_db_id)
            .collect::<Vec<_>>(),
        vec![image, video, animation]
    );
    let uploads = claimed
        .into_iter()
        .map(|attachment_metadata| AttachmentUploadArgs {
            recipient_emails: vec![],
            attachment_metadata,
            backfill: false,
            upload_destination: AttachmentUploadDestination::Sfs,
        })
        .collect();

    // The image uploads; the gate then refuses the video's fetch.
    let refusal = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(1)),
        origin: RateLimitOrigin::Local,
    };
    let mut attempted = Vec::new();
    let refused = upload_claimed_attachments(&PgInboxSync(pool.clone()), uploads, |args| {
        let attachment_id = args.attachment_metadata.attachment_db_id;
        attempted.push(attachment_id);
        let result = if attachment_id == image {
            Ok("sfs-image".to_string())
        } else {
            Err(InboxSyncUploadError::RateLimited(refusal.clone()))
        };
        async move { result }
    })
    .await;

    assert!(matches!(refused, Ok(Some(ref error)) if *error == refusal));
    assert_eq!(attempted, vec![image, video]);
    // The retried upsert claims the refused and untried attachments, not the uploaded one.
    let reclaimed = new_email_media_atts(&pool, link_id, "claim-test-media-msg").await?;
    assert_eq!(
        reclaimed
            .iter()
            .map(|a| a.attachment_db_id)
            .collect::<Vec<_>>(),
        vec![video, animation]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn an_attachment_deleted_mid_run_is_skipped_without_a_retry(
    pool: PgPool,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000c01")?;
    let image = Uuid::parse_str("00000000-0000-0000-0000-00000c2a0201")?;
    let video = Uuid::parse_str("00000000-0000-0000-0000-00000c2a0202")?;

    let claimed = new_email_media_atts(&pool, link_id, "claim-test-media-msg").await?;
    let uploads = claimed
        .into_iter()
        .map(|attachment_metadata| AttachmentUploadArgs {
            recipient_emails: vec![],
            attachment_metadata,
            backfill: false,
            upload_destination: AttachmentUploadDestination::Sfs,
        })
        .collect();
    // The message revision is replaced after the claim, removing the image row.
    sqlx::query("DELETE FROM email_attachments WHERE id = $1")
        .bind(image)
        .execute(&pool)
        .await?;

    let mut attempted = Vec::new();
    let refused = upload_claimed_attachments(&PgInboxSync(pool.clone()), uploads, |args| {
        let attachment_id = args.attachment_metadata.attachment_db_id;
        attempted.push(attachment_id);
        let result = if attachment_id == image {
            Err(InboxSyncUploadError::AttachmentDeleted)
        } else {
            Ok("sfs-video".to_string())
        };
        async move { result }
    })
    .await;

    assert!(matches!(refused, Ok(None)));
    assert_eq!(attempted, vec![image, video]);
    assert!(
        new_email_media_atts(&pool, link_id, "claim-test-media-msg")
            .await?
            .is_empty()
    );

    Ok(())
}

async fn insert_email_link(pool: &PgPool) -> (Uuid, String) {
    let link_id = Uuid::now_v7();
    let email_address = format!("stale-cursor-{link_id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|stale-cursor@example.com",
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    (link_id, email_address)
}

async fn stored_history_id(pool: &PgPool, email_address: &str) -> Option<String> {
    email_db_client::histories::fetch_history_id_for_link(pool, email_address, UserProvider::Gmail)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_backfill_job_is_created_once_and_then_reused(pool: PgPool) {
    let (link_id, _) = insert_email_link(&pool).await;

    let (job, created) =
        ensure_recovery_backfill_job(&PgBackfillJobs(pool.clone()), link_id, "fa-user")
            .await
            .unwrap();
    assert!(created, "first stale-cursor recovery creates a job");

    let (reused_job, created_again) =
        ensure_recovery_backfill_job(&PgBackfillJobs(pool.clone()), link_id, "fa-user")
            .await
            .unwrap();
    assert!(
        !created_again,
        "a second notification must reuse the active recovery job instead of creating another"
    );
    assert_eq!(job.id, reused_job.id);

    // Recovery jobs are flagged so backfill refreshes existing threads
    // instead of skipping them (and the init outbox skips the priority pass).
    let is_recovery = sqlx::query_scalar!(
        r#"SELECT is_recovery FROM email_backfill_jobs WHERE id = $1"#,
        job.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_recovery);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_cursor_repair_persists_the_notification_history_id(pool: PgPool) {
    let (link_id, email_address) = insert_email_link(&pool).await;
    email_db_client::histories::upsert_gmail_history(&pool, link_id, "12345")
        .await
        .unwrap();

    repair_stale_cursor(&PgInboxSync(pool.clone()), link_id, 99999).await;

    // The stored cursor now parses and matches the notification, so the next
    // notification takes the incremental list_changes path (its freshness
    // check `db_history >= payload.history_id` holds for this history id).
    assert_eq!(
        stored_history_id(&pool, &email_address).await.as_deref(),
        Some("99999")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_cursor_repair_inserts_a_cursor_when_none_exists(pool: PgPool) {
    let (link_id, email_address) = insert_email_link(&pool).await;

    repair_stale_cursor(&PgInboxSync(pool.clone()), link_id, 424242).await;

    assert_eq!(
        stored_history_id(&pool, &email_address).await.as_deref(),
        Some("424242")
    );
}
