//! Concurrent permission lookups through the functions production calls: the
//! compiled library has its cache on, unlike the crate's unit tests. Every test
//! uses its own user ids because that cache is shared by the whole test binary.

use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use futures::future::join_all;
use macro_db_client::{
    call_record::get::get_accessible_call_ids,
    item_access::get_accessible_items::get_user_accessible_items,
};
use model::item::UserAccessibleItem;
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use uuid::Uuid;

/// A pool that counts connection checkouts. Each lookup statement checks out
/// one connection, so the count is the number of statements the lookups ran.
async fn counting_pool(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> sqlx::Result<(PgPool, Arc<AtomicUsize>)> {
    let checkouts = Arc::new(AtomicUsize::new(0));
    let new_connections = Arc::clone(&checkouts);
    let reused_connections = Arc::clone(&checkouts);

    let pool = options
        .after_connect(move |_, _| {
            let checkouts = Arc::clone(&new_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        })
        .before_acquire(move |_, _| {
            let checkouts = Arc::clone(&reused_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(true)
            })
        })
        .connect_with(connect)
        .await?;

    Ok((pool, checkouts))
}

fn item_ids(items: Vec<UserAccessibleItem>) -> Vec<String> {
    items.into_iter().map(|item| item.item_id).collect()
}

#[sqlx::test]
async fn concurrent_identical_item_lookups_run_the_queries_once(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('d1000000-0000-0000-0000-000000000001', 'Shared', 'macro|items-once-owner@example.test');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('d1000000-0000-0000-0000-000000000001', 'document', 'macro|items-once@example.test', 'user', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);

    let lookups = (0..20).map(|_| {
        get_user_accessible_items(
            &pool,
            "macro|items-once@example.test",
            Some("document".to_string()),
            false,
        )
    });
    for items in join_all(lookups).await {
        assert_eq!(
            item_ids(items?),
            vec!["d1000000-0000-0000-0000-000000000001"]
        );
    }

    // One source id statement and one document statement for all twenty.
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    // The ten second cache still answers the next caller without a statement.
    let cached = get_user_accessible_items(
        &pool,
        "macro|items-once@example.test",
        Some("document".to_string()),
        false,
    )
    .await?;
    assert_eq!(
        item_ids(cached),
        vec!["d1000000-0000-0000-0000-000000000001"]
    );
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    Ok(())
}

#[sqlx::test]
async fn item_lookups_for_other_users_and_filters_stay_separate(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('d2000000-0000-0000-0000-00000000000a', 'Owned by A', 'macro|items-separate-a@example.test'),
               ('d2000000-0000-0000-0000-00000000000b', 'Shared with B', 'macro|items-separate-owner@example.test');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('d2000000-0000-0000-0000-00000000000a', 'document', 'macro|items-separate-a@example.test', 'user', 'owner'),
               ('d2000000-0000-0000-0000-00000000000b', 'document', 'macro|items-separate-b@example.test', 'user', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);

    let (a_documents, b_documents, a_chats, a_documents_not_owned) = futures::join!(
        get_user_accessible_items(
            &pool,
            "macro|items-separate-a@example.test",
            Some("document".to_string()),
            false,
        ),
        get_user_accessible_items(
            &pool,
            "macro|items-separate-b@example.test",
            Some("document".to_string()),
            false,
        ),
        get_user_accessible_items(
            &pool,
            "macro|items-separate-a@example.test",
            Some("chat".to_string()),
            false,
        ),
        get_user_accessible_items(
            &pool,
            "macro|items-separate-a@example.test",
            Some("document".to_string()),
            true,
        ),
    );

    assert_eq!(
        item_ids(a_documents?),
        vec!["d2000000-0000-0000-0000-00000000000a"]
    );
    assert_eq!(
        item_ids(b_documents?),
        vec!["d2000000-0000-0000-0000-00000000000b"]
    );
    assert_eq!(item_ids(a_chats?), Vec::<String>::new());
    assert_eq!(item_ids(a_documents_not_owned?), Vec::<String>::new());

    // Four lookups, each with its own source id statement and item statement.
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 8);

    Ok(())
}

#[sqlx::test]
async fn a_failed_item_lookup_fails_every_waiting_caller_and_the_next_one_runs_again(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('d3000000-0000-0000-0000-000000000001', 'Shared', 'macro|items-failed-owner@example.test');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('d3000000-0000-0000-0000-000000000001', 'document', 'macro|items-failed@example.test', 'user', 'view');
        COMMIT;
        ALTER TABLE entity_access RENAME TO entity_access_moved;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);

    let lookups = (0..5).map(|_| {
        get_user_accessible_items(
            &pool,
            "macro|items-failed@example.test",
            Some("document".to_string()),
            false,
        )
    });
    for items in join_all(lookups).await {
        let error = items.expect_err("entity_access is missing");
        assert!(error.downcast_ref::<Arc<sqlx::Error>>().is_some());
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    sqlx::raw_sql("ALTER TABLE entity_access_moved RENAME TO entity_access")
        .execute(&pool)
        .await?;
    let before_retry = checkouts.load(Ordering::SeqCst);

    let items = get_user_accessible_items(
        &pool,
        "macro|items-failed@example.test",
        Some("document".to_string()),
        false,
    )
    .await?;
    assert_eq!(
        item_ids(items),
        vec!["d3000000-0000-0000-0000-000000000001"]
    );
    assert_eq!(checkouts.load(Ordering::SeqCst) - before_retry, 2);

    Ok(())
}

#[sqlx::test]
async fn cancelling_the_first_item_lookup_leaves_the_others_one_shared_run(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('d4000000-0000-0000-0000-000000000001', 'Shared', 'macro|items-cancelled-owner@example.test');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('d4000000-0000-0000-0000-000000000001', 'document', 'macro|items-cancelled@example.test', 'user', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);

    let mut lookups: Vec<Pin<Box<dyn Future<Output = _>>>> = Vec::new();
    for _ in 0..3 {
        lookups.push(Box::pin(get_user_accessible_items(
            &pool,
            "macro|items-cancelled@example.test",
            Some("document".to_string()),
            false,
        )));
    }
    for lookup in &mut lookups {
        assert!(futures::poll!(lookup.as_mut()).is_pending());
    }
    drop(lookups.remove(0));

    for items in join_all(lookups).await {
        assert_eq!(
            item_ids(items?),
            vec!["d4000000-0000-0000-0000-000000000001"]
        );
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    Ok(())
}

#[sqlx::test]
async fn concurrent_identical_call_lookups_run_the_query_once_and_nothing_is_cached(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO call_records (id, room_name, created_by, started_at, duration_ms, share_permission_id)
        VALUES ('c1000000-0000-0000-0000-000000000001', 'room', 'macro|calls-once-owner@example.test', now(), 1000, 'sp-calls-once');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('c1000000-0000-0000-0000-000000000001', 'call', 'macro|calls-once@example.test', 'user', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);
    let call: Uuid = "c1000000-0000-0000-0000-000000000001".parse()?;

    let lookups =
        (0..20).map(|_| get_accessible_call_ids(&pool, "macro|calls-once@example.test", &[]));
    for call_ids in join_all(lookups).await {
        assert_eq!(call_ids?, vec![call]);
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 1);

    // Call access has no cache: a caller that arrives afterwards asks again.
    let later = get_accessible_call_ids(&pool, "macro|calls-once@example.test", &[]).await?;
    assert_eq!(later, vec![call]);
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    Ok(())
}

#[sqlx::test]
async fn call_lookups_for_other_users_and_status_filters_stay_separate(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO call_records (id, room_name, created_by, started_at, duration_ms, share_permission_id)
        VALUES ('c2000000-0000-0000-0000-00000000000a', 'room-a', 'macro|calls-separate-owner@example.test', now(), 1000, 'sp-calls-separate-a'),
               ('c2000000-0000-0000-0000-00000000000b', 'room-b', 'macro|calls-separate-owner@example.test', now(), 1000, 'sp-calls-separate-b');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('c2000000-0000-0000-0000-00000000000a', 'call', 'macro|calls-separate-a@example.test', 'user', 'view'),
               ('c2000000-0000-0000-0000-00000000000b', 'call', 'macro|calls-separate-b@example.test', 'user', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);
    let call_a: Uuid = "c2000000-0000-0000-0000-00000000000a".parse()?;
    let call_b: Uuid = "c2000000-0000-0000-0000-00000000000b".parse()?;
    let attended = ["ATTENDED".to_string()];

    let (a_calls, b_calls, a_attended_calls) = futures::join!(
        get_accessible_call_ids(&pool, "macro|calls-separate-a@example.test", &[]),
        get_accessible_call_ids(&pool, "macro|calls-separate-b@example.test", &[]),
        get_accessible_call_ids(&pool, "macro|calls-separate-a@example.test", &attended),
    );

    assert_eq!(a_calls?, vec![call_a]);
    assert_eq!(b_calls?, vec![call_b]);
    assert_eq!(a_attended_calls?, Vec::<Uuid>::new());
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 3);

    Ok(())
}

#[sqlx::test]
async fn a_failed_call_lookup_fails_every_waiting_caller_and_the_next_one_runs_again(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO call_records (id, room_name, created_by, started_at, duration_ms, share_permission_id)
        VALUES ('c3000000-0000-0000-0000-000000000001', 'room', 'macro|calls-failed-owner@example.test', now(), 1000, 'sp-calls-failed');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('c3000000-0000-0000-0000-000000000001', 'call', 'macro|calls-failed@example.test', 'user', 'view');
        COMMIT;
        ALTER TABLE call_records RENAME TO call_records_moved;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);

    let lookups =
        (0..5).map(|_| get_accessible_call_ids(&pool, "macro|calls-failed@example.test", &[]));
    for call_ids in join_all(lookups).await {
        let error = call_ids.expect_err("call_records is missing");
        assert!(error.downcast_ref::<Arc<sqlx::Error>>().is_some());
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 1);

    sqlx::raw_sql("ALTER TABLE call_records_moved RENAME TO call_records")
        .execute(&pool)
        .await?;

    let call_ids = get_accessible_call_ids(&pool, "macro|calls-failed@example.test", &[]).await?;
    assert_eq!(
        call_ids,
        vec!["c3000000-0000-0000-0000-000000000001".parse::<Uuid>()?]
    );

    Ok(())
}
