use super::*;
use crate::domain::{
    models::{CreateDraftInput, ResolvedDraftInput, UpsertedContacts},
    send_attempt::*,
};

mod preparation_cancel;

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}
fn link() -> Uuid {
    Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap()
}
fn message() -> Uuid {
    Uuid::parse_str("ee000002-0000-0000-0000-000000000002").unwrap()
}
fn snapshot() -> SendSnapshot {
    SendSnapshot {
        message: CreateDraftInput {
            db_id: Some(message()),
            thread_db_id: Some(Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap()),
            provider_id: None,
            provider_thread_id: None,
            replying_to_id: None,
            subject: "Approved snapshot".into(),
            to: vec![],
            cc: vec![],
            bcc: vec![],
            body_text: Some("Approved body".into()),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: None,
            include_signature: None,
            actor: None,
            draft_client_binding: None,
            thread_client_binding: None,
        },
        attachment_ids: vec![],
        forwarded_attachment_ids: vec![],
        restore_body_html: None,
        restore_body_text: Some("Editable body".into()),
        restore_body_macro: None,
    }
}
fn prepared() -> PreparedSend {
    let snapshot = snapshot();
    let input = &snapshot.message;
    PreparedSend {
        source_inbox: None,
        undo_delay_secs: 5,
        message: ResolvedDraftInput {
            db_id: message(),
            thread_db_id: input.thread_db_id.unwrap(),
            provider_id: None,
            provider_thread_id: None,
            replying_to_id: None,
            subject: input.subject.clone(),
            to: vec![],
            cc: vec![],
            bcc: vec![],
            body_text: input.body_text.clone(),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: Some(Utc::now() + chrono::Duration::seconds(5)),
            actor_id: Some(actor().to_string()),
            draft_client_id: None,
            thread_client_id: None,
        },
        contacts: UpsertedContacts {
            from_contact_id: None,
            recipients: vec![],
        },
        new_thread: None,
        restore_html: None,
        restore_text: snapshot.restore_body_text.clone(),
        restore_macro: snapshot.restore_body_macro.clone(),
        snapshot,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn concurrent_replay_preserves_one_message_and_undo_deadline(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let actor = actor();
    let (first, second) = tokio::join!(
        repo.admit_send(&actor, link(), attempt, prepared()),
        repo.admit_send(&actor, link(), attempt, prepared())
    );
    let first = first?;
    let second = second?;
    assert_eq!(first.message_id, second.message_id);
    assert_eq!(
        first.send_time.unwrap().timestamp_micros(),
        second.send_time.unwrap().timestamp_micros()
    );
    let mut changed = snapshot();
    changed.message.subject = "different".into();
    assert!(matches!(
        repo.read_send_attempt(&actor, link(), attempt, Some(&changed))
            .await,
        Err(EmailErr::SendAttemptConflict)
    ));
    assert!(matches!(
        repo.admit_send(
            &actor,
            link(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            prepared()
        )
        .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_before_admission_is_a_durable_tombstone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Cancelled
    );
    assert_eq!(
        repo.admit_send(&actor(), link(), attempt, prepared())
            .await?
            .status,
        SendAttemptStatus::Cancelled
    );
    let scheduled = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM email_scheduled_messages WHERE message_id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(scheduled, Some(0));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_restores_body_and_cannot_cancel_a_later_resend(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let first = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), first, prepared()).await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), first).await?.status,
        SendAttemptStatus::Cancelled
    );
    let restored = sqlx::query!(
        "SELECT is_draft, body_text FROM email_messages WHERE id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert!(restored.is_draft);
    assert_eq!(restored.body_text.as_deref(), Some("Editable body"));
    let second = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), second, prepared())
        .await?;
    repo.cancel_send(&actor(), link(), first).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), second, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Accepted
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn claimed_delivery_cannot_be_cancelled(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input.undo_delay_secs = 0;
    repo.admit_send(&actor(), link(), attempt, input).await?;
    assert!(
        email_db_client::messages::scheduled::get::get_and_start_processing_scheduled_message(
            &pool,
            link(),
            message()
        )
        .await?
        .is_some()
    );
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Sending
    );
    assert!(
        !sqlx::query_scalar!(
            "SELECT is_draft FROM email_messages WHERE id = $1",
            message()
        )
        .fetch_one(&pool)
        .await?
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn attachment_mismatch_rolls_back_admission(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input
        .snapshot
        .attachment_ids
        .push(macro_uuid::generate_uuid_v7());
    assert!(matches!(
        repo.admit_send(&actor(), link(), attempt, input).await,
        Err(EmailErr::InvalidSendSnapshot(_))
    ));
    assert!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .is_none()
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT is_draft FROM email_messages WHERE id = $1",
            message()
        )
        .fetch_one(&pool)
        .await?
    );
    Ok(())
}

struct UnusedFrecency;
impl frecency::domain::ports::FrecencyQueryService for UnusedFrecency {
    async fn get_frecency_page<'a>(
        &self,
        _: frecency::domain::models::FrecencyPageRequest<'a>,
    ) -> Result<
        frecency::domain::models::FrecencyPageResponse,
        frecency::domain::models::FrecencyQueryErr,
    > {
        panic!("send does not query frecency")
    }
    async fn get_frecencies_by_ids<'a>(
        &self,
        _: frecency::domain::models::FrecencyByIdsRequest<'a>,
    ) -> Result<
        frecency::domain::models::FrecencyPageResponse,
        frecency::domain::models::FrecencyQueryErr,
    > {
        panic!("send does not query frecency")
    }
}

fn service(pool: Pool<Postgres>) -> impl EmailSendService {
    crate::domain::service::EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool),
        frecency_service: UnusedFrecency,
        enqueuer: crate::domain::ports::NoOpEnqueuer,
        crm_service: crm::domain::service::NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: macro_event_broker::NoopMacroEventBroker,
        sent_undo_delay_secs: 5,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn service_authorizes_send_cancel_and_status_before_touching_attempts(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let outsider = MacroUserIdStr::parse_from_str("macro|user2@test.com")?;
    assert!(
        service
            .send_email(outsider.clone(), link(), attempt, snapshot())
            .await
            .is_err()
    );
    assert!(
        service
            .cancel_email_send(outsider.clone(), link(), attempt)
            .await
            .is_err()
    );
    assert!(
        service
            .email_send_status(outsider, link(), attempt)
            .await
            .is_err()
    );
    assert!(
        service
            .email_send_status(actor(), link(), attempt)
            .await?
            .is_none()
    );
    let mut input = snapshot();
    input.message.to.push(crate::domain::models::ContactInfo {
        email: "recipient@example.com".into(),
        name: None,
        photo_url: None,
    });
    let unchanged = sqlx::query!(
        "SELECT link_id, subject, is_draft FROM email_messages WHERE id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(unchanged.link_id, link());
    assert_eq!(unchanged.subject.as_deref(), Some("Re: Hello World"));
    assert!(unchanged.is_draft);
    let admitted = service
        .send_email(actor(), link(), attempt, input.clone())
        .await?;
    assert_eq!(admitted.status, SendAttemptStatus::Accepted);
    assert!(admitted.message.is_some());
    let replay = service.send_email(actor(), link(), attempt, input).await?;
    assert_eq!(admitted.message_id, replay.message_id);
    assert_eq!(
        admitted.send_time.map(|t| t.timestamp_micros()),
        replay.send_time.map(|t| t.timestamp_micros())
    );
    assert_eq!(
        service
            .cancel_email_send(actor(), link(), attempt)
            .await?
            .status,
        SendAttemptStatus::Cancelled
    );
    Ok(())
}

mod inbox_move;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn attachment_edits_cannot_change_accepted_snapshot(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let attachment = models_email::service::attachment::AttachmentDraft {
        id: macro_uuid::generate_uuid_v7(),
        draft_id: message(),
        file_name: "file.txt".into(),
        content_type: "text/plain".into(),
        sha: "hash".into(),
        size: 1,
        s3_key: "file".into(),
    };
    assert!(
        email_db_client::attachments::draft::insert_draft_attachment(&pool, link(), attachment)
            .await
            .is_err()
    );
    assert_eq!(
        email_db_client::attachments::draft::get_total_attachments_size_by_draft_id(
            &pool,
            link(),
            message()
        )
        .await?,
        0
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn omitted_restoration_fields_preserve_the_approved_body_on_cancel(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    let service = service(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = snapshot();
    input.message.to.push(crate::domain::models::ContactInfo {
        email: "recipient@example.com".into(),
        name: None,
        photo_url: None,
    });
    let html = "<p>Approved body</p><script>alert('unsafe')</script>";
    input.message.body_html = Some(URL_SAFE_NO_PAD.encode(html));
    input.message.body_macro = Some(r#"{"editor":"approved"}"#.into());
    input.restore_body_text = None;
    service
        .send_email(actor(), link(), attempt, input.clone())
        .await?;
    // Defaulting recovery content must not change the immutable replay snapshot.
    let replay = service.send_email(actor(), link(), attempt, input).await?;
    assert_eq!(replay.status, SendAttemptStatus::Accepted);
    service.cancel_email_send(actor(), link(), attempt).await?;
    let restored = sqlx::query!(
        "SELECT is_draft, body_html_sanitized, body_text, body_macro FROM email_messages WHERE id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert!(restored.is_draft);
    assert_eq!(
        restored.body_html_sanitized,
        Some(email_utils::sanitize_authored_html(html))
    );
    assert_eq!(restored.body_text.as_deref(), Some("Approved body"));
    assert_eq!(
        restored.body_macro.as_deref(),
        Some(r#"{"editor":"approved"}"#)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_repairs_draft_only_thread_metadata(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let message_id = Uuid::parse_str("ee000004-0000-0000-0000-000000000004")?;
    let mut input = prepared();
    input.message.db_id = message_id;
    input.message.thread_db_id = thread_id;
    input.snapshot.message.db_id = Some(message_id);
    input.snapshot.message.thread_db_id = Some(thread_id);
    repo.admit_send(&actor(), link(), attempt, input).await?;
    let before = crate::outbound::email_pg_repo::thread::thread_by_id(&pool, thread_id)
        .await?
        .unwrap();
    assert!(!before.inbox_visible);
    assert!(before.latest_inbound_message_ts.is_none());

    repo.cancel_send(&actor(), link(), attempt).await?;
    let restored = crate::outbound::email_pg_repo::thread::thread_by_id(&pool, thread_id)
        .await?
        .unwrap();
    assert!(restored.inbox_visible);
    assert!(restored.latest_inbound_message_ts.is_some());
    assert!(restored.latest_non_spam_message_ts.is_some());
    assert!(restored.latest_outbound_message_ts.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn delivery_remains_terminal_after_provider_deletes_the_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let cancelled = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), cancelled, prepared())
        .await?;
    repo.cancel_send(&actor(), link(), cancelled).await?;
    let sent = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), sent, prepared()).await?;
    email_db_client::messages::update::mark_message_as_sent(
        &mut *pool.acquire().await?,
        "provider-message",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;
    assert!(
        sqlx::query_scalar!(
            "SELECT sent FROM email_send_attempts WHERE attempt_id = $1 AND link_id = $2",
            sent.0,
            link()
        )
        .fetch_one(&pool)
        .await?
    );
    email_db_client::messages::delete::delete_db_message(&pool, message()).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), sent, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Sent
    );
    assert_eq!(
        repo.cancel_send(&actor(), link(), sent).await?.status,
        SendAttemptStatus::Sent
    );
    assert_eq!(
        repo.admit_send(&actor(), link(), sent, prepared())
            .await?
            .status,
        SendAttemptStatus::Sent
    );
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), cancelled, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Cancelled
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn deletion_preserves_legacy_delivery_confirmation(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    // Simulate a delivery whose proof has not yet been projected onto the attempt.
    sqlx::query!(
        "UPDATE email_messages SET is_sent = true WHERE id = $1",
        message()
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE email_send_attempts SET sent = false WHERE attempt_id = $1",
        attempt.0
    )
    .execute(&pool)
    .await?;
    email_db_client::messages::delete::delete_db_message(&pool, message()).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Sent
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_waiting_on_delivery_cannot_cancel_a_deleted_sent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let mut delivery = pool.begin().await?;
    let delivery_pid = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *delivery)
        .await?;
    email_db_client::messages::update::mark_message_as_sent(
        &mut delivery,
        "provider-message",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;
    let cancel_pool = pool.clone();
    let cancellation = tokio::spawn(async move {
        EmailPgRepo::new(cancel_pool)
            .cancel_send(&actor(), link(), attempt)
            .await
    });
    // Ensure cancellation read the old attempt and is waiting on delivery's
    // message lock before deleting the message and committing delivery.
    wait_for_blocked_transaction(&pool, delivery_pid).await?;
    email_db_client::messages::delete::delete_db_message(&mut *delivery, message()).await?;
    delivery.commit().await?;
    assert_eq!(cancellation.await??.status, SendAttemptStatus::Sent);
    Ok(())
}

async fn wait_for_blocked_transaction(pool: &Pool<Postgres>, blocker: i32) -> anyhow::Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database()
                    AND $1 = ANY(pg_blocking_pids(pid))
                ) AS "waiting!""#,
                blocker
            )
            .fetch_one(pool)
            .await?;
            if waiting {
                return Ok::<_, anyhow::Error>(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await??;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn cancellation_waiting_on_legacy_changes_cannot_revoke_a_later_schedule(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let mut changes = pool.begin().await?;
    let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *changes)
        .await?;
    sqlx::query!(
        "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
        message()
    )
    .fetch_one(&mut *changes)
    .await?;
    let cancel_pool = pool.clone();
    let cancellation = tokio::spawn(async move {
        EmailPgRepo::new(cancel_pool)
            .cancel_send(&actor(), link(), attempt)
            .await
    });
    wait_for_blocked_transaction(&pool, blocker).await?;
    // Model legacy cancellation followed by a new schedule while attempt-based
    // cancellation is waiting. Legacy writes do not take the attempt lock.
    sqlx::query!(
        "UPDATE email_send_attempts SET cancelled = true WHERE attempt_id = $1",
        attempt.0
    )
    .execute(&mut *changes)
    .await?;
    sqlx::query!(
        "UPDATE email_messages SET body_text = $2 WHERE id = $1",
        message(),
        "Later message"
    )
    .execute(&mut *changes)
    .await?;
    let later_send_time = Utc::now() + chrono::Duration::hours(1);
    sqlx::query!(
        "UPDATE email_scheduled_messages SET send_time = $2 WHERE message_id = $1",
        message(),
        later_send_time
    )
    .execute(&mut *changes)
    .await?;
    changes.commit().await?;
    assert_eq!(cancellation.await??.status, SendAttemptStatus::Cancelled);
    let preserved = sqlx::query!(
        "SELECT m.body_text, m.is_draft, s.send_time FROM email_messages m JOIN email_scheduled_messages s ON s.message_id = m.id WHERE m.id = $1",
        message()
    ).fetch_one(&pool).await?;
    assert_eq!(preserved.body_text.as_deref(), Some("Later message"));
    assert!(!preserved.is_draft);
    assert_eq!(
        preserved.send_time.timestamp_micros(),
        later_send_time.timestamp_micros()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn failed_preparation_can_be_cancelled_and_restored(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!("UPDATE email_scheduled_messages SET processing = true, delivery_status = 'failed' WHERE message_id = $1", message())
        .execute(&pool).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Failed
    );
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Cancelled
    );
    let restored = sqlx::query!(
        "SELECT is_draft, body_text FROM email_messages WHERE id = $1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert!(restored.is_draft);
    assert_eq!(restored.body_text.as_deref(), Some("Editable body"));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn uncertain_delivery_stays_locked_on_cancel_and_schedule_changes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::scheduled::{EmailSchedulingRepo, ScheduleChange};
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!("UPDATE email_scheduled_messages SET processing = true, delivery_status = 'unconfirmed', delivery_started_at = NOW() WHERE message_id = $1", message())
        .execute(&pool).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    assert!(matches!(
        repo.change_schedule(link(), message(), &actor(), ScheduleChange::Cancel, None)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let record = sqlx::query!(
        "SELECT cancelled, sent FROM email_send_attempts WHERE attempt_id = $1",
        attempt.0
    )
    .fetch_one(&pool)
    .await?;
    assert!(!record.cancelled && !record.sent);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn deleted_message_preserves_uncertain_delivery_authority(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true, delivery_started_at = NOW(), delivery_claim_id = $2 WHERE message_id = $1",
        message(), macro_uuid::generate_uuid_v7(),
    ).execute(&pool).await?;
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", message())
        .execute(&pool)
        .await?;
    let read = repo
        .read_send_attempt(&actor(), link(), attempt, None)
        .await?
        .unwrap();
    assert_eq!(read.status, SendAttemptStatus::DeliveryUnconfirmed);
    assert_eq!(read.message_id, Some(message()));
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    assert_eq!(
        repo.admit_send(&actor(), link(), attempt, prepared())
            .await?
            .status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn deleted_legacy_processing_message_remains_uncertain(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true WHERE message_id = $1",
        message()
    )
    .execute(&pool)
    .await?;
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", message())
        .execute(&pool)
        .await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::DeliveryUnconfirmed
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn deleted_preparation_without_submission_can_be_cancelled(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true, delivery_claim_id = $2 WHERE message_id = $1",
        message(), macro_uuid::generate_uuid_v7(),
    ).execute(&pool).await?;
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", message())
        .execute(&pool)
        .await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Cancelled
    );
    Ok(())
}
