use std::sync::Arc;

use super::*;

fn leases(pool: &PgPool) -> PgEmailThreadLeases {
    PgEmailThreadLeases::new((*pool.connect_options()).clone(), 2)
}

async fn thread_is_free(pool: &PgPool, thread_id: Uuid) -> bool {
    let mut probe = pool.begin().await.unwrap();
    sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('email-thread-search:' || $1::uuid::text, 0)) AS "free!""#,
        thread_id,
    )
    .fetch_one(&mut *probe)
    .await
    .unwrap()
}

#[sqlx::test(migrations = false)]
async fn a_lease_holds_every_thread_until_it_is_dropped(pool: PgPool) {
    let leases = leases(&pool);
    let (first, second, unleased) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());

    let granted = leases
        .lease(&[first, second], LeasePool::Bulk, EmailWriter::Bulk)
        .await
        .unwrap();

    assert!(!thread_is_free(&pool, first).await);
    assert!(!thread_is_free(&pool, second).await);
    assert!(thread_is_free(&pool, unleased).await);
    drop(granted.lease);
    assert!(thread_is_free(&pool, first).await);
    assert!(thread_is_free(&pool, second).await);
}

#[sqlx::test(migrations = false)]
async fn each_lease_of_a_thread_carries_a_later_version(pool: PgPool) {
    let leases = leases(&pool);
    let thread = Uuid::now_v7();

    let first = leases
        .lease(&[thread], LeasePool::Live, EmailWriter::Live)
        .await
        .unwrap();
    let first_version = first.version;
    drop(first.lease);
    let second = leases
        .lease(&[thread], LeasePool::Bulk, EmailWriter::Bulk)
        .await
        .unwrap();

    assert!(second.version > first_version);
}

/// Two writers leasing the same threads in opposite orders wait for each
/// other and never deadlock: the locks are always taken in key order.
#[sqlx::test(migrations = false)]
async fn overlapping_batches_leased_in_opposite_orders_both_complete(pool: PgPool) {
    let leases = Arc::new(leases(&pool));
    let threads: Vec<Uuid> = (0..8).map(|_| Uuid::now_v7()).collect();
    let reversed: Vec<Uuid> = threads.iter().rev().copied().collect();

    for _ in 0..20 {
        let take = |threads: Vec<Uuid>| {
            let leases = leases.clone();
            tokio::spawn(async move {
                let granted = leases
                    .lease(&threads, LeasePool::Bulk, EmailWriter::Bulk)
                    .await?;
                drop(granted.lease);
                Ok::<_, Report>(())
            })
        };
        let (forward, backward) = tokio::join!(take(threads.clone()), take(reversed.clone()));
        forward.unwrap().unwrap();
        backward.unwrap().unwrap();
    }
}

/// The lease's locks are taken in key order only because Postgres plans the
/// statement as a nested loop over the sorted keys, calling the lock once per
/// key; no documented rule promises it. This keeps that plan from changing
/// unnoticed. The statement is the lease's, behind `EXPLAIN`.
#[sqlx::test(migrations = false)]
async fn the_lease_statement_locks_one_sorted_key_at_a_time(pool: PgPool) {
    let threads: Vec<Uuid> = (0..50).map(|_| Uuid::now_v7()).collect();

    let plan = sqlx::query_scalar!(
        r#"
        EXPLAIN (COSTS OFF)
        SELECT max(granted_at) AS "granted_at!"
        FROM (
            SELECT clock_timestamp() AS granted_at
            FROM (
                SELECT DISTINCT hashtextextended('email-thread-search:' || thread_id::text, 0) AS lock_key
                FROM unnest($1::uuid[]) AS thread_id
                ORDER BY lock_key
            ) AS keys,
            LATERAL pg_advisory_xact_lock(keys.lock_key)
        ) AS granted
        "#,
        &threads,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    let nodes: Vec<&str> = plan
        .iter()
        .flatten()
        .map(|line| line.trim_start_matches([' ', '-', '>']).trim())
        .collect();
    assert_eq!(
        nodes,
        [
            "Aggregate",
            "Nested Loop",
            "Unique",
            "Sort",
            "Sort Key: (hashtextextended(('email-thread-search:'::text || (thread_id.thread_id)::text), '0'::bigint))",
            "Function Scan on unnest thread_id",
            "Function Scan on pg_advisory_xact_lock",
        ],
        "{plan:#?}"
    );
}
