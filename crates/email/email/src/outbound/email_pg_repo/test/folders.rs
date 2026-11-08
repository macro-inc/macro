use super::*;
use entity_access_outbound::PgAccessRepository;
use macro_user_id::cow_str::CowLike;
use std::sync::Arc;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query",
            "email_outlook_threads",
            "email_all_mail",
            "email_folders"
        )
    )
)]
async fn gmail_folder_restore_refreshes_all_mail_before_provider_sync(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use super::thread_archive::{RecordingEnqueuer, service_with_enqueuer};
    use crate::domain::models::mailbox_action::MailboxAction;

    let enqueuer = RecordingEnqueuer::default();
    let service = service_with_enqueuer(pool.clone(), enqueuer.clone());
    let owner = MacroUserIdStr::parse_from_str("macro|mail@example.com")?.into_owned();
    let link = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    for (thread, message, provider_id, label, folder, action, date) in [
        (
            uuid::uuid!("0b000000-0000-0000-0000-000000000103"),
            uuid::uuid!("0c000000-0000-0000-0000-000000000103"),
            "all-mail-message-1-3",
            "TRASH",
            PreviewViewStandardLabel::Trash,
            MailboxAction::Trashed(false),
            Utc.with_ymd_and_hms(2025, 6, 3, 0, 0, 0).unwrap(),
        ),
        (
            uuid::uuid!("0b000000-0000-0000-0000-000000000104"),
            uuid::uuid!("0c000000-0000-0000-0000-000000000104"),
            "all-mail-message-1-4",
            "SPAM",
            PreviewViewStandardLabel::Spam,
            MailboxAction::Junk(false),
            Utc.with_ymd_and_hms(2025, 6, 4, 0, 0, 0).unwrap(),
        ),
    ] {
        service
            .email_repo
            .insert_message_labels_batch(&[message], "Label_Work", link)
            .await?;
        let mut tx = pool.begin().await?;
        super::super::thread::update_thread_metadata(&mut tx, thread, link).await?;
        tx.commit().await?;
        assert!(
            service
                .email_repo
                .thread_by_id(thread)
                .await?
                .unwrap()
                .latest_non_spam_message_ts
                .is_none()
        );

        // Exercise the semantic action and real staged DB write. Repeating
        // a completed restore must not enqueue another write or add Inbox.
        for _ in 0..2 {
            service
                .change_thread_mailbox_state_impl(owner.clone(), thread, action.clone())
                .await?;
        }

        let restored = service.email_repo.thread_by_id(thread).await?.unwrap();
        assert_eq!(restored.latest_non_spam_message_ts, Some(date));
        assert!(!restored.inbox_visible);
        let labels = service.email_repo.labels_by_message_ids(&[message]).await?;
        assert_eq!(
            labels[&message]
                .iter()
                .map(|l| l.provider_label_id.as_str())
                .collect::<Vec<_>>(),
            ["Label_Work"]
        );

        for view in [folder, PreviewViewStandardLabel::All] {
            let rows = service
                .email_repo
                .previews_for_view_cursor(
                    PreviewCursorQuery {
                        view: PreviewView::StandardLabel(view),
                        link_ids: vec![link],
                        limit: 100,
                        team_id: None,
                        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
                    },
                    owner.clone(),
                )
                .await?;
            let row = rows.iter().find(|row| row.id == thread);
            if view == PreviewViewStandardLabel::All {
                assert_eq!(
                    row.expect("restored thread belongs in All Mail").sort_ts,
                    date
                );
            } else {
                assert!(row.is_none(), "restored thread leaves its folder");
            }
        }

        let writes = enqueuer.0.lock().unwrap();
        let matching: Vec<_> = writes
            .iter()
            .filter(|write| write.1.iter().any(|(id, _)| *id == message))
            .collect();
        assert_eq!(matching.len(), 1);
        assert_eq!(
            *matching[0],
            (
                link,
                vec![(message, provider_id.to_string())],
                vec![],
                vec![label.to_string()]
            )
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query",
            "email_outlook_threads",
            "email_all_mail",
            "email_folders"
        )
    )
)]
async fn provider_folders_match_messages_before_pagination(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(
        pool.clone(),
        Arc::new(PgAccessRepository::new(pool.clone())),
    );
    let viewer = MacroUserIdStr::parse_from_str("macro|mail@example.com")?;
    for (link, prefix) in [
        (uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), 100u128),
        (uuid::uuid!("0a000000-0000-0000-0000-000000000001"), 200u128),
    ] {
        let id = |suffix: u128| {
            Uuid::parse_str(&format!("0b000000-0000-0000-0000-{:012}", prefix + suffix)).unwrap()
        };
        for (folder, only, subject) in [
            (PreviewViewStandardLabel::Spam, id(4), "Newer spam"),
            (PreviewViewStandardLabel::Trash, id(3), "Newest trash"),
        ] {
            for filter in [
                None,
                Some(Arc::new(Expr::val(EmailLiteral::CalendarOnly(false)))),
                Some(Arc::new(Expr::val(EmailLiteral::Sender(Email::Complete(
                    macro_user_id::email::EmailStr::parse_from_str("sender@example.com")?
                        .into_owned(),
                ))))),
            ] {
                let first = repo
                    .previews_for_view_cursor(
                        PreviewCursorQuery {
                            view: PreviewView::StandardLabel(folder),
                            link_ids: vec![link],
                            limit: 1,
                            team_id: None,
                            query: Query::new(None, SimpleSortMethod::UpdatedAt, filter.clone()),
                        },
                        viewer.clone(),
                    )
                    .await?;
                assert_eq!(first.len(), 1);
                assert_eq!(first[0].id, id(2));
                assert_eq!(first[0].name.as_deref(), Some(subject));
                // Read state and newer mail outside this folder must not change its cursor.
                sqlx::query!("UPDATE email_threads SET is_read = NOT is_read, updated_at = now() WHERE id = ANY($1)", &[id(2), only]).execute(&pool).await?;
                sqlx::query!("UPDATE email_messages SET internal_date_ts = now() WHERE thread_id = $1 AND subject = 'Mixed normal mail'", id(2)).execute(&pool).await?;
                let next = repo
                    .previews_for_view_cursor(
                        PreviewCursorQuery {
                            view: PreviewView::StandardLabel(folder),
                            link_ids: vec![link],
                            limit: 1,
                            team_id: None,
                            query: Query::new(
                                Some(Cursor {
                                    id: id(2),
                                    limit: 1,
                                    val: CursorVal {
                                        sort_type: SimpleSortMethod::UpdatedAt,
                                        last_val: first[0].sort_ts,
                                    },
                                    filter: filter.clone(),
                                }),
                                SimpleSortMethod::UpdatedAt,
                                filter,
                            ),
                        },
                        viewer.clone(),
                    )
                    .await?;
                assert_eq!(next.len(), 1);
                assert_eq!(next[0].id, only);
            }
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query",
            "email_outlook_threads",
            "email_all_mail",
            "email_folders"
        )
    )
)]
async fn folder_candidates_respect_pending_moves_and_provider_absence(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link = uuid::uuid!("0a000000-0000-0000-0000-000000000001");
    let command = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_mailbox_commands (id,link_id,generation,actor_id,intent,status) VALUES ($1,$2,1,'macro|mail@example.com','{}','pending')", command, link).execute(&pool).await?;
    // A clean message pending a move enters Trash; both raw-trash messages
    // pending restoration leave it, even before provider confirmation.
    for (message, desired) in [(201, true), (203, false), (206, false)] {
        let message = Uuid::parse_str(&format!("0c000000-0000-0000-0000-{message:012}"))?;
        sqlx::query!("INSERT INTO email_pending_mailbox_state (message_id,attribute,command_id,desired) VALUES ($1,'in_trash',$2,$3)", message, command, serde_json::json!(desired)).execute(&pool).await?;
    }
    let repo = EmailPgRepo::new(
        pool.clone(),
        Arc::new(PgAccessRepository::new(pool.clone())),
    );
    let viewer = MacroUserIdStr::parse_from_str("macro|mail@example.com")?;
    let query = || PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Trash),
        link_ids: vec![link],
        limit: 10,
        team_id: None,
        query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
    };
    let rows = repo
        .previews_for_view_cursor(query(), viewer.clone())
        .await?;
    assert_eq!(
        rows.iter().map(|r| r.id).collect::<Vec<_>>(),
        [uuid::uuid!("0b000000-0000-0000-0000-000000000201")]
    );
    sqlx::query!("UPDATE email_messages SET mailbox_state = mailbox_state || '{\"provider_missing\":true}'::jsonb WHERE id = '0c000000-0000-0000-0000-000000000201'").execute(&pool).await?;
    assert!(
        repo.previews_for_view_cursor(query(), viewer)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query",
            "email_outlook_threads",
            "email_all_mail",
            "email_folders"
        )
    )
)]
async fn folder_dates_and_shared_scope_use_the_selected_folder(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread = uuid::uuid!("0b000000-0000-0000-0000-000000000202");
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@example.com")?;
    let repo = EmailPgRepo::new(
        pool.clone(),
        Arc::new(PgAccessRepository::new(pool.clone())),
    );
    let filter = Arc::new(Expr::and(
        Expr::val(EmailLiteral::Shared(item_filters::SharedEmailFilter::Only)),
        Expr::and(
            Expr::val(EmailLiteral::Sender(Email::Domain(
                "example.com".to_owned(),
            ))),
            Expr::val(EmailLiteral::UpdatedAt(DateLiteral::GreaterThan(
                Utc.with_ymd_and_hms(2025, 6, 4, 12, 0, 0).unwrap(),
            ))),
        ),
    ));
    for sort in [
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        let query = || PreviewCursorQuery {
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::Spam),
            link_ids: vec![],
            limit: 10,
            team_id: None,
            query: Query::new(None, sort, Some(filter.clone())),
        };
        assert!(
            repo.previews_for_view_cursor(query(), viewer.clone())
                .await?
                .is_empty()
        );
        sqlx::query!("INSERT INTO entity_access (entity_id,entity_type,source_id,source_type,access_level) VALUES ($1,'email_thread',$2,'user','view')",thread,viewer.as_ref()).execute(&pool).await?;
        let rows = repo
            .previews_for_view_cursor(query(), viewer.clone())
            .await?;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), [thread]);
        assert_eq!(rows[0].name.as_deref(), Some("Newer spam"));
        sqlx::query!(
            "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = $2",
            thread,
            viewer.as_ref()
        )
        .execute(&pool)
        .await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads", "email_all_mail")
    )
)]
async fn outlook_mailbox_states_report_the_messages_they_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use super::thread_archive::{RecordingEnqueuer, service_with_enqueuer};
    use crate::domain::models::mailbox_action::MailboxAction;

    let service = service_with_enqueuer(pool.clone(), RecordingEnqueuer::default());
    // `email_all_mail` gives the Outlook inbox this owner.
    let owner = MacroUserIdStr::parse_from_str("macro|mail@example.com")?.into_owned();
    let thread = uuid::uuid!("0a000000-0000-0000-0000-0000000000a1");
    // A second received message in the same conversation, also read and in
    // the Inbox.
    sqlx::query(
        "INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, mailbox_state, created_at, updated_at)
         VALUES ('0a000000-0000-0000-0000-0000000000b3', $1, '0a000000-0000-0000-0000-000000000001', 'outlook-message-3', true, false, false, false, false, '2025-01-02T10:00:00Z',
             '{\"in_inbox\":true,\"in_trash\":false,\"in_junk\":false,\"attention\":\"primary\"}', NOW(), NOW())",
    )
    .bind(thread)
    .execute(&pool)
    .await?;

    let change = |action| service.change_thread_mailbox_state_impl(owner.clone(), thread, action);
    assert_eq!(change(MailboxAction::Flagged(true)).await?, 2);
    // Both are already read: nothing to change.
    assert_eq!(change(MailboxAction::Read(true)).await?, 0);
    assert_eq!(change(MailboxAction::Archived(true)).await?, 2);
    Ok(())
}
