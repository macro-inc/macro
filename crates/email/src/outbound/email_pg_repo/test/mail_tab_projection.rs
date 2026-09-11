use super::*;
use macro_user_id::user_id::MacroUserIdStr;

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
