use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn exact_direct_levels_and_attributable_deletion(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    acquire_guard(&mut tx).await?;
    let id = Uuid::from_u128(0x20000000000000000000000000000002);
    let team = Uuid::from_u128(0x10000000000000000000000000000001);
    upsert_direct(
        tx.as_mut(),
        &id,
        EntityType::Document,
        team,
        AccessLevel::View,
    )
    .await?;
    assert_eq!(
        direct_level(tx.as_mut(), &id, EntityType::Document, team).await?,
        Some(AccessLevel::View)
    );
    delete_direct(tx.as_mut(), &id, EntityType::Document, team).await?;
    assert_eq!(
        direct_level(tx.as_mut(), &id, EntityType::Document, team).await?,
        None
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM entity_access")
            .fetch_one(tx.as_mut())
            .await?,
        Some(2)
    );
    tx.rollback().await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM entity_access")
            .fetch_one(&pool)
            .await?,
        Some(3)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn guard_uses_documented_key_and_transaction_lifetime(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    let mut first = pool.begin().await?;
    acquire_guard(&mut first).await?;
    acquire_guard(&mut first).await?;
    let mut second = pool.begin().await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT pg_try_advisory_xact_lock(1413824845, 1)")
            .fetch_one(second.as_mut())
            .await?,
        Some(false)
    );
    first.rollback().await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT pg_try_advisory_xact_lock(1413824845, 1)")
            .fetch_one(second.as_mut())
            .await?,
        Some(true)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn guard_rejects_stale_snapshot_isolation(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(tx.as_mut())
        .await?;
    assert!(matches!(
        acquire_guard(&mut tx).await,
        Err(sqlx::Error::InvalidArgument(_))
    ));
    Ok(())
}
