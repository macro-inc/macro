use super::*;
use macro_user_id::cowlike::CowLike;

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
    let repo = EmailPgRepo::new(pool.clone());
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
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
    let repo = EmailPgRepo::new(pool.clone());
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
    let repo = EmailPgRepo::new(pool.clone());
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
