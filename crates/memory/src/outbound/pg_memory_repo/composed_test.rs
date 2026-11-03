use super::PgMemoryRepo;
use crate::domain::{models::*, ports::*};
use chrono::NaiveDate;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicit_edits_compare_revisions_and_cascade(pool: PgPool) {
    sqlx::query!(
        r#"WITH created AS (
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'memory@example.com', 'memory@example.com', 'stripe_memory') RETURNING id
    ) INSERT INTO "User" (id, email, macro_user_id)
    SELECT 'macro|memory@example.com', 'memory@example.com', id FROM created"#,
        macro_uuid::generate_uuid_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMemoryRepo::new(pool.clone());
    let user = MacroUserIdStr::parse_from_str("macro|memory@example.com").unwrap();
    assert_eq!(repo.explicit(&user).await.unwrap().revision, 0);
    let first = repo.save_explicit(&user, 0, "Be concise").await.unwrap();
    assert_eq!(first.revision, 1);
    assert!(matches!(
        repo.save_explicit(&user, 0, "Duplicate").await,
        Err(MemoryError::Conflict)
    ));
    let second = repo
        .save_explicit(&user, first.revision, "Be concise\nUse Rust")
        .await
        .unwrap();
    assert_eq!(second.revision, 2);
    assert_eq!(
        repo.explicit(&user).await.unwrap().content,
        "Be concise\nUse Rust"
    );
    sqlx::query!(r#"DELETE FROM "User" WHERE id = 'macro|memory@example.com'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.explicit(&user).await.unwrap().revision, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn generation_is_atomic_and_daily_rows_are_immutable(pool: PgPool) {
    sqlx::query!(
        r#"WITH created AS (
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'memory@example.com', 'memory@example.com', 'stripe_memory') RETURNING id
    ) INSERT INTO "User" (id, email, macro_user_id)
    SELECT 'macro|memory@example.com', 'memory@example.com', id FROM created"#,
        macro_uuid::generate_uuid_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMemoryRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str("macro|memory@example.com").unwrap();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    let mut daily = Activity {
        granularity: Granularity::Day,
        period_start: date,
        period_end: date,
        content: "Original".into(),
    };
    repo.save_generation(&user, 0, date, "Engineer", &[daily.clone()], &[])
        .await
        .unwrap();
    daily.content = "Stale overwrite".into();
    assert!(matches!(
        repo.save_generation(&user, 0, date, "Wrong profile", &[daily.clone()], &[])
            .await,
        Err(MemoryError::Conflict)
    ));
    repo.save_generation(&user, 1, date, "Engineer updated", &[daily], &[])
        .await
        .unwrap();
    let snapshot = repo.snapshot(&user, date).await.unwrap();
    assert_eq!(snapshot.profile, "Engineer updated");
    assert_eq!(snapshot.activity[0].content, "Original");
    assert_eq!(snapshot.revision, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn leases_preserve_first_failed_day_and_catch_up_sequentially(pool: PgPool) {
    sqlx::query!(
        r#"WITH created AS (
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'memory@example.com', 'memory@example.com', 'stripe_memory') RETURNING id
    ) INSERT INTO "User" (id, email, macro_user_id)
    SELECT 'macro|memory@example.com', 'memory@example.com', id FROM created"#,
        macro_uuid::generate_uuid_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMemoryRepo::new(pool.clone());
    let user = MacroUserIdStr::parse_from_str("macro|memory@example.com").unwrap();
    repo.enroll(&user).await.unwrap();
    sqlx::query!(
        "UPDATE memory_refresh_job SET created_at = '2026-06-18 12:00:00+00' WHERE user_id = $1",
        user.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    let yesterday = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();
    assert_eq!(
        repo.snapshot(&user, yesterday).await.unwrap().first_date,
        NaiveDate::from_ymd_opt(2026, 6, 17)
    );
    let claim = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(claim.date, NaiveDate::from_ymd_opt(2026, 6, 17).unwrap());
    assert!(repo.claim_refresh(yesterday).await.unwrap().is_none());
    // Simulate lease expiry after a failed first generation, without sleeping.
    sqlx::query!(
        "UPDATE memory_refresh_job SET lease_until = '-infinity' WHERE user_id = $1",
        user.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(retry.date, claim.date);
    assert_ne!(retry.token, claim.token);
    repo.release_refresh(&claim).await.unwrap();
    assert!(
        repo.claim_refresh(yesterday).await.unwrap().is_none(),
        "a stale worker must not release its replacement's lease"
    );
    repo.save_generation(&user, 0, retry.date, "Engineer", &[], &[])
        .await
        .unwrap();
    repo.release_refresh(&retry).await.unwrap();
    let next = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(next.date, NaiveDate::from_ymd_opt(2026, 6, 18).unwrap());
}
