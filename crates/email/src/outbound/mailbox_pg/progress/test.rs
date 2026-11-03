use super::*;
use crate::domain::mailbox::progress::MailboxProgressService;
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::{
    EmailApiError, GateLimit, MailboxMessage, RateLimitOrigin, StreamPosition,
};
use email_api_client::domain::request_count;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

/// Provider double: answers message reads in order, sending `requests` Graph
/// requests for each, and reports a fixed admitted-request count.
#[derive(Default)]
struct Provider {
    messages: Mutex<VecDeque<Result<Option<MailboxMessage>, EmailApiError>>>,
    pages: Mutex<VecDeque<Result<MailboxChangePage, EmailApiError>>>,
    requests: u32,
}

impl Provider {
    fn answering(messages: Vec<Result<Option<MailboxMessage>, EmailApiError>>) -> Self {
        Self {
            messages: Mutex::new(messages.into()),
            requests: 2,
            ..Self::default()
        }
    }
}

impl MailboxGateway for Provider {
    async fn folders(&self, _: MailboxKey) -> Result<Vec<MailFolder>, EmailApiError> {
        Ok(Vec::new())
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.pages.lock().unwrap().pop_front().unwrap()
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        for _ in 0..self.requests {
            request_count::record_sent();
        }
        self.messages.lock().unwrap().pop_front().unwrap()
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        Some(42)
    }
}

fn sync(
    repo: &PgMailboxSync,
    provider: Provider,
) -> MailboxSyncService<PgMailboxSync, Provider, PgMailboxSync> {
    MailboxSyncService::new(repo.clone(), provider, repo.clone())
}

/// `attempts` is what the row had before its next claim adds one.
async fn queue(db: &PgPool, link: Uuid, provider_id: &str, is_import: bool, attempts: i32) {
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,attempts) VALUES ($1,1,$2,$3,$4)",
        link,
        provider_id,
        is_import,
        attempts
    )
    .execute(db)
    .await
    .unwrap();
}

/// A mailbox whose only folder and catalog finished enumerating.
async fn enumerated_mailbox(db: &PgPool) -> (PgMailboxSync, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true, attachments_rechecked = true WHERE link_id = $1",
        link
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete) VALUES ($1,$2,1,'folder_catalog','mail',true)",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    (repo, link)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn import_completes_once_when_its_last_import_row_settles(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = enumerated_mailbox(&db).await;
    queue(&db, link, "first", true, 2).await;
    queue(&db, link, "second", true, 2).await;
    let service = sync(
        &repo,
        Provider::answering(vec![Ok(None), Ok(None), Ok(None)]),
    );

    assert!(service.reconcile_once().await.unwrap());
    assert!(telemetry.events("outlook import completed").is_empty());
    assert!(service.reconcile_once().await.unwrap());
    // A live change after the import must not report it again.
    queue(&db, link, "live", false, 2).await;
    assert!(service.reconcile_once().await.unwrap());

    let completed = telemetry.events("outlook import completed");
    let [(level, fields)] = completed.as_slice() else {
        panic!("expected one completion, got {completed:?}");
    };
    assert_eq!(*level, tracing::Level::INFO);
    assert_eq!(fields["link_id"], link.to_string());
    assert_eq!(fields["sync_generation"], "1");
    assert_eq!(fields["folders"], "1");
    assert_eq!(fields["messages"], "0");
    assert_eq!(fields["graph_calls"], "42");
    assert!(fields.contains_key("duration_seconds"));
    let reconciled = telemetry.spans("outlook.sync.reconcile");
    assert_eq!(reconciled.len(), 3);
    assert!(
        reconciled
            .iter()
            .all(|span| span["outlook.outcome"] == "absent")
    );
    assert_eq!(reconciled[0]["outlook.is_import"], "true");
    assert_eq!(reconciled[0]["outlook.attempts"], "3");
    assert_eq!(reconciled[0]["outlook.graph_calls"], "2");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn workers_finishing_the_last_rows_together_report_one_completion(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = enumerated_mailbox(&db).await;
    queue(&db, link, "first", true, 2).await;
    queue(&db, link, "second", true, 2).await;
    let first = sync(&repo, Provider::answering(vec![Ok(None)]));
    let second = sync(&repo, Provider::answering(vec![Ok(None)]));

    let (a, b) = tokio::join!(first.reconcile_once(), second.reconcile_once());

    assert!(a.unwrap() && b.unwrap());
    assert_eq!(telemetry.events("outlook import completed").len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deferrals_name_their_reason_and_gate_refusals_stay_quiet(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = super::super::test::fixture(&db).await;
    for (id, attempts) in [("window", 0), ("graph", 0), ("token", 0), ("moving", 0)] {
        queue(&db, link, id, true, attempts).await;
    }
    let service = sync(
        &repo,
        Provider::answering(vec![
            Err(EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(12)),
                origin: RateLimitOrigin::Gate(GateLimit::Window),
            }),
            Err(EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(7)),
                origin: RateLimitOrigin::Provider { concurrency: false },
            }),
            Err(EmailApiError::CredentialsUnavailable {
                message: "authentication unavailable".into(),
            }),
            Ok(None),
        ]),
    );

    for _ in 0..4 {
        assert!(service.reconcile_once().await.is_err());
    }

    let spans = telemetry.spans("outlook.sync.reconcile");
    let reasons: Vec<_> = spans
        .iter()
        .map(|span| {
            (
                span["outlook.outcome"].as_str(),
                span["outlook.defer_reason"].as_str(),
                span["outlook.defer_seconds"].as_str(),
            )
        })
        .collect();
    assert_eq!(
        reasons,
        [
            ("deferred", "gate_window", "12"),
            ("deferred", "graph_throttled", "7"),
            ("deferred", "token_unavailable", "30"),
            ("deferred", "location_unsettled", "30"),
        ]
    );
    assert!(
        spans
            .iter()
            .all(|span| !span.contains_key("otel.status_description"))
    );
    let deferrals = telemetry.events("mailbox sync work deferred");
    let levels: Vec<_> = deferrals
        .iter()
        .map(|(level, fields)| {
            (
                *level,
                fields["defer_reason"].as_str(),
                fields["link_id"].clone(),
            )
        })
        .collect();
    assert_eq!(
        levels,
        [
            (tracing::Level::DEBUG, "gate_window", link.to_string()),
            (tracing::Level::WARN, "graph_throttled", link.to_string()),
            (tracing::Level::WARN, "token_unavailable", link.to_string()),
            (tracing::Level::WARN, "location_unsettled", link.to_string()),
        ]
    );
    let parked = sqlx::query_scalar!(
        r#"SELECT count(*) AS "parked!" FROM email_message_reconciliation WHERE link_id = $1 AND available_at > now() + interval '10 seconds'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        parked, 3,
        "the window refusal and both 30-second deferrals are parked"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enumeration_reports_the_page_it_committed(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = super::super::test::fixture(&db).await;
    let provider = Provider::default();
    provider
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(super::super::test::page()));
    let service = sync(&repo, provider);

    assert!(service.enumerate_once().await.unwrap());

    let spans = telemetry.spans("outlook.sync.enumerate");
    let [span] = spans.as_slice() else {
        panic!("expected one enumerate span, got {spans:?}");
    };
    assert_eq!(span["mailbox.link_id"], link.to_string());
    assert_eq!(span["outlook.stream_kind"], "mail_folder");
    assert_eq!(span["outlook.outcome"], "imported");
    assert_eq!(span["outlook.page_items"], "4");
    assert_eq!(span["outlook.rows_queued"], "3");
    assert_eq!(span["outlook.delta_advanced"], "true");
    assert_eq!(span["outlook.folder_initial_complete"], "true");
    assert!(matches!(
        super::super::test::page().position,
        StreamPosition::Checkpoint(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn persistence_errors_name_their_sqlstate(db: PgPool) {
    let failure = sqlx::query_scalar!(r#"SELECT 1 / $1::int AS "quotient""#, 0)
        .fetch_one(&db)
        .await
        .unwrap_err();

    let error = super::super::db_error(failure);

    assert_eq!(
        error.to_string(),
        "mailbox persistence is unavailable: sqlstate 22012"
    );
    assert_eq!(
        crate::domain::mailbox::telemetry::defer_reason(&error),
        "persistence"
    );
    // Projection effects that fail outside the database are reported apart.
    assert_eq!(
        crate::domain::mailbox::telemetry::defer_reason(&MailboxError::Effect),
        "effect"
    );
}

async fn outlook_link(db: &PgPool, email: &str, active: bool, needs_reauth: bool) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation,is_sync_active,needs_reauth)
        VALUES ($1,$2,$3,$4,'OUTLOOK',1,$5,$6)"#,
        link,
        format!("macro|{email}"),
        format!("owner-{email}"),
        email,
        active,
        needs_reauth
    )
    .execute(db)
    .await
    .unwrap();
    link
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn health_snapshot_counts_the_current_queue_streams_and_recent_imports(db: PgPool) {
    let (repo, active) = super::super::test::fixture(&db).await;
    sqlx::query!(
        r#"INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,available_at,lease_id,lease_until) VALUES
            ($1,1,'due',true,now() - interval '90 seconds',NULL,NULL),
            ($1,1,'parked',true,now() + interval '600 seconds',NULL,NULL),
            ($1,1,'leased',true,now() - interval '10 seconds',$2,now() + interval '60 seconds'),
            ($1,0,'old generation',true,now() - interval '1 hour',NULL,NULL)"#,
        active,
        macro_uuid::generate_uuid_v7()
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_import_minutes (link_id,minute,imported,last_imported_at) VALUES
            ($1,date_trunc('minute',now() - interval '2 minutes'),5,now() - interval '100 seconds'),
            ($1,date_trunc('minute',now() - interval '10 minutes'),7,now() - interval '10 minutes'),
            ($1,date_trunc('minute',now() - interval '2 days'),9,now() - interval '2 days')"#,
        active
    )
    .execute(&db)
    .await
    .unwrap();
    let paused = outlook_link(&db, "paused@example.com", false, true).await;
    queue(&db, paused, "waiting", true, 0).await;
    outlook_link(&db, "idle@example.com", false, false).await;
    sqlx::query!(
        "INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,'macro|gmail@example.com','gmail-owner','gmail@example.com','GMAIL')",
        macro_uuid::generate_uuid_v7()
    )
    .execute(&db)
    .await
    .unwrap();

    let backlogs = repo.backlogs().await.unwrap();

    assert_eq!(backlogs.len(), 2, "{backlogs:?}");
    let active_backlog = backlogs.iter().find(|b| b.link_id == active).unwrap();
    assert_eq!(
        (
            active_backlog.queued,
            active_backlog.parked,
            active_backlog.leased,
            active_backlog.streams_incomplete,
            active_backlog.imported_5m,
            active_backlog.sync_active,
            active_backlog.needs_reauth,
        ),
        (3, 1, 1, 1, 5, true, false)
    );
    assert!((90..=92).contains(&active_backlog.oldest_waiting_seconds));
    assert!((598..=600).contains(&active_backlog.parked_until_max_seconds));
    assert!(matches!(
        active_backlog.seconds_since_last_import,
        Some(100..=102)
    ));
    let paused_backlog = backlogs.iter().find(|b| b.link_id == paused).unwrap();
    assert_eq!(
        (
            paused_backlog.queued,
            paused_backlog.parked,
            paused_backlog.oldest_waiting_seconds,
            paused_backlog.parked_until_max_seconds,
            paused_backlog.imported_5m,
            paused_backlog.seconds_since_last_import,
            paused_backlog.sync_active,
            paused_backlog.needs_reauth,
        ),
        (1, 0, 0, 0, 0, None, false, true)
    );
    let retained = sqlx::query_scalar!(
        r#"SELECT count(*) AS "rows!" FROM email_mailbox_import_minutes WHERE link_id = $1"#,
        active
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(retained, 2, "counts older than a day are dropped");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn import_counts_from_several_workers_add_up_in_the_snapshot(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = super::super::test::fixture(&db).await;
    let first = ImportTally::default();
    let second = ImportTally::default();
    for _ in 0..3 {
        first.record(link, chrono::Utc::now());
    }
    second.record(link, chrono::Utc::now());

    MailboxProgressService::new(repo.clone(), first)
        .flush()
        .await
        .unwrap();
    MailboxProgressService::new(repo.clone(), second.clone())
        .flush()
        .await
        .unwrap();
    // A flush with nothing new writes nothing.
    MailboxProgressService::new(repo.clone(), second)
        .flush()
        .await
        .unwrap();
    let reported = MailboxProgressService::new(repo.clone(), ImportTally::default())
        .report()
        .await
        .unwrap();

    assert_eq!(reported, 1);
    let snapshots = telemetry.events("outlook mailbox health");
    let [(level, fields)] = snapshots.as_slice() else {
        panic!("expected one snapshot, got {snapshots:?}");
    };
    assert_eq!(*level, tracing::Level::INFO);
    assert_eq!(fields["link_id"], link.to_string());
    assert_eq!(fields["imported_5m"], "4");
    assert_eq!(fields["queued"], "0");
    assert_eq!(fields["oldest_waiting_seconds"], "0");
    assert_eq!(fields["sync_active"], "true");
    assert!(fields.contains_key("seconds_since_last_import"));
}
