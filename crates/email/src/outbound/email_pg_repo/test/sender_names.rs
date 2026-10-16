use super::*;

const EXPECTED_SENDERS: [(Uuid, &str); 5] = [
    (
        uuid::uuid!("20000001-0000-0000-0000-000000000001"),
        "Sean Aye",
    ),
    (
        uuid::uuid!("20000002-0000-0000-0000-000000000002"),
        "Sent author",
    ),
    (
        uuid::uuid!("20000003-0000-0000-0000-000000000003"),
        "Draft author",
    ),
    (
        uuid::uuid!("20000005-0000-0000-0000-000000000005"),
        "cursor[bot]",
    ),
    // No message-level name: fall back to the address-book contact.
    (
        uuid::uuid!("20000006-0000-0000-0000-000000000006"),
        "Jane Smith",
    ),
];

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_sender_names")
    )
)]
async fn filtered_previews_preserve_message_sender_names(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let query = Query::new(
        None,
        SimpleSortMethod::UpdatedAt,
        Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(false))),
    );
    let rows = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")],
        50,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        query,
        "macro|user1@test.com",
        None,
    )
    .await?;

    for (thread_id, name) in EXPECTED_SENDERS {
        let row = rows.iter().find(|row| row.id == thread_id).unwrap();
        assert_eq!(row.sender_name.as_deref(), Some(name), "thread {thread_id}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_sender_names")
    )
)]
async fn cached_mail_previews_preserve_message_sender_names(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let thread_ids = EXPECTED_SENDERS.map(|(id, _)| id);
    let rows = repo
        .thread_mail_projections_by_ids(
            MacroUserIdStr::parse_from_str("macro|user1@test.com")?,
            &thread_ids,
        )
        .await?;

    for (thread_id, name) in EXPECTED_SENDERS {
        let row = rows.iter().find(|row| row.thread_id == thread_id).unwrap();
        assert_eq!(
            row.previews.all.as_ref().unwrap().sender_name.as_deref(),
            Some(name)
        );
        let state = row.draft_state.as_ref().unwrap();
        if name == "Draft author" {
            assert_eq!(
                row.previews.draft.as_ref().unwrap().sender_name.as_deref(),
                Some(name)
            );
            assert_eq!(
                state.drafts[0]
                    .facts
                    .preview
                    .as_ref()
                    .unwrap()
                    .sender_name
                    .as_deref(),
                Some(name)
            );
        } else {
            assert_eq!(
                state
                    .baseline
                    .preview
                    .as_ref()
                    .unwrap()
                    .sender_name
                    .as_deref(),
                Some(name)
            );
        }
        if name == "Sent author" {
            assert_eq!(
                row.previews.sent.as_ref().unwrap().sender_name.as_deref(),
                Some(name)
            );
        }
    }
    Ok(())
}
