use super::*;
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_signal_flag", "mail_draft_policy")
    )
)]
async fn draft_aggregate_signal_matches_canonical_policy(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let viewer = MacroUserIdStr::parse_from_str("macro|sigflag_email@example.com")?;
    let link_id = uuid::uuid!("00000000-0000-0000-0000-000000000e01");
    let notification_thread = uuid::uuid!("00000000-0000-0000-0000-00000000e207");

    for override_kind in [None, Some(false), Some(true)] {
        if let Some(address) = override_kind {
            repo.upsert_email_filter(
                link_id,
                crate::domain::models::UpsertEmailFilterInput {
                    email_address: address.then(|| "no-reply@notification.macro.com".into()),
                    email_domain: (!address).then(|| "notification.macro.com".into()),
                    is_important: true,
                },
            )
            .await?;
        }
        sync_all_signal_flags(&pool).await?;
        let canonical = sqlx::query!("SELECT id, is_signal FROM email_threads")
            .fetch_all(&pool)
            .await?;
        let ids = canonical.iter().map(|row| row.id).collect::<Vec<_>>();
        let projections = repo
            .thread_mail_projections_by_ids(viewer.clone(), &ids)
            .await?;
        for row in canonical {
            let projection = projections.iter().find(|p| p.thread_id == row.id).unwrap();
            let state = projection.draft_state.as_ref().unwrap();
            let aggregate_signal =
                state.baseline.is_signal || state.drafts.iter().any(|entry| entry.facts.is_signal);
            assert_eq!(aggregate_signal, row.is_signal, "thread {}", row.id);
            if row.id == notification_thread {
                assert!(!row.is_signal, "notification senders remain noise");
            }
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_signal_flag", "mail_draft_policy")
    )
)]
async fn draft_aggregate_calendar_matches_inline_invitation_policy(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let viewer = MacroUserIdStr::parse_from_str("macro|sigflag_email@example.com")?;
    let ids = [
        uuid::uuid!("00000000-0000-0000-0000-00000000e201"),
        uuid::uuid!("00000000-0000-0000-0000-00000000e204"),
        uuid::uuid!("00000000-0000-0000-0000-00000000e202"),
    ];
    let mut connection = pool.acquire().await?;
    for id in ids {
        email_db_client::threads::update::sync_thread_calendar_flag(&mut connection, id).await?;
    }
    drop(connection);
    let repo = EmailPgRepo::new(pool);
    let projections = repo.thread_mail_projections_by_ids(viewer, &ids).await?;
    for projection in projections {
        let state = projection.draft_state.as_ref().unwrap();
        let aggregate_calendar = state.baseline.has_calendar_attachment
            || state
                .drafts
                .iter()
                .any(|entry| entry.facts.has_calendar_attachment);
        assert_eq!(
            aggregate_calendar,
            projection.cache_facts.has_calendar_attachment
        );
        assert_eq!(aggregate_calendar, projection.thread_id != ids[2]);
        if projection.thread_id == ids[0] {
            assert!(state.baseline.has_calendar_attachment);
        }
        if projection.thread_id == ids[1] {
            assert!(!state.baseline.has_calendar_attachment);
            assert!(
                state
                    .drafts
                    .iter()
                    .any(|entry| entry.facts.has_calendar_attachment)
            );
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "mail_tab_projection")
    )
)]
async fn canonical_tab_previews_and_share_facts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let viewer = MacroUserIdStr::parse_from_str("macro|user1@test.com")?;
    let thread = uuid::uuid!("20000001-0000-0000-0000-000000000001");
    let direct = uuid::uuid!("20000101-0000-0000-0000-000000000101");
    let team = uuid::uuid!("20000103-0000-0000-0000-000000000103");
    let active = uuid::uuid!("20000008-0000-0000-0000-000000000008");
    let left = uuid::uuid!("20000009-0000-0000-0000-000000000009");
    let repo = EmailPgRepo::new(pool.clone());
    let rows = repo
        .thread_mail_projections_by_ids(viewer.clone(), &[thread, direct, team, active, left])
        .await?;
    let get = |id| rows.iter().find(|row| row.thread_id == id).unwrap();
    let metadata = get(thread);
    assert_eq!(
        metadata.previews.all.as_ref().unwrap().id,
        uuid::uuid!("30000001-0000-0000-0000-000000000001")
    );
    assert_eq!(
        metadata.previews.draft.as_ref().unwrap().subject.as_deref(),
        Some("Older draft")
    );
    assert_eq!(
        metadata.previews.sent.as_ref().unwrap().subject.as_deref(),
        Some("Older sent")
    );
    let state = metadata
        .draft_state
        .as_ref()
        .expect("complete draft metadata");
    assert!(state.baseline.message_count > 0);
    assert_eq!(
        state.baseline.preview.as_ref().unwrap().id,
        metadata.previews.all.as_ref().unwrap().id
    );
    assert!(state.drafts.iter().any(|entry| {
        entry
            .facts
            .preview
            .as_ref()
            .map(|preview| preview.subject.as_deref())
            == Some(Some("Older draft"))
    }));
    assert!(
        get(left)
            .draft_state
            .as_ref()
            .unwrap()
            .drafts
            .iter()
            .all(|entry| entry.facts.preview.is_none())
    );
    assert!(metadata.cache_facts.has_calendar_attachment);
    assert!(
        !metadata.cache_facts.has_thread_share,
        "ownership is not a share grant"
    );
    assert!(get(direct).cache_facts.has_thread_share);
    assert!(get(team).cache_facts.has_thread_share);
    assert!(get(active).cache_facts.has_thread_share);
    assert!(
        !get(left).cache_facts.has_thread_share,
        "left channel participants grant no scope"
    );
    assert!(
        get(left).previews.all.is_none(),
        "trashed messages do not qualify"
    );
    assert!(
        get(left).previews.draft.is_none(),
        "trashed drafts do not qualify"
    );
    let other = repo
        .thread_mail_projections_by_ids(
            MacroUserIdStr::parse_from_str("macro|user2@test.com")?,
            &[direct],
        )
        .await?;
    assert!(
        !other[0].cache_facts.has_thread_share,
        "share facts are viewer scoped even for the owner"
    );
    for (view, preview) in [
        (
            PreviewViewStandardLabel::All,
            metadata.previews.all.as_ref().unwrap(),
        ),
        (
            PreviewViewStandardLabel::Drafts,
            metadata.previews.draft.as_ref().unwrap(),
        ),
        (
            PreviewViewStandardLabel::Sent,
            metadata.previews.sent.as_ref().unwrap(),
        ),
    ] {
        let filter = Arc::new(Expr::val(EmailLiteral::ThreadId(thread)));
        let rows = dynamic::dynamic_email_thread_cursor(
            &pool,
            &[uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")],
            50,
            &PreviewView::StandardLabel(view),
            Query::new(None, SimpleSortMethod::UpdatedAt, filter),
            viewer.as_ref(),
            None,
        )
        .await?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, preview.subject);
        assert_eq!(rows[0].snippet, preview.snippet);
        assert_eq!(rows[0].is_draft, preview.is_draft);
        assert_eq!(rows[0].sender_email, preview.sender_email);
    }
    Ok(())
}
