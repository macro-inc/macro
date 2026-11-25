use std::{net::SocketAddr, sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::watch,
};

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
    leases.release(granted.lease).await;
    assert!(thread_is_free(&pool, first).await);
    assert!(thread_is_free(&pool, second).await);
}

/// Waits on the server, up to `lock_timeout`, until no session holds the
/// thread's lock.
async fn wait_until_thread_is_free(pool: &PgPool, thread_id: Uuid) {
    let mut probe = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL lock_timeout = '10s'")
        .execute(&mut *probe)
        .await
        .unwrap();
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('email-thread-search:' || $1::uuid::text, 0))",
        thread_id,
    )
    .execute(&mut *probe)
    .await
    .unwrap();
}

/// A lease dropped without its release, as one whose rollback timed out is,
/// closes its connection, and the server releases its locks with the session.
#[sqlx::test(migrations = false)]
async fn a_lease_dropped_unreleased_closes_its_connection_and_frees_its_threads(pool: PgPool) {
    let leases = leases(&pool);
    let thread = Uuid::now_v7();
    let granted = leases
        .lease(&[thread], LeasePool::Live, EmailWriter::Live)
        .await
        .unwrap();
    assert!(!thread_is_free(&pool, thread).await);

    drop(granted);

    wait_until_thread_is_free(&pool, thread).await;
}

/// A TCP relay to `upstream` that stops relaying while `frozen` is set, as a
/// connection that stops answering does, and closes both sides when either
/// side closes.
async fn relay(upstream: SocketAddr, frozen: watch::Receiver<bool>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (client, _) = listener.accept().await.unwrap();
            let server = TcpStream::connect(upstream).await.unwrap();
            tokio::spawn(relay_connection(client, server, frozen.clone()));
        }
    });
    address
}

async fn relay_connection(client: TcpStream, server: TcpStream, mut frozen: watch::Receiver<bool>) {
    let (mut client_read, mut client_write) = client.into_split();
    let (mut server_read, mut server_write) = server.into_split();
    let (mut up, mut down) = ([0_u8; 8192], [0_u8; 8192]);
    // The freeze is read again before each forward: a read that was already
    // waiting when the freeze came is dropped, not passed on.
    loop {
        let relaying = !*frozen.borrow();
        tokio::select! {
            read = client_read.read(&mut up) => {
                let Ok(read @ 1..) = read else { return };
                if !*frozen.borrow() && server_write.write_all(&up[..read]).await.is_err() {
                    return;
                }
            }
            read = server_read.read(&mut down), if relaying => {
                let Ok(read @ 1..) = read else { return };
                if !*frozen.borrow() && client_write.write_all(&down[..read]).await.is_err() {
                    return;
                }
            }
            Ok(()) = frozen.changed() => {}
        }
    }
}

/// A release whose connection stops answering gives up on the rollback and
/// closes the connection, so the server ends the session and frees the
/// threads; a rollback left queued would wait on the connection forever.
#[sqlx::test(migrations = false)]
async fn a_release_on_a_connection_that_stops_answering_still_frees_its_threads(pool: PgPool) {
    let options = (*pool.connect_options()).clone();
    let upstream = tokio::net::lookup_host((options.get_host(), options.get_port()))
        .await
        .unwrap()
        .next()
        .unwrap();
    let (freeze, frozen) = watch::channel(false);
    let relayed = relay(upstream, frozen).await;
    let mut leases = PgEmailThreadLeases::new(
        options.host(&relayed.ip().to_string()).port(relayed.port()),
        2,
    );
    leases.release_timeout = Duration::from_millis(200);
    let thread = Uuid::now_v7();
    let granted = leases
        .lease(&[thread], LeasePool::Live, EmailWriter::Live)
        .await
        .unwrap();
    assert!(!thread_is_free(&pool, thread).await);

    freeze.send_replace(true);
    leases.release(granted.lease).await;

    wait_until_thread_is_free(&pool, thread).await;
}

/// A lease asked of a database that stops answering fails within its bound,
/// so the writer retries instead of holding its lane.
#[sqlx::test(migrations = false)]
async fn a_lease_from_a_database_that_stops_answering_fails_in_time(pool: PgPool) {
    let options = (*pool.connect_options()).clone();
    let upstream = tokio::net::lookup_host((options.get_host(), options.get_port()))
        .await
        .unwrap()
        .next()
        .unwrap();
    let (freeze, frozen) = watch::channel(false);
    let relayed = relay(upstream, frozen).await;
    let mut leases = PgEmailThreadLeases::new(
        options.host(&relayed.ip().to_string()).port(relayed.port()),
        2,
    );
    leases.grant_timeout = Duration::from_millis(200);
    let thread = Uuid::now_v7();
    let first = leases
        .lease(&[thread], LeasePool::Live, EmailWriter::Live)
        .await
        .unwrap();
    leases.release(first.lease).await;

    freeze.send_replace(true);
    let second = tokio::time::timeout(
        Duration::from_secs(5),
        leases.lease(&[thread], LeasePool::Live, EmailWriter::Live),
    )
    .await
    .expect("the lease gave up within its bound");

    assert!(second.is_err());
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
    leases.release(first.lease).await;
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
                leases.release(granted.lease).await;
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
