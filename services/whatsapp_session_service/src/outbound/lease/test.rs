//! Account ownership against a real Postgres: contention between replicas,
//! handover on release, and a lost lock connection.

use std::sync::Arc;
use std::time::{Duration, Instant};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;
use whatsapp_linked::domain::session::SessionService;
use whatsapp_linked::outbound::pg::PgWhatsAppRepository;

use super::{PgAccountDirectory, PgAccountLocks};
use crate::domain::ports::{
    AccountControl, AccountDirectory, AccountExit, AccountLocks, AccountRunner,
};
use crate::domain::supervisor::{Supervisor, SupervisorConfig, SupervisorError};
use crate::outbound::signals::{SIGNAL_CAPACITY, SignalListener};

const KEEPALIVE: Duration = Duration::from_millis(100);

async fn insert_account(pool: &PgPool, user_id: &str, state: &str) -> Uuid {
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), $2, $2, $3)
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, $2, new_macro_user.id FROM new_macro_user
        "#,
        user_id,
        format!("{user_id}@example.com"),
        format!("stripe_{user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    let account = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO whatsapp_linked_account (id, user_id, state) VALUES ($1, $2, $3)",
        account,
        user_id,
        state,
    )
    .execute(pool)
    .await
    .unwrap();
    account
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_one_replica_locks_an_account_and_discovery_skips_it(
    pool_options: PgPoolOptions,
    options: PgConnectOptions,
) {
    let pool = pool_options.connect_with(options.clone()).await.unwrap();
    let connected = insert_account(&pool, "macro|connected", "connected").await;
    let pairing = insert_account(&pool, "macro|pairing", "pairing").await;
    insert_account(&pool, "macro|logged-out", "logged_out").await;
    let tracker = TaskTracker::new();
    let first = PgAccountLocks::connect(&options, KEEPALIVE, &tracker)
        .await
        .unwrap();
    let second = PgAccountLocks::connect(&options, KEEPALIVE, &tracker)
        .await
        .unwrap();
    let directory = PgAccountDirectory::new(SessionService::new(Arc::new(
        PgWhatsAppRepository::new(pool.clone()),
    )));

    sqlx::query!(
        r#"INSERT INTO whatsapp_pairing (id, account_id, user_id, generation, state, expires_at)
        VALUES ($1, $2, 'macro|pairing', 1, 'waiting', now() + interval '5 minutes')"#,
        Uuid::now_v7(),
        pairing,
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_account(&pool, "macro|stale-pairing", "pairing").await;

    let mut candidates = directory.candidates(10).await.unwrap();
    candidates.sort();
    let mut expected = vec![connected, pairing];
    expected.sort();
    assert_eq!(
        candidates, expected,
        "logged-out accounts and pairings without a live transaction need no session"
    );

    assert!(first.try_lock(connected).await.unwrap());
    assert!(!second.try_lock(connected).await.unwrap());
    assert_eq!(directory.candidates(10).await.unwrap(), vec![pairing]);
    assert_eq!(directory.health().await.unwrap().accounts_unowned, 1);

    first.unlock(connected).await.unwrap();
    assert!(second.try_lock(connected).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn killing_the_lock_connection_frees_its_locks_and_reports_the_loss(
    pool_options: PgPoolOptions,
    options: PgConnectOptions,
) {
    let pool = pool_options.connect_with(options.clone()).await.unwrap();
    let account = insert_account(&pool, "macro|owner", "connected").await;
    let tracker = TaskTracker::new();
    let doomed = PgAccountLocks::connect(&options, KEEPALIVE, &tracker)
        .await
        .unwrap();
    let survivor = PgAccountLocks::connect(&options, KEEPALIVE, &tracker)
        .await
        .unwrap();
    assert!(doomed.try_lock(account).await.unwrap());

    let terminated = sqlx::query_scalar!(
        r#"SELECT pg_terminate_backend($1) AS "terminated!""#,
        doomed.backend_pid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(terminated);

    tokio::time::timeout(KEEPALIVE * 10, doomed.lost().cancelled())
        .await
        .expect("the next keepalive notices the dead connection");
    assert!(matches!(
        doomed.try_lock(account).await,
        Err(crate::domain::ports::LeaseError::Lost)
    ));
    assert!(survivor.try_lock(account).await.unwrap());
}

/// Reports which account it started, then runs until released or stopped.
struct ReportingRunner {
    started: mpsc::UnboundedSender<(Uuid, Instant)>,
}

impl AccountRunner for ReportingRunner {
    async fn run(&self, account: Uuid, control: AccountControl) -> AccountExit {
        self.started.send((account, Instant::now())).unwrap();
        tokio::select! {
            () = control.release.cancelled() => AccountExit::Released,
            () = control.stop.cancelled() => AccountExit::Stopped,
        }
    }
}

struct Replica {
    shutdown: CancellationToken,
    started: mpsc::UnboundedReceiver<(Uuid, Instant)>,
    running: tokio::task::JoinHandle<Result<(), SupervisorError>>,
}

async fn start_replica(
    pool: &PgPool,
    options: &PgConnectOptions,
    tracker: &TaskTracker,
) -> Replica {
    let locks = PgAccountLocks::connect(options, KEEPALIVE, tracker)
        .await
        .unwrap();
    let listener = SignalListener::connect(options).await.unwrap();
    let (signal_sender, mut signals) = mpsc::channel(SIGNAL_CAPACITY);
    let shutdown = CancellationToken::new();
    tracker.spawn(listener.run(signal_sender, shutdown.clone()));
    let (started_sender, started) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks,
        PgAccountDirectory::new(SessionService::new(Arc::new(PgWhatsAppRepository::new(
            pool.clone(),
        )))),
        Arc::new(ReportingRunner {
            started: started_sender,
        }),
        SupervisorConfig {
            max_accounts: 10,
            drain_batch: 10,
            // Long enough that only a signal can explain a fast handover.
            rescan_every: Duration::from_secs(600),
            release_timeout: Duration::from_secs(5),
            stop_timeout: Duration::from_secs(5),
            drain_deadline: Duration::from_secs(100),
            health_every: Duration::from_secs(600),
        },
    );
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut signals, stop).await });
    Replica {
        shutdown,
        started,
        running,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draining_replica_hands_its_account_over_without_waiting_for_a_rescan(
    pool_options: PgPoolOptions,
    options: PgConnectOptions,
) {
    let pool = pool_options.connect_with(options.clone()).await.unwrap();
    let account = insert_account(&pool, "macro|owner", "connected").await;
    let tracker = TaskTracker::new();
    let mut draining = start_replica(&pool, &options, &tracker).await;
    let (first_owner, _) = draining.started.recv().await.unwrap();
    assert_eq!(first_owner, account);
    let mut taking_over = start_replica(&pool, &options, &tracker).await;

    draining.shutdown.cancel();
    draining.running.await.unwrap().unwrap();

    // The next rescan is ten minutes away: only the release notification
    // can hand the account over within this bound.
    let (second_owner, _) =
        tokio::time::timeout(Duration::from_secs(30), taking_over.started.recv())
            .await
            .expect("the release notification hands the account over")
            .unwrap();
    assert_eq!(second_owner, account);

    taking_over.shutdown.cancel();
    taking_over.running.await.unwrap().unwrap();
}
