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
    repo.save_generation(&user, 0, date, Some("Engineer"), &[daily.clone()], &[])
        .await
        .unwrap();
    daily.content = "Stale overwrite".into();
    assert!(matches!(
        repo.save_generation(&user, 0, date, Some("Wrong profile"), &[daily.clone()], &[])
            .await,
        Err(MemoryError::Conflict)
    ));
    repo.save_generation(&user, 1, date, Some("Engineer updated"), &[daily], &[])
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
    // A new user's first day waits for the cutoff like every later day.
    let before_first_day = NaiveDate::from_ymd_opt(2026, 6, 16).unwrap();
    assert!(
        repo.claim_refresh(before_first_day)
            .await
            .unwrap()
            .is_none()
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
    repo.save_generation(&user, 0, retry.date, Some("Engineer"), &[], &[])
        .await
        .unwrap();
    repo.release_refresh(&retry).await.unwrap();
    let next = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(next.date, NaiveDate::from_ymd_opt(2026, 6, 18).unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claims_count_attempts_per_day_and_retries_wait(pool: PgPool) {
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
    let first = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(first.attempt, 1);
    repo.retry_refresh(&first, chrono::Duration::hours(1))
        .await
        .unwrap();
    assert!(
        repo.claim_refresh(yesterday).await.unwrap().is_none(),
        "a failed day waits out its delay"
    );
    let expire = || {
        sqlx::query!(
            "UPDATE memory_refresh_job SET lease_until = '-infinity' WHERE user_id = $1",
            user.as_ref()
        )
        .execute(&pool)
    };
    expire().await.unwrap();
    let second = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!((second.date, second.attempt), (first.date, 2));
    // A crashed worker never reports back; its expired lease still counts.
    expire().await.unwrap();
    let third = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(third.attempt, 3);
    repo.save_generation(&user, 0, third.date, None, &[], &[])
        .await
        .unwrap();
    repo.release_refresh(&third).await.unwrap();
    let next = repo.claim_refresh(yesterday).await.unwrap().unwrap();
    assert_eq!(
        (next.date, next.attempt),
        (NaiveDate::from_ymd_opt(2026, 6, 18).unwrap(), 1),
        "a new day starts counting again"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn staged_pieces_survive_until_the_day_commits(pool: PgPool) {
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
    let daily = Activity {
        granularity: Granularity::Day,
        period_start: date,
        period_end: date,
        content: "Shipped".into(),
    };
    let weekly = Activity {
        granularity: Granularity::Week,
        period_start: NaiveDate::from_ymd_opt(2026, 6, 15).unwrap(),
        period_end: date,
        content: "Week".into(),
    };
    repo.stage(&user, date, &Piece::Activity(daily.clone()))
        .await
        .unwrap();
    repo.stage(&user, date, &Piece::Activity(weekly.clone()))
        .await
        .unwrap();
    repo.stage(&user, date, &Piece::Profile("Engineer".into()))
        .await
        .unwrap();
    let staged = repo.staged(&user, date).await.unwrap();
    assert_eq!(staged.activity(Granularity::Day), Some(&daily));
    assert_eq!(staged.activity(Granularity::Week), Some(&weekly));
    assert_eq!(staged.profile.as_deref(), Some("Engineer"));
    assert!(
        repo.staged(&user, date.succ_opt().unwrap())
            .await
            .unwrap()
            .is_empty(),
        "pieces belong to their day"
    );

    // Moving past a day without a profile leaves no profile to share.
    repo.save_generation(&user, 0, date, None, &[daily], &[])
        .await
        .unwrap();
    assert!(repo.staged(&user, date).await.unwrap().is_empty());
    assert!(
        repo.profiles(&[user.as_ref().to_owned()])
            .await
            .unwrap()
            .is_empty()
    );
    let snapshot = repo.snapshot(&user, date).await.unwrap();
    assert_eq!(snapshot.through_date, Some(date));
    assert_eq!(snapshot.activity.len(), 1);

    let next = date.succ_opt().unwrap();
    repo.save_generation(&user, 1, next, Some("Engineer"), &[], &[])
        .await
        .unwrap();
    repo.save_generation(&user, 2, next.succ_opt().unwrap(), None, &[], &[])
        .await
        .unwrap();
    assert_eq!(
        repo.profiles(&[user.as_ref().to_owned()]).await.unwrap(),
        vec![(user.as_ref().to_owned(), "Engineer".to_owned())],
        "a day without a new profile keeps the last one"
    );
}
