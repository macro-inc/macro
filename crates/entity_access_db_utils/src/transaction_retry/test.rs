use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use rootcause::compat::IntoRootcause;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Barrier;

#[tokio::test]
async fn does_not_retry_an_unconfirmed_failure() {
    let attempts = AtomicUsize::new(0);
    let result = on_conflict(
        || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            Err::<(), _>(sqlx::Error::Io(std::io::Error::from(
                std::io::ErrorKind::ConnectionReset,
            )))
        },
        |error| is_transaction_conflict(error),
    )
    .await;
    assert!(matches!(result, Err(sqlx::Error::Io(_))));
    assert_eq!(attempts.load(Ordering::Relaxed), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_the_final_error_after_bounded_serialization_retries(
    pool: PgPool,
) -> anyhow::Result<()> {
    let attempts = AtomicUsize::new(0);
    let result = on_conflict(
        || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            let mut transaction = pool.begin().await?;
            sqlx::query!(
                "DO $$ BEGIN RAISE EXCEPTION 'retry test' USING ERRCODE = '40001'; END $$"
            )
            .execute(transaction.as_mut())
            .await?;
            transaction.commit().await
        },
        |error| is_transaction_conflict(error),
    )
    .await;
    assert_wrapped_conflict(result.unwrap_err(), true);
    assert_eq!(attempts.load(Ordering::Relaxed), 4);
    Ok(())
}

/// Reproduce item-first editing versus grant-first revocation. PostgreSQL may
/// abort either transaction; retrying both boundaries must commit each effect once.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn retries_either_victim_and_rolls_back_its_first_attempt(
    pool: PgPool,
) -> anyhow::Result<()> {
    let barrier = Barrier::new(2);
    let edit_attempts = AtomicUsize::new(0);
    let revoke_attempts = AtomicUsize::new(0);

    let edit = on_conflict(
        || async {
            let attempt = edit_attempts.fetch_add(1, Ordering::Relaxed);
            let mut transaction = pool.begin().await?;
            sqlx::query!(
                r#"UPDATE "Document" SET name = name || '-edit' WHERE id = $1"#,
                "20000000-0000-0000-0000-000000000002",
            )
            .execute(transaction.as_mut())
            .await?;
            if attempt == 0 {
                barrier.wait().await;
            }
            delete_test_grant(transaction.as_mut()).await?;
            transaction.commit().await
        },
        |error| is_transaction_conflict(error),
    );
    let revoke = on_conflict(
        || async {
            let attempt = revoke_attempts.fetch_add(1, Ordering::Relaxed);
            let mut transaction = pool.begin().await?;
            sqlx::query!("SELECT id FROM entity_access WHERE source_id = 'other-team' FOR UPDATE")
                .fetch_all(transaction.as_mut())
                .await?;
            if attempt == 0 {
                barrier.wait().await;
            }
            delete_test_grant(transaction.as_mut()).await?;
            // Exercise a canonical-row lock cycle independently of projection maintenance.
            sqlx::query!(
                r#"UPDATE "Document" SET name = name || '-revoke' WHERE id = $1"#,
                "20000000-0000-0000-0000-000000000002",
            )
            .execute(transaction.as_mut())
            .await?;
            transaction.commit().await
        },
        |error| is_transaction_conflict(error),
    );
    let (edit, revoke) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(edit, revoke)
    })
    .await?;
    edit?;
    revoke?;
    assert!(edit_attempts.load(Ordering::Relaxed) + revoke_attempts.load(Ordering::Relaxed) > 2);
    let name = sqlx::query_scalar!(
        r#"SELECT name FROM "Document" WHERE id = $1"#,
        "20000000-0000-0000-0000-000000000002",
    )
    .fetch_one(&pool)
    .await?;
    assert!(name == "Document-edit-revoke" || name == "Document-revoke-edit");
    let remaining =
        sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE source_id = 'other-team'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(remaining, Some(0));
    Ok(())
}

async fn delete_test_grant(connection: &mut sqlx::PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM entity_access WHERE source_id = 'other-team'")
        .execute(connection)
        .await?;
    Ok(())
}

fn assert_wrapped_conflict(error: sqlx::Error, expected: bool) {
    assert_eq!(is_transaction_conflict(&error), expected);
    let report = rootcause::Report::new_sendsync(error).context("sharing write failed");
    let wrapped: anyhow::Error = report.into();
    let wrapped = wrapped.context("repository operation failed");
    assert_eq!(is_transaction_conflict(wrapped.as_ref()), expected);
    let nested: anyhow::Error = wrapped.into_rootcause().context("adapter failed").into();
    assert_eq!(is_transaction_conflict(nested.as_ref()), expected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn does_not_retry_wrapped_constraint_violations(pool: PgPool) -> anyhow::Result<()> {
    let error =
        sqlx::query!("DO $$ BEGIN RAISE EXCEPTION 'retry test' USING ERRCODE = '23505'; END $$")
            .execute(&pool)
            .await
            .unwrap_err();
    assert_wrapped_conflict(error, false);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn converted_reports_keep_only_conflicts_retryable(pool: PgPool) -> anyhow::Result<()> {
    let deadlock =
        sqlx::query!("DO $$ BEGIN RAISE EXCEPTION 'retry test' USING ERRCODE = '40P01'; END $$")
            .execute(&pool)
            .await
            .unwrap_err();
    let violation =
        sqlx::query!("DO $$ BEGIN RAISE EXCEPTION 'retry test' USING ERRCODE = '23505'; END $$")
            .execute(&pool)
            .await
            .unwrap_err();
    for (error, conflict) in [(deadlock, true), (violation, false)] {
        let report = rootcause::Report::new_sendsync(error).context("registry write failed");
        let converted = report_into_sqlx_error(report);
        assert_eq!(is_transaction_conflict(&converted), conflict);
        assert_eq!(matches!(converted, sqlx::Error::Protocol(_)), !conflict);
    }
    Ok(())
}
