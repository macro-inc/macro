//! A send on an Outlook draft that had already stopped reaches no worker, so
//! the admission is what logs that it failed.

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_send_on_a_conflicted_draft_is_logged_and_reads_as_failed(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET provider='OUTLOOK' WHERE id=$1",
        link()
    )
    .execute(&pool)
    .await?;
    let repo = EmailPgRepo::new(pool.clone());
    let draft = prepared();
    repo.insert_message(
        &draft.message,
        &draft.contacts,
        link(),
        draft.new_thread.clone(),
        true,
    )
    .await?;
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET state='conflict', error_code='draft_conflict' WHERE message_id=$1",
        message()
    )
    .execute(&pool)
    .await?;

    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;

    let events = telemetry.events("send admitted onto a draft that had already stopped");
    let [(level, event)] = events.as_slice() else {
        panic!("expected one event, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::WARN);
    assert_eq!(event["link_id"], link().to_string());
    assert_eq!(event["message_id"], message().to_string());
    assert_eq!(event["attempt_id"], attempt.0.to_string());
    assert_eq!(event["state"], "conflict");
    assert_eq!(event["code"], "draft_conflict");

    let read = repo
        .read_send_attempt(&actor(), link(), attempt, None)
        .await?
        .map(|attempt| attempt.status);
    assert_eq!(read, Some(SendAttemptStatus::Failed));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_send_on_a_working_draft_logs_no_failure(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET provider='OUTLOOK' WHERE id=$1",
        link()
    )
    .execute(&pool)
    .await?;
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    EmailPgRepo::new(pool)
        .admit_send(&actor(), link(), attempt, prepared())
        .await?;
    let events = telemetry.events("send admitted onto a draft that had already stopped");
    assert!(events.is_empty(), "{events:?}");
    Ok(())
}
