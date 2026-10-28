use super::{
    delete_chats::delete_user_chats, delete_documents::delete_user_documents,
    delete_projects::delete_user_projects,
};
use sqlx::{PgConnection, PgPool};

const USER_ID: &str = "macro|cleanup@example.com";
const DOCUMENT_ID: &str = "01900000-0000-7000-8000-000000000101";
const CHAT_ID: &str = "01900000-0000-7000-8000-000000000102";
const PROJECT_ID: &str = "01900000-0000-7000-8000-000000000103";
const UNREGISTERED_DOCUMENT_ID: &str = "01900000-0000-7000-8000-000000000104";

async fn snapshot(db: &mut PgConnection) -> anyhow::Result<Vec<(String, String)>> {
    Ok(sqlx::query!(
        r#"
        SELECT 'document' AS "kind!", id AS "id!" FROM "Document"
        UNION ALL SELECT 'chat', id FROM "Chat"
        UNION ALL SELECT 'project', id FROM "Project"
        UNION ALL SELECT 'entity', id::text FROM entity
        UNION ALL SELECT CASE WHEN granted_from_project_id IS NULL THEN 'access' ELSE 'inherited' END,
            entity_id::text FROM entity_access
        ORDER BY 1, 2
        "#,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| (row.kind, row.id))
    .collect())
}

async fn delete_and_check(db: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> anyhow::Result<()> {
    let before = snapshot(db.as_mut()).await?;
    let mut documents = delete_user_documents(db, USER_ID).await?;
    documents.sort();
    assert_eq!(documents, [DOCUMENT_ID, UNREGISTERED_DOCUMENT_ID]);
    let after_documents = snapshot(db.as_mut()).await?;
    assert_eq!(
        after_documents,
        before
            .iter()
            .filter(|(_, id)| id != DOCUMENT_ID && id != UNREGISTERED_DOCUMENT_ID)
            .cloned()
            .collect::<Vec<_>>()
    );

    delete_user_chats(db, USER_ID).await?;
    let after_chats = snapshot(db.as_mut()).await?;
    assert_eq!(
        after_chats,
        after_documents
            .into_iter()
            .filter(|(_, id)| id != CHAT_ID)
            .collect::<Vec<_>>()
    );

    assert_eq!(delete_user_projects(db, USER_ID).await?, [PROJECT_ID]);
    let after_projects = snapshot(db.as_mut()).await?;
    assert_eq!(
        after_projects,
        after_chats
            .into_iter()
            .filter(|(kind, id)| id != PROJECT_ID && kind != "inherited")
            .collect::<Vec<_>>()
    );

    // Retrying cleanup is safe even when registry rows were already absent.
    assert!(delete_user_documents(db, USER_ID).await?.is_empty());
    delete_user_chats(db, USER_ID).await?;
    assert!(delete_user_projects(db, USER_ID).await?.is_empty());
    assert_eq!(snapshot(db.as_mut()).await?, after_projects);
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_deletion_owners")))]
async fn owner_cleanup_is_scoped_and_transactional(pool: PgPool) -> anyhow::Result<()> {
    let before = snapshot(&mut *pool.acquire().await?).await?;
    assert_eq!(before.len(), 51);

    let mut transaction = pool.begin().await?;
    delete_and_check(&mut transaction).await?;
    transaction.rollback().await?;
    assert_eq!(snapshot(&mut *pool.acquire().await?).await?, before);

    let mut transaction = pool.begin().await?;
    delete_and_check(&mut transaction).await?;
    let after = snapshot(transaction.as_mut()).await?;
    transaction.commit().await?;
    assert_eq!(snapshot(&mut *pool.acquire().await?).await?, after);
    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_deletion_owners")))]
async fn quota_counts_only_live_user_owned_documents(pool: PgPool) -> anyhow::Result<()> {
    let user_id = macro_user_id::user_id::MacroUserId::parse_from_str(USER_ID)?.lowercase();
    let quota = crate::user_quota::get_user_quota(&pool, &user_id).await?;
    // The registered user document is soft-deleted. Only the unregistered user
    // document counts, despite access to the other user's, bot's and team's docs.
    assert_eq!(quota.documents, 1);
    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("basic_user_with_lots_of_documents")
))]
async fn legacy_non_uuid_items_are_still_deleted(pool: PgPool) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let mut documents = delete_user_documents(&mut transaction, "macro|user@user.com").await?;
    documents.sort();
    assert_eq!(
        documents,
        [
            "document-deleted",
            "document-five",
            "document-four",
            "document-one",
            "document-seven",
            "document-six",
            "document-three",
            "document-two",
        ]
    );
    delete_user_chats(&mut transaction, "macro|user@user.com").await?;
    assert_eq!(
        delete_user_projects(&mut transaction, "macro|user@user.com").await?,
        ["project-one"]
    );
    transaction.commit().await?;
    assert!(snapshot(&mut *pool.acquire().await?).await?.is_empty());
    Ok(())
}
