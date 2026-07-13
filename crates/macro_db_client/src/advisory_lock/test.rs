use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test]
async fn test_xact_lock_acquired_in_transaction(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    let mut txn = pool.begin().await?;

    // Should acquire lock successfully within transaction
    let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
    assert!(acquired, "Should acquire lock on first attempt");

    txn.commit().await?;

    Ok(())
}

#[sqlx::test]
async fn test_xact_lock_blocks_concurrent_transaction(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    // First transaction acquires the lock
    let mut txn1 = pool.begin().await?;
    let acquired1 = try_acquire_user_refresh_xact_lock(&mut txn1, &user_id).await?;
    assert!(acquired1, "First transaction should acquire lock");

    // Second transaction should fail to acquire the same lock
    let mut txn2 = pool.begin().await?;
    let acquired2 = try_acquire_user_refresh_xact_lock(&mut txn2, &user_id).await?;
    assert!(
        !acquired2,
        "Second transaction should NOT acquire lock while first holds it"
    );

    // After first transaction commits, second should be able to acquire
    txn1.commit().await?;

    let acquired3 = try_acquire_user_refresh_xact_lock(&mut txn2, &user_id).await?;
    assert!(
        acquired3,
        "Second transaction should acquire lock after first commits"
    );

    txn2.commit().await?;

    Ok(())
}

#[sqlx::test]
async fn test_xact_lock_released_on_commit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    // Acquire and commit in first transaction
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(acquired, "Should acquire lock");
        txn.commit().await?;
    }

    // Should be able to acquire again in new transaction (lock was released)
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(acquired, "Should acquire lock again after previous commit");
        txn.commit().await?;
    }

    Ok(())
}

#[sqlx::test]
async fn test_xact_lock_released_on_rollback(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    // Acquire and rollback in first transaction
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(acquired, "Should acquire lock");
        txn.rollback().await?;
    }

    // Should be able to acquire again in new transaction (lock was released on rollback)
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(
            acquired,
            "Should acquire lock again after previous rollback"
        );
        txn.commit().await?;
    }

    Ok(())
}

#[sqlx::test]
async fn test_xact_lock_released_on_drop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")
        .unwrap()
        .lowercase();

    // Acquire and drop transaction without explicit commit/rollback
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(acquired, "Should acquire lock");
        // txn is dropped here without explicit commit/rollback
    }

    // Should be able to acquire again in new transaction (lock was released on drop)
    {
        let mut txn = pool.begin().await?;
        let acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id).await?;
        assert!(acquired, "Should acquire lock again after previous drop");
        txn.commit().await?;
    }

    Ok(())
}

#[sqlx::test]
async fn test_xact_lock_different_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id_1 = MacroUserId::parse_from_str("macro|user1@user.com")
        .unwrap()
        .lowercase();
    let user_id_2 = MacroUserId::parse_from_str("macro|user2@user.com")
        .unwrap()
        .lowercase();

    let mut txn = pool.begin().await?;

    // Both users should be able to acquire their own locks in the same transaction
    let acquired1 = try_acquire_user_refresh_xact_lock(&mut txn, &user_id_1).await?;
    let acquired2 = try_acquire_user_refresh_xact_lock(&mut txn, &user_id_2).await?;

    assert!(acquired1, "User 1 should acquire lock");
    assert!(acquired2, "User 2 should acquire lock");

    txn.commit().await?;

    Ok(())
}
