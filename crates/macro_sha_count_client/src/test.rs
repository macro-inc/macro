use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model::document::SaveBomPart;
use sqlx::PgPool;

use super::ShaReferences;

async fn insert_bom_part(pool: &PgPool, id: &str, sha: &str) {
    sqlx::query(
        r#"
        INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
        VALUES ('a1111111-1111-1111-1111-111111111111', 'u@u.com', 'u@u.com', 's')
        ON CONFLICT DO NOTHING
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
        VALUES ('macro|u@u.com', 'u@u.com', 's', 'a1111111-1111-1111-1111-111111111111')
        ON CONFLICT DO NOTHING
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, "fileType", owner, "createdAt", "updatedAt")
        VALUES ('docx-one', 'one', 'docx', 'macro|u@u.com', now(), now())
        ON CONFLICT DO NOTHING
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO "DocumentBom" (id, "revisionName", "documentId", "createdAt", "updatedAt")
        VALUES (1, 'one', 'docx-one', now(), now())
        ON CONFLICT DO NOTHING
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BomPart" (id, sha, path, "documentBomId") VALUES ($1, $2, 'path', 1)"#,
    )
    .bind(id)
    .bind(sha)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_unreferenced_parts_need_uploading(pool: PgPool) {
    insert_bom_part(&pool, "b1", "stored").await;
    let references = ShaReferences::new(pool);

    let missing = references
        .find_non_existing_shas(&[
            SaveBomPart {
                sha: "stored".to_string(),
                path: "word/document.xml".to_string(),
            },
            SaveBomPart {
                sha: "new".to_string(),
                path: "word/media/image1.png".to_string(),
            },
        ])
        .await
        .unwrap();
    assert_eq!(
        missing,
        vec![SaveBomPart {
            sha: "new".to_string(),
            path: "word/media/image1.png".to_string(),
        }]
    );

    let missing = references
        .find_non_existing_shas_string(vec!["stored".to_string(), "new".to_string()])
        .await
        .unwrap();
    assert_eq!(missing, vec!["new".to_string()]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn released_shas_are_queued_once(pool: PgPool) {
    let references = ShaReferences::new(pool.clone());

    references
        .release_shas(vec!["a".to_string(), "b".to_string(), "a".to_string()])
        .await
        .unwrap();
    references
        .release_shas(vec!["a".to_string()])
        .await
        .unwrap();
    references.release_shas(Vec::new()).await.unwrap();

    let queued: Vec<String> = sqlx::query_scalar("SELECT sha FROM sha_cleanup_queue ORDER BY sha")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(queued, vec!["a".to_string(), "b".to_string()]);
}
