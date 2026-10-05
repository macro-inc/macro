use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn document_view_metadata_uses_only_the_receipts_viewer_history(pool: Pool<Postgres>) {
    let id = "d0000000-0000-0000-0000-000000000001";
    let viewed_at = chrono::DateTime::parse_from_rfc3339("2026-10-05T16:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let mut transaction = pool.begin().await.unwrap();
    macro_db_client::history::upsert_user_history_timestamp(
        &mut transaction,
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap(),
        id,
        "document",
        &viewed_at,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let repo = test_repo(pool);
    let owner = repo
        .get_document_view_metadata(id, "macro|user@user.com")
        .await
        .unwrap();
    let teammate = repo
        .get_document_view_metadata(id, "macro|teammate1@user.com")
        .await
        .unwrap();
    assert_eq!(owner.viewed_at, Some(viewed_at));
    assert_eq!(teammate.viewed_at, None);
}
