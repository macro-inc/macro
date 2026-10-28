use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads", "email_all_mail")
    )
)]
async fn all_mail_excludes_spam_and_trash_before_pagination(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    for (link, mixed, archived) in [
        (
            uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            uuid::uuid!("0b000000-0000-0000-0000-000000000102"),
            uuid::uuid!("0b000000-0000-0000-0000-000000000101"),
        ),
        (
            uuid::uuid!("0a000000-0000-0000-0000-000000000001"),
            uuid::uuid!("0b000000-0000-0000-0000-000000000202"),
            uuid::uuid!("0b000000-0000-0000-0000-000000000201"),
        ),
    ] {
        for filter in [
            None,
            Some(Arc::new(Expr::val(EmailLiteral::CalendarOnly(false)))),
        ] {
            let page = repo
                .previews_for_view_cursor(
                    PreviewCursorQuery {
                        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
                        link_ids: vec![link],
                        limit: 2,
                        team_id: None,
                        query: Query::new(None, SimpleSortMethod::UpdatedAt, filter.clone()),
                    },
                    viewer.clone(),
                )
                .await?;
            assert_eq!(
                page.iter().map(|row| row.id).collect::<Vec<_>>(),
                [mixed, archived]
            );
            assert_eq!(page[0].name.as_deref(), Some("Mixed normal mail"));
            let next = repo
                .previews_for_view_cursor(
                    PreviewCursorQuery {
                        view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
                        link_ids: vec![link],
                        limit: 2,
                        team_id: None,
                        query: Query::new(
                            Some(Cursor {
                                id: mixed,
                                limit: 2,
                                val: CursorVal {
                                    sort_type: SimpleSortMethod::UpdatedAt,
                                    last_val: page[0].sort_ts,
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
            assert_eq!(next[0].id, archived);
            assert!(!next.iter().any(|row| row.id == mixed));
        }
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
async fn all_mail_cache_and_draft_baselines_exclude_spam_and_trash(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    let mixed = [
        uuid::uuid!("0b000000-0000-0000-0000-000000000102"),
        uuid::uuid!("0b000000-0000-0000-0000-000000000202"),
    ];
    let excluded = [
        uuid::uuid!("0b000000-0000-0000-0000-000000000103"),
        uuid::uuid!("0b000000-0000-0000-0000-000000000104"),
        uuid::uuid!("0b000000-0000-0000-0000-000000000203"),
        uuid::uuid!("0b000000-0000-0000-0000-000000000204"),
    ];
    let rows = repo
        .thread_mail_projections_by_ids(viewer, &[mixed.as_slice(), excluded.as_slice()].concat())
        .await?;
    assert_eq!(rows.len(), 6);
    for row in rows {
        let baseline = &row.draft_state.as_ref().unwrap().baseline;
        if mixed.contains(&row.thread_id) {
            assert_eq!(
                row.previews.all.as_ref().unwrap().subject.as_deref(),
                Some("Mixed normal mail")
            );
            assert_eq!(baseline.preview, row.previews.all);
        } else {
            assert!(row.previews.all.is_none());
            assert!(baseline.preview.is_none());
            assert!(baseline.preview_ts.is_none());
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_outlook_threads")
    )
)]
async fn all_mail_keeps_provider_drafts_without_received_or_sent_dates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let message = uuid::uuid!("0a000000-0000-0000-0000-0000000000b1");
    let thread = uuid::uuid!("0a000000-0000-0000-0000-0000000000a1");
    let link = uuid::uuid!("0a000000-0000-0000-0000-000000000001");
    sqlx::query!(
        "UPDATE email_messages SET is_draft = true, internal_date_ts = NULL WHERE id = $1",
        message
    )
    .execute(&pool)
    .await?;
    let repo = EmailPgRepo::new(pool.clone());
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    let projections = repo
        .thread_mail_projections_by_ids(viewer.clone(), &[thread])
        .await?;
    let projection = &projections[0];
    assert_eq!(projection.previews.all.as_ref().unwrap().id, message);
    let draft = &projection.draft_state.as_ref().unwrap().drafts[0];
    assert_eq!(draft.facts.preview.as_ref().unwrap().id, message);
    assert!(
        draft.facts.latest_non_spam_message_ts.is_some(),
        "clean drafts retain All Mail eligibility without provider timestamps"
    );
    for filter in [
        None,
        Some(Arc::new(Expr::val(EmailLiteral::CalendarOnly(false)))),
    ] {
        let page = repo
            .previews_for_view_cursor(
                PreviewCursorQuery {
                    view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
                    link_ids: vec![link],
                    limit: 50,
                    team_id: None,
                    query: Query::new(None, SimpleSortMethod::UpdatedAt, filter),
                },
                viewer.clone(),
            )
            .await?;
        assert!(page.iter().any(|row| row.id == thread));
    }
    sqlx::query!(
        r#"UPDATE email_messages SET mailbox_state = '{"in_junk":true}'::jsonb WHERE id = $1"#,
        message
    )
    .execute(&pool)
    .await?;
    let projections = repo
        .thread_mail_projections_by_ids(viewer, &[thread])
        .await?;
    assert!(projections[0].previews.all.is_none());
    let junk = &projections[0].draft_state.as_ref().unwrap().drafts[0];
    assert!(junk.facts.latest_non_spam_message_ts.is_none());
    assert_eq!(
        junk.facts.preview.as_ref().unwrap().id,
        message,
        "junk drafts retain their own tab preview"
    );
    Ok(())
}
