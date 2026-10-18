use super::*;
use std::{future::Future, task::Poll};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn capacity_waits_without_conflicting_or_consuming_pool_headroom(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    let count = repo.subscription_slots.available_permits();
    assert!(count > 0);
    let mut guards = Vec::new();
    for index in 0..count {
        let mut c = connection(Uuid::now_v7(), "owner".into(), &format!("phone-{index}"));
        c.business_account_id = Some(format!("business-{index}").try_into().unwrap());
        guards.push(repo.lock_subscription(&c).await.unwrap().unwrap());
    }
    let unrelated = connection(Uuid::now_v7(), "owner".into(), "other");
    let mut waiting = Box::pin(repo.lock_subscription(&unrelated));
    std::future::poll_fn(|cx| {
        assert!(
            waiting.as_mut().poll(cx).is_pending(),
            "capacity is backpressure, not an account conflict"
        );
        Poll::Ready(())
    })
    .await;
    // Lifecycle holders and waiters leave connections for ordinary work.
    sqlx::query!("SELECT 1 AS value")
        .fetch_one(&pool)
        .await
        .unwrap();
    drop(guards.pop());
    let guard = tokio::time::timeout(std::time::Duration::from_secs(3), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    drop(guards);
    assert!(
        repo.lock_subscription(&unrelated).await.unwrap().is_none(),
        "the same WABA still conflicts"
    );
    let mut sibling = unrelated.clone();
    sibling.account_id = "sibling".to_owned().try_into().unwrap();
    assert!(repo.lock_subscription(&sibling).await.unwrap().is_none());
    drop(guard);
    let _released = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        repo.connect_transaction(&sibling),
    )
    .await
    .unwrap()
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelled_advisory_waiters_cannot_consume_the_owners_pool_headroom(pool: PgPool) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let mut warmed = Vec::new();
    for _ in 0..4 {
        warmed.push(pool.acquire().await.unwrap());
    }
    drop(warmed);
    let repo = PgMessagingRepository::new(pool.clone());
    let c = connection(Uuid::now_v7(), "owner".into(), "shared-phone");
    let owner = repo.lock_subscription(&c).await.unwrap().unwrap();
    // Each deadline deliberately cancels a blocked connect, as a lost HTTP
    // caller would. This exercises cancellation; it is not a retry/poll loop.
    for _ in 0..6 {
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(100),
                repo.connect_transaction(&c),
            )
            .await
            .is_err()
        );
    }
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        sqlx::query!("SELECT 1 AS value").fetch_one(&pool),
    )
    .await
    .expect("canceled lock waiters must not starve ordinary queries")
    .unwrap();
    drop(owner);
    let _released = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        repo.connect_transaction(&c),
    )
    .await
    .unwrap()
    .unwrap();
}
