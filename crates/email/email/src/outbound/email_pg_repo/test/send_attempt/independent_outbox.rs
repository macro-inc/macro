use super::*;
use crate::domain::draft_attachments::{
    AttachmentChange, AttachmentError, DraftAttachmentRepository, RemovalKind,
};
use crate::domain::scheduled::{EmailSchedulingRepo, ScheduleChange};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn cancelled_send_fences_old_saves_deletes_attachments_and_schedules(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    assert!(matches!(
        service(pool.clone())
            .save_draft_for_user_impl(actor(), Some(link()), snapshot().message)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let pending_autosave = prepared();
    assert!(matches!(
        repo.insert_message(
            &pending_autosave.message,
            &pending_autosave.contacts,
            link(),
            None,
            true
        )
        .await,
        Err(EmailErr::DraftGenerationConflict(_))
    ));
    repo.cancel_send(&actor(), link(), attempt).await?;
    let generation = sqlx::query_scalar!(
        "SELECT draft_generation FROM email_messages WHERE id=$1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(generation, 2);
    assert!(matches!(
        service(pool.clone())
            .save_draft_for_user_impl(actor(), Some(link()), snapshot().message)
            .await,
        Err(EmailErr::DraftGenerationConflict(_))
    ));
    let mut stale = prepared();
    stale.message.body_text = Some("Old autosave".into());
    assert!(matches!(
        repo.insert_message(&stale.message, &stale.contacts, link(), None, true)
            .await,
        Err(EmailErr::DraftGenerationConflict(_))
    ));
    assert!(
        repo.delete_draft_message(
            message(),
            stale.message.thread_db_id,
            &[link()],
            Some(actor().as_ref()),
            0
        )
        .await?
        .is_none()
    );
    assert!(
        repo.change_schedule(
            link(),
            message(),
            &actor(),
            ScheduleChange::Set(Utc::now() + chrono::Duration::hours(1)),
            None,
            0
        )
        .await
        .is_err()
    );
    let remove = || AttachmentChange::Remove {
        attachment_id: Uuid::new_v4(),
        kind: RemovalKind::UploadedOrNative,
    };
    assert!(matches!(
        repo.commit_attachment_change(actor().as_ref(), link(), message(), remove(), 0)
            .await,
        Err(AttachmentError::DeliveryConflict)
    ));
    stale.message.draft_generation = generation;
    stale.message.body_text = Some("New edit after Undo".into());
    assert!(
        repo.insert_message(&stale.message, &stale.contacts, link(), None, true)
            .await?
            .is_some()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT body_text FROM email_messages WHERE id=$1",
            message()
        )
        .fetch_one(&pool)
        .await?
        .as_deref(),
        Some("New edit after Undo")
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn send_later_deadline_is_part_of_immutable_approval(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let deadline = Utc::now() + chrono::Duration::days(2);
    let mut input = prepared();
    input.snapshot.message.send_time = Some(deadline);
    let snapshot = input.snapshot.clone();
    let first = repo.admit_send(&actor(), link(), attempt, input).await?;
    assert_eq!(first.send_time, Some(deadline));
    let recovered = repo
        .read_send_attempt(&actor(), link(), attempt, Some(&snapshot))
        .await?
        .unwrap();
    assert_eq!(
        recovered.send_time.unwrap().timestamp_micros(),
        deadline.timestamp_micros()
    );
    let mut changed = snapshot;
    changed.message.send_time = Some(deadline + chrono::Duration::seconds(1));
    assert!(matches!(
        repo.read_send_attempt(&actor(), link(), attempt, Some(&changed))
            .await,
        Err(EmailErr::SendAttemptConflict)
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn pending_sends_are_scoped_to_actor_inbox_and_cursor(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let rows = repo
        .pending_send_attempts(&actor(), &[link()], None)
        .await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0.attempt_id, attempt.0);
    assert!(
        repo.pending_send_attempts(&actor(), &[], None)
            .await?
            .is_empty()
    );
    let other = MacroUserIdStr::parse_from_str("macro|other@test.com").unwrap();
    assert!(
        repo.pending_send_attempts(&other, &[link()], None)
            .await?
            .is_empty()
    );
    assert!(
        repo.pending_send_attempts(&actor(), &[link()], Some(&rows[0].0))
            .await?
            .is_empty()
    );
    repo.cancel_send(&actor(), link(), attempt).await?;
    assert!(
        repo.pending_send_attempts(&actor(), &[link()], None)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn outlook_ambiguous_submission_cannot_be_cancelled_or_reapproved(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET provider='OUTLOOK' WHERE id=$1",
        link()
    )
    .execute(&pool)
    .await?;
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!("UPDATE email_mailbox_drafts SET state='failed', error_code='send_unknown', checkpoint=jsonb_build_object('stage','confirming') WHERE message_id=$1", message()).execute(&pool).await?;
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
    assert!(
        repo.admit_send(
            &actor(),
            link(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            prepared()
        )
        .await
        .is_err()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn outlook_cancel_revokes_the_prepared_provider_revision(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET provider='OUTLOOK' WHERE id=$1",
        link()
    )
    .execute(&pool)
    .await?;
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let before = sqlx::query_scalar!(
        "SELECT revision FROM email_mailbox_drafts WHERE message_id=$1",
        message()
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        repo.cancel_send(&actor(), link(), attempt).await?.status,
        SendAttemptStatus::Cancelled
    );
    let restored = sqlx::query!("SELECT revision, desired_content->>'body_text' AS body, desired_content->>'send_time' AS send_time FROM email_mailbox_drafts WHERE message_id=$1", message()).fetch_one(&pool).await?;
    assert!(restored.revision > before);
    assert_eq!(restored.body.as_deref(), Some("Editable body"));
    assert!(restored.send_time.is_none());
    Ok(())
}
