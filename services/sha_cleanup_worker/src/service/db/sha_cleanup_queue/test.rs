use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;

async fn insert_bom_part(pool: &PgPool, sha: &str) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
        VALUES ('a1111111-1111-1111-1111-111111111111', 'user@example.com', 'user@example.com', 's')
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
        VALUES ('macro|user@example.com', 'user@example.com', 's', 'a1111111-1111-1111-1111-111111111111')
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, "fileType", owner, "createdAt", "updatedAt")
        VALUES ('docx-one', 'one', 'docx', 'macro|user@example.com', now(), now())
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO "DocumentBom" (id, "revisionName", "documentId", "createdAt", "updatedAt")
        VALUES (1, 'one', 'docx-one', now(), now())
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "BomPart" (id, sha, path, "documentBomId") VALUES ('part', $1, 'word/document.xml', 1)"#,
    )
    .bind(sha)
    .execute(pool)
    .await?;
    Ok(())
}

async fn remaining(pool: &PgPool) -> anyhow::Result<Vec<String>> {
    Ok(
        sqlx::query_scalar("SELECT sha FROM sha_cleanup_queue ORDER BY sha")
            .fetch_all(pool)
            .await?,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_part_reused_after_its_release_is_kept(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('orphan'), ('reused')")
        .execute(&pool)
        .await?;
    let read = queued_shas(&pool).await?;
    // A save reuses the part after the worker read the queue.
    insert_bom_part(&pool, "reused").await?;

    let mut referenced = Vec::new();
    for queued in &read {
        let claim = claim_sha(&pool, queued)
            .await?
            .expect("the sha is still queued");
        referenced.push((queued.sha.clone(), claim.referenced));
        claim.commit().await?;
    }

    assert_eq!(
        referenced,
        vec![("orphan".to_string(), false), ("reused".to_string(), true)]
    );
    assert_eq!(remaining(&pool).await?, Vec::<String>::new());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_delete_leaves_the_sha_queued(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('orphan')")
        .execute(&pool)
        .await?;
    let read = queued_shas(&pool).await?;

    let claim = claim_sha(&pool, &read[0])
        .await?
        .expect("the sha is still queued");
    assert!(!claim.referenced);
    drop(claim);

    assert_eq!(remaining(&pool).await?, vec!["orphan".to_string()]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_release_during_cleanup_stays_queued(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('released-again')")
        .execute(&pool)
        .await?;
    let read = queued_shas(&pool).await?;

    sqlx::query(
        "UPDATE sha_cleanup_queue SET queued_at = queued_at + interval '1 second' WHERE sha = 'released-again'",
    )
    .execute(&pool)
    .await?;

    assert!(claim_sha(&pool, &read[0]).await?.is_none());
    assert_eq!(remaining(&pool).await?, vec!["released-again".to_string()]);
    Ok(())
}
