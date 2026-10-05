use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test]
async fn counts_live_and_soft_deleted_documents(pool: Pool<Postgres>) {
    let owner = "macro|owner@example.com";
    for id in ["live-document", "deleted-document"] {
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'doc', $2, 'md')"#,
            id,
            owner,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = $1"#,
        "deleted-document",
    )
    .execute(&pool)
    .await
    .unwrap();

    // A soft-deleted document keeps its id (and its sync-service session).
    for id in ["live-document", "deleted-document"] {
        assert!(does_document_exist(pool.clone(), id).await.unwrap(), "{id}");
    }
    assert!(!does_document_exist(pool, "missing-document").await.unwrap());
}
