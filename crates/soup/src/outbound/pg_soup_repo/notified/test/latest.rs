use super::*;
use chrono::Timelike;

#[sqlx::test(
    fixtures(
        path = "../../../../../fixtures",
        scripts("notified_at", "notified_latest")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn timestamp_ties_deduplicate_without_merging_entity_types(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let links = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page = notified_soup_page(&pool, req(None, &links, &sources, EVERYTHING)).await?;

    let same_id = page
        .iter()
        .filter(|item| item.entity.entity_id == DOC_A)
        .collect::<Vec<_>>();
    assert_eq!(same_id.len(), 2);
    assert_eq!(same_id[0].entity.entity_type, EntityType::Chat);
    assert_eq!(same_id[0].notified_at.minute(), 10);
    assert_eq!(same_id[1].entity.entity_type, EntityType::Document);
    assert_eq!(same_id[1].notified_at.minute(), 9);
    assert_eq!(page.len(), 12);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../fixtures",
        scripts("notified_at", "notified_latest")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn cursor_does_not_resurrect_older_notifications(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let links = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(None, &links, &sources, EVERYTHING);
    request.after = Some(NotifiedPagePosition {
        notified_at: "2024-06-01T10:09:00Z".parse()?,
        entity_id: DOC_A.to_string(),
    });
    let page = notified_soup_page(&pool, request).await?;

    // Neither the document's T1 notifications nor its duplicate T9 rows may
    // reintroduce it after its T9 cursor. The same-id chat is newer still.
    assert!(page.iter().all(|item| item.entity.entity_id != DOC_A));
    assert_eq!(minutes(&page), vec![8, 7, 6, 5, 4, 3, 2, 0]);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../fixtures",
        scripts("notified_at", "notified_latest")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn state_filter_does_not_move_latest_timestamp(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let links = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::NotificationState(
            item_filters::NotificationState::Unseen,
        )))),
        ..EntityFilterAst::default()
    };
    let page = notified_soup_page(&pool, req(Some(&filter), &links, &sources, EVERYTHING)).await?;
    let document = page
        .iter()
        .find(|item| {
            item.entity.entity_type == EntityType::Document && item.entity.entity_id == DOC_A
        })
        .expect("an older unseen notification still qualifies the document");
    // Notification state is a membership filter, not a filter on the input
    // to max(created_at); the latest (done) notification still sets the key.
    assert_eq!(document.notified_at.minute(), 9);
    Ok(())
}
