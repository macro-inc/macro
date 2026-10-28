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
    let repo = EmailPgRepo::new(pool);
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
                assert_eq!(first[0].id, only);
                let next = repo
                    .previews_for_view_cursor(
                        PreviewCursorQuery {
                            view: PreviewView::StandardLabel(folder),
                            link_ids: vec![link],
                            limit: 1,
                            team_id: None,
                            query: Query::new(
                                Some(Cursor {
                                    id: only,
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
                assert_eq!(next[0].id, id(2));
                assert_eq!(next[0].name.as_deref(), Some(subject));
            }
        }
    }
    Ok(())
}
