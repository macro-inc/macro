//! SIGKILL the actual worker binary, not an in-process future or mock importer.
//! PostgreSQL triggers in this isolated database make the kill boundaries exact.

use std::process::{Child, Stdio};

use sqlx::ConnectOptions;

use super::*;

pub(super) struct ProcessConfig {
    pub endpoint: String,
    pub bucket: String,
    pub main: String,
    pub dlq: String,
}

struct WorkerProcess(Child);

impl WorkerProcess {
    fn start(config: &ProcessConfig, pool: &PgPool, boundary: &str, search_url: &str) -> Self {
        let mut database = pool.connect_options().to_url_lossy();
        database
            .query_pairs_mut()
            .append_pair("application_name", boundary);
        Self(
            Command::new(env!("CARGO_BIN_EXE_slack_import_worker"))
                .env_clear()
                .env("DATABASE_URL", database.as_str())
                .env("LOCAL_AWS_URL", &config.endpoint)
                .env("UPLOAD_STAGING_BUCKET", &config.bucket)
                .env("OVERRIDE_SLACK_IMPORT_QUEUE", &config.main)
                .env("OVERRIDE_SLACK_IMPORT_DLQ", &config.dlq)
                .env("OVERRIDE_SEARCH_PROCESSING_SERVICE_URL", search_url)
                .env("INTERNAL_API_KEY", "isolated-process-test")
                .env("SLACK_IMPORT_ENABLED", "true")
                .env("SLACK_IMPORT_CONCURRENCY", "1")
                .env("RUST_LOG", "off")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap(),
        )
    }

    fn kill(&mut self) {
        self.0.kill().unwrap();
        let status = self.0.wait().unwrap();
        assert!(
            !status.success(),
            "fault injection must terminate the process"
        );
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            assert_eq!(
                status.signal(),
                Some(9),
                "recovery must not depend on graceful shutdown"
            );
        }
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn recover(pool: PgPool, boundary: &str) {
    let (_container, endpoint) = LocalStack::start().await;
    let Resources {
        storage,
        queue,
        process: config,
        ..
    } = resources(&endpoint).await;
    let team = team(&pool).await;
    let limits = ImportLimits::default();
    let repo = PgSlackImportRepo::new(pool.clone(), limits);
    let authorizer = WorkerAuthorizer::new(
        pool.clone(),
        Access::new(PgAccessRepository::new(pool.clone())),
    );
    let service = SlackImportService::new(
        repo.clone(),
        storage,
        CanonicalImportLedger::new(PgImportRepo::new(pool.clone())),
        NoGateway,
        Admin(authorizer),
        |_| true,
        limits,
    )
    .unwrap();
    let job = upload_job(&service, team, true).await;
    let events = repo.pending_events(50).await.unwrap();
    sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
    // DDL is test-local and depends on the runtime SQLx database, not a migration.
    sqlx::raw_sql(include_str!("kill_boundaries.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let mut barrier = pool.acquire().await.unwrap();
    sqlx::query!("SELECT pg_advisory_lock(27001)")
        .execute(&mut *barrier)
        .await
        .unwrap();
    // Reserve an unused local port so search cannot accidentally hit a real service.
    // Completion is verified below through the explicitly controlled receipt gate.
    let search_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let search_url = format!("http://{}", search_listener.local_addr().unwrap());
    let mut process = WorkerProcess::start(&config, &pool, boundary, &search_url);
    timeout(Duration::from_secs(60), async {
        loop {
            assert!(process.0.try_wait().unwrap().is_none(), "worker exited before fault");
            let waiting = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event = 'advisory')",
                boundary
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting == Some(true) {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("worker did not reach the durable kill boundary");

    // Receipts take a shared job lock. Kill first so the deliberately blocked
    // transaction rolls back; otherwise reading a receipt would deadlock here.
    process.kill();
    // PostgreSQL may still be waiting on our advisory lock after socket closure.
    // Release it so the dead connection's transaction can unwind before reading.
    sqlx::query!("SELECT pg_advisory_unlock(27001)")
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    drop(barrier);
    let before = progress(&repo, team, job).await;
    let message_ids = sqlx::query_scalar!("SELECT id FROM comms_messages ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    match boundary {
        "kill-after-lease" => {
            assert!(
                before
                    .conversations
                    .iter()
                    .any(|c| c.status == ConversationStatus::Importing)
            );
            assert!(message_ids.is_empty());
        }
        "kill-after-batch" => {
            assert_eq!(message_ids.len(), 2);
            assert_eq!(
                before
                    .conversations
                    .iter()
                    .map(|c| c.counters.imported)
                    .sum::<u64>(),
                2
            );
        }
        "kill-after-publication" => {
            // A blocked published_at UPDATE is after SQS accepted the send. The
            // transaction is still uncommitted, so the outbox must survive death.
            assert_eq!(sqlx::query_scalar!(
                "SELECT count(*) FROM slack_import_outbox WHERE job_id = $1 AND kind = 'import' AND published_at IS NULL",
                Uuid::from(job)
            ).fetch_one(&pool).await.unwrap(), Some(2));
        }
        _ => unreachable!(),
    }
    // Advance only this test job's durable deadlines; no hosted leases are touched.
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1 AND status = 'importing'", Uuid::from(job)).execute(&pool).await.unwrap();
    sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
    // Duplicate delivery after a lost worker is legal. It avoids waiting the full
    // production SQS visibility timeout while still exercising fenced reclamation.
    for event in &events {
        queue.publish(event).await.unwrap();
    }
    let mut restarted = WorkerProcess::start(&config, &pool, "restarted-worker", &search_url);
    timeout(Duration::from_secs(60), async {
        loop {
            assert!(
                restarted.0.try_wait().unwrap().is_none(),
                "restarted worker exited"
            );
            if progress(&repo, team, job)
                .await
                .conversations
                .iter()
                .all(|c| c.status == ConversationStatus::Completed)
            {
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("restarted worker did not recover committed history");
    restarted.kill();
    let final_ids = sqlx::query_scalar!("SELECT id FROM comms_messages ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(final_ids.len(), 4);
    assert!(
        message_ids.iter().all(|id| final_ids.contains(id)),
        "committed UUIDs must survive replay"
    );
    let receipt = progress(&repo, team, job).await;
    assert_eq!(
        receipt
            .conversations
            .iter()
            .map(|c| c.counters.imported)
            .sum::<u64>(),
        4
    );
    assert_ne!(
        receipt.status,
        JobStatus::Completed,
        "unpublished search cannot complete a job"
    );
    let search = SearchGate::default();
    search.0.store(true, Ordering::SeqCst);
    let maintenance = ImportMaintenance::new(
        repo.clone(),
        queue,
        search,
        SystemClock,
        WorkerReferenceReconciler::new(pool.clone(), limits),
    );
    // First reconciliation submits; a second due poll observes publication.
    for _ in 0..2 {
        sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
        maintenance.reconcile().await.unwrap();
    }
    assert_eq!(
        progress(&repo, team, job).await.status,
        JobStatus::Completed
    );
}

#[ignore = "requires local PostgreSQL and preloaded localstack/localstack:4"]
#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn process_death_after_lease(pool: PgPool) {
    recover(pool, "kill-after-lease").await;
}

#[ignore = "requires local PostgreSQL and preloaded localstack/localstack:4"]
#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn process_death_after_committed_batch(pool: PgPool) {
    recover(pool, "kill-after-batch").await;
}

#[ignore = "requires local PostgreSQL and preloaded localstack/localstack:4"]
#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn process_death_after_queue_publication(pool: PgPool) {
    recover(pool, "kill-after-publication").await;
}
