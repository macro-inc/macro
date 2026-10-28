use super::*;
use email_db_client::messages::{
    get::fetch_messages_metadata, insert::insert_message, scheduled::get::get_scheduled_message,
};

async fn echo_then_trash(
    pool: &Pool<Postgres>,
    legacy: bool,
) -> anyhow::Result<(EmailPgRepo, SendAttemptId)> {
    let repo = EmailPgRepo::new(pool.clone());
    let thread = prepared().message.thread_db_id;
    let mut echo = fetch_messages_metadata(&mut *pool.acquire().await?, thread)
        .await?
        .into_iter()
        .find(|row| row.db_id == message())
        .unwrap();
    echo.provider_id = Some("gmail-draft-provider-id".into());
    echo.is_draft = true;
    echo.is_sent = false;
    echo.subject = Some("Provider draft echo".into());
    echo.body_text = Some("Provider draft body".into());
    echo.body_html_sanitized = Some("<p>Provider draft body</p>".into());
    let first = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut input = prepared();
    input.undo_delay_secs = 120;
    input.message.provider_id = echo.provider_id.clone();
    input.snapshot.message.provider_id = echo.provider_id.clone();
    input.message.provider_thread_id = echo.provider_thread_id.clone();
    input.snapshot.message.provider_thread_id = echo.provider_thread_id.clone();
    repo.admit_send(&actor(), link(), first, input).await?;
    assert!(
        !repo
            .get_simple_message(message(), &[link()])
            .await?
            .unwrap()
            .is_draft
    );
    // The same production path used by inbox synchronization, not a direct flag UPDATE.
    insert_message(pool, thread, &mut echo, link(), true).await?;
    assert!(
        repo.get_simple_message(message(), &[link()])
            .await?
            .unwrap()
            .is_draft
    );
    if legacy {
        // Older trash implementations removed the schedule without retiring its attempt.
        email_db_client::messages::scheduled::delete::delete_scheduled_message(
            pool,
            link(),
            message(),
        )
        .await?;
    } else {
        assert_eq!(
            repo.delete_scheduled_messages_batch(&[message()], link())
                .await?,
            vec![message()]
        );
    }
    Ok((repo, first))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn trashing_a_provider_echoed_send_retires_its_attempt(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (repo, first) = echo_then_trash(&pool, false).await?;
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), first, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Cancelled,
        "Trash revoked delivery but left the original send attempt active"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn cancel_of_trashed_provider_draft_cannot_cancel_its_replacement(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    preserve_replacement(pool, false, false).await
}

async fn preserve_replacement(
    pool: Pool<Postgres>,
    legacy: bool,
    cancel_newer: bool,
) -> anyhow::Result<()> {
    let (repo, first) = echo_then_trash(&pool, legacy).await?;
    // A second device sees an editable, unscheduled draft and explicitly sends new content.
    let second = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut newer = prepared_generation(1);
    // Delivery deadlines do not define ownership: newer sends may have shorter delays.
    newer.undo_delay_secs = 5;
    newer.message.subject = "Second explicit send".into();
    newer.snapshot.message.subject = newer.message.subject.clone();
    newer.message.body_text = Some("Approved second body".into());
    newer.snapshot.message.body_text = newer.message.body_text.clone();
    newer.message.provider_id = Some("gmail-draft-provider-id".into());
    newer.snapshot.message.provider_id = newer.message.provider_id.clone();
    repo.admit_send(&actor(), link(), second, newer).await?;
    assert!(
        get_scheduled_message(&pool, link(), message())
            .await?
            .is_some()
    );
    if cancel_newer {
        repo.cancel_send(&actor(), link(), second).await?;
    }
    let before = repo.send_message_row(link(), message()).await?.unwrap();
    // A delayed Undo from the first device must not revoke that second Send.
    repo.cancel_send(&actor(), link(), first).await?;
    let schedule = get_scheduled_message(&pool, link(), message()).await?;
    let row = repo.send_message_row(link(), message()).await?.unwrap();
    assert!(
        schedule.is_some() == !cancel_newer
            && row.body_text == before.body_text
            && row.is_draft == before.is_draft,
        "Old cancellation changed a newer send: schedule_present={}, body={:?}, is_draft={}",
        schedule.is_some(),
        row.body_text,
        row.is_draft
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn legacy_orphan_cancellation_preserves_newer_send(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    preserve_replacement(pool, true, false).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn legacy_orphan_cancellation_preserves_newer_cancelled_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    preserve_replacement(pool, true, true).await
}
