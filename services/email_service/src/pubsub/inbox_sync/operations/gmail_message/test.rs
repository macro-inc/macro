use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn insert_email_link(pool: &PgPool) -> (Uuid, String) {
    let link_id = Uuid::now_v7();
    let email_address = format!("stale-cursor-{link_id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|stale-cursor@example.com",
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    (link_id, email_address)
}

async fn stored_history_id(pool: &PgPool, email_address: &str) -> Option<String> {
    email_db_client::histories::fetch_history_id_for_link(pool, email_address, UserProvider::Gmail)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_backfill_job_is_created_once_and_then_reused(pool: PgPool) {
    let (link_id, _) = insert_email_link(&pool).await;

    let (job, created) = ensure_recovery_backfill_job(&pool, link_id, "fa-user")
        .await
        .unwrap();
    assert!(created, "first stale-cursor recovery creates a job");

    let (reused_job, created_again) = ensure_recovery_backfill_job(&pool, link_id, "fa-user")
        .await
        .unwrap();
    assert!(
        !created_again,
        "a second notification must reuse the active recovery job instead of creating another"
    );
    assert_eq!(job.id, reused_job.id);

    // Recovery jobs are flagged so backfill refreshes existing threads
    // instead of skipping them (and the init outbox skips the priority pass).
    let is_recovery = sqlx::query_scalar!(
        r#"SELECT is_recovery FROM email_backfill_jobs WHERE id = $1"#,
        job.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_recovery);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_cursor_repair_persists_the_notification_history_id(pool: PgPool) {
    let (link_id, email_address) = insert_email_link(&pool).await;
    email_db_client::histories::upsert_gmail_history(&pool, link_id, "12345")
        .await
        .unwrap();

    repair_stale_cursor(&pool, link_id, 99999).await;

    // The stored cursor now parses and matches the notification, so the next
    // notification takes the incremental list_changes path (its freshness
    // check `db_history >= payload.history_id` holds for this history id).
    assert_eq!(
        stored_history_id(&pool, &email_address).await.as_deref(),
        Some("99999")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_cursor_repair_inserts_a_cursor_when_none_exists(pool: PgPool) {
    let (link_id, email_address) = insert_email_link(&pool).await;

    repair_stale_cursor(&pool, link_id, 424242).await;

    assert_eq!(
        stored_history_id(&pool, &email_address).await.as_deref(),
        Some("424242")
    );
}
