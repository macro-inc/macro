use super::*;

fn destination() -> Uuid {
    Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap()
}

fn send_snapshot() -> SendSnapshot {
    let mut input = snapshot();
    input.message.to.push(ContactInfo {
        email: "recipient@example.com".into(),
        name: None,
        photo_url: None,
    });
    input
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn offline_inbox_change_moves_uploaded_attachments_with_admission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool.clone());
    let attachment = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key)
           VALUES ($1, $2, 'approved.txt', 'text/plain', 'sha', 3, 'approved-bytes')"#,
        attachment,
        message(),
    )
    .execute(&pool)
    .await?;
    let mut input = send_snapshot();
    input.attachment_ids.push(attachment);
    // Offline autosave is suppressed by the send. Admission must apply the
    // selected inbox directly to the existing source draft, including uploads.
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let admitted = service
        .send_email(actor(), destination(), attempt, input.clone())
        .await?;
    assert_eq!(admitted.status, SendAttemptStatus::Accepted);
    assert_eq!(admitted.message_id, Some(message()));
    let replay = service
        .send_email(actor(), destination(), attempt, input.clone())
        .await?;
    assert_eq!(replay.message_id, admitted.message_id);
    assert_eq!(
        replay.send_time.unwrap().timestamp_micros(),
        admitted.send_time.unwrap().timestamp_micros()
    );
    let row = sqlx::query!(
        r#"SELECT m.link_id, m.thread_id, m.provider_thread_id, l.email_address,
           a.id AS attachment_id, a.s3_key FROM email_messages m
           JOIN email_links l ON l.id = m.link_id
           JOIN email_attachments_drafts a ON a.draft_id = m.id WHERE m.id = $1"#,
        message(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.link_id, destination());
    assert_eq!(row.email_address, "user1-alt@test.com");
    assert_ne!(row.thread_id, input.message.thread_db_id.unwrap());
    assert!(row.provider_thread_id.is_none());
    assert_eq!(row.attachment_id, attachment);
    assert_eq!(row.s3_key, "approved-bytes");
    assert_eq!(
        EmailPgRepo::new(pool.clone())
            .message_id_for_client_draft_id(message(), &[destination()])
            .await?,
        Some(message())
    );
    // Cancellation restores an editable draft in the selected inbox. A later
    // send can switch back without stale aliases or attachment loss.
    assert_eq!(
        service
            .cancel_email_send(actor(), destination(), attempt)
            .await?
            .status,
        SendAttemptStatus::Cancelled
    );
    input.message.draft_generation = 2;
    let second = service
        .send_email(
            actor(),
            link(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            input,
        )
        .await?;
    assert_eq!(second.status, SendAttemptStatus::Accepted);
    assert_eq!(second.message_id, Some(message()));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT link_id FROM email_messages WHERE id = $1",
            message()
        )
        .fetch_one(&pool)
        .await?,
        link()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn rejected_attachment_set_rolls_back_the_inbox_move(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut input = send_snapshot();
    input.attachment_ids.push(macro_uuid::generate_uuid_v7());
    assert!(matches!(
        service(pool.clone())
            .send_email(
                actor(),
                destination(),
                SendAttemptId(macro_uuid::generate_uuid_v7()),
                input
            )
            .await,
        Err(EmailErr::InvalidSendSnapshot(_))
    ));
    let row = sqlx::query!(
        "SELECT link_id, thread_id, is_draft, subject FROM email_messages WHERE id = $1",
        message(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.link_id, link());
    assert_eq!(row.thread_id, snapshot().message.thread_db_id.unwrap());
    assert!(row.is_draft);
    assert_eq!(row.subject.as_deref(), Some("Re: Hello World"));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_send_attempts")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn inbox_move_preserves_approved_forwarded_files(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let attachment = macro_uuid::generate_uuid_v7();
    let source = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    sqlx::query!(
        r#"INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes)
           VALUES ($1, $2, 'provider-attachment', 'forward.txt', 'text/plain', 3)"#,
        attachment,
        source,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_attachments_fwd (message_id, attachment_id) VALUES ($1, $2)",
        message(),
        attachment,
    )
    .execute(&pool)
    .await?;
    let mut input = send_snapshot();
    input.forwarded_attachment_ids.push(attachment);
    let admitted = service(pool.clone())
        .send_email(
            actor(),
            destination(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            input,
        )
        .await?;
    assert_eq!(admitted.status, SendAttemptStatus::Accepted);
    assert_eq!(admitted.message_id, Some(message()));
    let retained = sqlx::query!(
        r#"SELECT m.link_id, f.attachment_id FROM email_messages m
           JOIN email_attachments_fwd f ON f.message_id = m.id WHERE m.id = $1"#,
        message(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(retained.link_id, destination());
    assert_eq!(retained.attachment_id, attachment);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn concurrent_inbox_sends_admit_one_delivery(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let service = service(pool.clone());
    let (original, moved) = tokio::join!(
        service.send_email(
            actor(),
            link(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            send_snapshot()
        ),
        service.send_email(
            actor(),
            destination(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            send_snapshot()
        ),
    );
    assert_eq!(
        usize::from(original.is_ok()) + usize::from(moved.is_ok()),
        1
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM email_scheduled_messages WHERE message_id = $1",
            message()
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn inbox_move_does_not_replace_an_existing_destination_reply(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_messages SET headers_jsonb = $1 WHERE id = $2"#,
        serde_json::json!([{"Macro-In-Reply-To": "ee000001-0000-0000-0000-000000000001"}]),
        Uuid::parse_str("ee000005-0000-0000-0000-000000000005")?,
    )
    .execute(&pool)
    .await?;
    let mut input = send_snapshot();
    input.message.replying_to_id = Some(Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?);
    let admitted = service(pool.clone())
        .send_email(
            actor(),
            destination(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            input,
        )
        .await?;
    assert_eq!(admitted.status, SendAttemptStatus::Accepted);
    assert_eq!(admitted.message_id, Some(message()));
    let drafts = sqlx::query!(
        "SELECT id, link_id, subject, is_draft FROM email_messages WHERE id = ANY($1) ORDER BY id",
        &[
            message(),
            Uuid::parse_str("ee000005-0000-0000-0000-000000000005")?
        ],
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(drafts.len(), 2);
    assert_eq!(drafts[0].id, message());
    assert_eq!(drafts[0].link_id, destination());
    assert_eq!(drafts[0].subject.as_deref(), Some("Approved snapshot"));
    assert_eq!(drafts[1].link_id, destination());
    assert_eq!(drafts[1].subject.as_deref(), Some("Re: Hello World"));
    assert!(drafts[1].is_draft);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM email_scheduled_messages WHERE message_id = $1",
            drafts[1].id
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn deferred_moved_send_keeps_the_source_inbox_autosave_fence(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    service(pool.clone())
        .send_email(
            actor(),
            destination(),
            SendAttemptId(macro_uuid::generate_uuid_v7()),
            send_snapshot(),
        )
        .await?;
    email_db_client::messages::delete::delete_db_message(&pool, message()).await?;
    let stale = prepared();
    let repo = EmailPgRepo::new(pool);
    assert!(
        repo.insert_message(&stale.message, &stale.contacts, link(), None, true)
            .await?
            .is_none()
    );
    assert!(repo.send_message_row(link(), message()).await?.is_none());
    assert!(
        repo.send_message_row(destination(), message())
            .await?
            .is_some()
    );
    Ok(())
}
