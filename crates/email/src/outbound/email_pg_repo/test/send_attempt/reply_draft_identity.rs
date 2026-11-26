use super::*;

fn reply_from_handle(handle: Uuid, body: &str) -> CreateDraftInput {
    CreateDraftInput {
        db_id: Some(handle),
        replying_to_id: Some(Uuid::from_u128(0xee000001_0000_0000_0000_000000000001)),
        body_text: Some(body.to_owned()),
        ..snapshot().message
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn first_handle_adopts_an_unbound_reply(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let handle = Uuid::new_v4();
    let saved = service(pool.clone())
        .save_draft_for_user_impl(actor(), Some(link()), reply_from_handle(handle, "Edits"))
        .await?;

    assert_eq!(saved.draft.db_id, message());
    assert_eq!(
        EmailPgRepo::new(pool)
            .message_id_for_client_draft_id(handle, &[link()])
            .await?,
        Some(message())
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn different_handles_keep_separate_replies(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let original_handle = Uuid::new_v4();
    let newer_handle = Uuid::new_v4();
    let original_input = reply_from_handle(original_handle, "First");
    let newer_input = reply_from_handle(newer_handle, "Second");
    let service = service(pool.clone());
    let original = service
        .save_draft_for_user_impl(actor(), Some(link()), original_input)
        .await?;
    let newer = service
        .save_draft_for_user_impl(actor(), Some(link()), newer_input)
        .await?;

    assert_eq!(original.draft.db_id, message());
    assert_ne!(newer.draft.db_id, message());
    assert_ne!(newer.draft.db_id, newer_handle);
    assert_eq!(newer.draft.replying_to_id, original.draft.replying_to_id);
    assert_eq!(newer.draft.thread_db_id, original.draft.thread_db_id);
    assert_eq!(
        EmailPgRepo::new(pool)
            .message_id_for_client_draft_id(original_handle, &[link()])
            .await?,
        Some(message())
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn same_handle_reuses_its_bound_reply(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let handle = Uuid::new_v4();
    let service = service(pool.clone());
    service
        .save_draft_for_user_impl(actor(), Some(link()), reply_from_handle(handle, "First"))
        .await?;
    let saved = service
        .save_draft_for_user_impl(actor(), Some(link()), reply_from_handle(handle, "Edits"))
        .await?;

    assert_eq!(saved.draft.db_id, message());
    assert_eq!(saved.draft.body_text.as_deref(), Some("Edits"));
    assert!(
        !EmailPgRepo::new(pool)
            .draft_bound_to_another_handle(message(), link(), handle)
            .await?
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn bound_reply_handle_still_checks_the_generation_after_undo(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let handle = Uuid::new_v4();
    let service = service(pool.clone());
    let original = service
        .save_draft_for_user_impl(actor(), Some(link()), reply_from_handle(handle, "First"))
        .await?;
    let repo = EmailPgRepo::new(pool);
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let mut send = prepared();
    send.message.replying_to_id = original.draft.replying_to_id;
    send.snapshot.message.replying_to_id = original.draft.replying_to_id;
    repo.admit_send(&actor(), link(), attempt, send).await?;
    repo.cancel_send(&actor(), link(), attempt).await?;

    let mut edit = reply_from_handle(handle, "Edits");
    let stale = service
        .save_draft_for_user_impl(actor(), Some(link()), edit.clone())
        .await;
    assert!(matches!(stale, Err(EmailErr::DraftGenerationConflict(id)) if id == message()));
    edit.draft_generation = 2;
    let saved = service
        .save_draft_for_user_impl(actor(), Some(link()), edit)
        .await?;
    assert_eq!(saved.draft.db_id, message());
    assert_eq!(saved.draft.body_text.as_deref(), Some("Edits"));
    Ok(())
}
