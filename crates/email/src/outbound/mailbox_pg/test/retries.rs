//! What a message that keeps failing costs, when it stops, and what brings
//! it back.

use super::{fixture, snapshot};
use crate::domain::mailbox::progress::MailboxProgressRepository;
use crate::domain::mailbox::*;
use crate::outbound::mailbox_pg::PgMailboxSync;
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::{
    Attention, EmailApiError, GateLimit, MailFolder, MailboxChangePage, MailboxMessage,
    MailboxState, ProviderId, RateLimitOrigin, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

/// Answers message reads and folder pages in order.
#[derive(Default)]
struct Provider {
    messages: Mutex<VecDeque<Result<Option<MailboxMessage>, EmailApiError>>>,
    pages: Mutex<VecDeque<MailboxChangePage>>,
}

impl Provider {
    fn answering(messages: Vec<Result<Option<MailboxMessage>, EmailApiError>>) -> Self {
        Self {
            messages: Mutex::new(messages.into()),
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
        Ok(self.pages.lock().unwrap().pop_front().unwrap())
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        self.messages.lock().unwrap().pop_front().unwrap()
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

fn sync(
    repo: &PgMailboxSync,
    provider: Provider,
) -> MailboxSyncService<PgMailboxSync, Provider, PgMailboxSync> {
    MailboxSyncService::new(repo.clone(), provider, repo.clone())
}

/// `attempts` is what the row had before its next claim adds one.
async fn queue(db: &PgPool, link: Uuid, provider_id: &str, attempts: i32) {
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,attempts) VALUES ($1,1,$2,true,$3)",
        link,
        provider_id,
        attempts
    )
    .execute(db)
    .await
    .unwrap();
}

struct Row {
    attempts: i32,
    abandoned: bool,
    delay_seconds: i64,
}

async fn row(db: &PgPool, link: Uuid, provider_id: &str) -> Row {
    let row = sqlx::query!(
        r#"SELECT attempts,
            available_at = 'infinity' AS "abandoned!",
            CASE WHEN available_at = 'infinity' THEN 0
                ELSE ceil(EXTRACT(EPOCH FROM available_at - now()))::bigint END AS "delay_seconds!"
        FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = $2"#,
        link,
        provider_id
    )
    .fetch_one(db)
    .await
    .unwrap();
    Row {
        attempts: row.attempts,
        abandoned: row.abandoned,
        delay_seconds: row.delay_seconds,
    }
}

fn outcomes(telemetry: &Telemetry) -> Vec<(String, String, Option<String>)> {
    telemetry
        .spans("outlook.sync.reconcile")
        .into_iter()
        .map(|span| {
            (
                span["outlook.outcome"].clone(),
                span["outlook.defer_reason"].clone(),
                span.get("outlook.defer_seconds").cloned(),
            )
        })
        .collect()
}

fn permanent() -> EmailApiError {
    EmailApiError::Permanent {
        message: "invalid Microsoft Graph response: unexpected value at conversationId".into(),
    }
}

fn invitation(link: Uuid, provider_id: &str) -> MailboxMessage {
    let state = MailboxState {
        in_inbox: true,
        attention: Attention::Primary,
        ..Default::default()
    };
    MailboxMessage {
        calendar_parts_unavailable: true,
        ..snapshot(link, provider_id, state, "v1")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_refused_outright_stops_after_three_attempts_until_it_changes(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    queue(&db, link, "malformed", 2).await;
    let service = sync(&repo, Provider::answering(vec![Err(permanent())]));

    assert!(service.reconcile_once().await.is_err());

    let abandoned = row(&db, link, "malformed").await;
    assert!(
        abandoned.abandoned,
        "the third refusal abandons the message"
    );
    assert_eq!(abandoned.attempts, 0);
    assert!(
        repo.claim_message(Uuid::now_v7()).await.unwrap().is_none(),
        "an abandoned message is not claimed again"
    );
    assert_eq!(
        outcomes(&telemetry),
        [("abandoned".into(), "permanent".into(), None)]
    );
    let events = telemetry.events("mailbox message abandoned");
    let [(level, fields)] = events.as_slice() else {
        panic!("expected one abandonment, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::WARN);
    assert_eq!(fields["link_id"], link.to_string());
    assert_eq!(fields["attempts"], "3");
    assert_eq!(fields["defer_reason"], "permanent");

    let backlog = repo
        .backlogs()
        .await
        .unwrap()
        .into_iter()
        .find(|backlog| backlog.link_id == link)
        .unwrap();
    assert_eq!(
        (
            backlog.abandoned,
            backlog.queued,
            backlog.parked,
            backlog.parked_until_max_seconds
        ),
        (1, 0, 0, 0)
    );

    // A new change from the provider queues it again with fresh attempts.
    let stream = repo.claim_stream(Uuid::now_v7()).await.unwrap().unwrap();
    repo.commit_page(
        &stream,
        &MailboxChangePage {
            changed: vec![ProviderId::new("malformed").unwrap()],
            removed: Vec::new(),
            position: StreamPosition::Checkpoint(StreamToken::new("next".into())),
            reader_revision: 1,
        },
    )
    .await
    .unwrap();
    let revived = repo.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(revived.provider_id.as_str(), "malformed");
    assert_eq!(revived.attempts, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_forbidden_message_fails_on_its_own_instead_of_asking_for_reauth(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    queue(&db, link, "denied", 0).await;
    let service = sync(
        &repo,
        Provider::answering(vec![
            Err(EmailApiError::Forbidden),
            Err(EmailApiError::Forbidden),
        ]),
    );

    assert!(service.reconcile_once().await.is_err());
    sqlx::query!(
        "UPDATE email_message_reconciliation SET attempts = 2, available_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.reconcile_once().await.is_err());

    assert_eq!(
        outcomes(&telemetry),
        [
            ("deferred".into(), "forbidden".into(), Some("600".into())),
            ("abandoned".into(), "forbidden".into(), None),
        ]
    );
    assert!(row(&db, link, "denied").await.abandoned);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_that_keeps_failing_backs_off_and_stops_after_a_day(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    queue(&db, link, "flaky", 3).await;
    let transient = || EmailApiError::Transient {
        message: "Microsoft Graph returned HTTP 500".into(),
    };
    let service = sync(
        &repo,
        Provider::answering(vec![Err(transient()), Err(transient())]),
    );

    assert!(service.reconcile_once().await.is_err());
    let flaky = row(&db, link, "flaky").await;
    assert_eq!((flaky.abandoned, flaky.attempts), (false, 4));
    assert!(
        (239..=240).contains(&flaky.delay_seconds),
        "the fourth failure waits 240 s, got {}",
        flaky.delay_seconds
    );

    sqlx::query!(
        "UPDATE email_message_reconciliation SET attempts = 49, available_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.reconcile_once().await.is_err());
    assert!(row(&db, link, "flaky").await.abandoned);
    assert_eq!(
        outcomes(&telemetry),
        [
            ("deferred".into(), "other".into(), Some("240".into())),
            ("abandoned".into(), "other".into(), None),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_wide_refusals_do_not_bring_a_message_closer_to_abandonment(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    queue(&db, link, "throttled", 49).await;
    let service = sync(
        &repo,
        Provider::answering(vec![Err(EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(12)),
            origin: RateLimitOrigin::Gate(GateLimit::Window),
        })]),
    );

    assert!(service.reconcile_once().await.is_err());

    let throttled = row(&db, link, "throttled").await;
    assert_eq!((throttled.abandoned, throttled.attempts), (false, 49));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_abandoned_import_message_does_not_hold_the_import_open(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true, attachments_rechecked = true WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at) VALUES ($1,$2,1,'folder_catalog','mail',true,now() + interval '1 hour')",
        Uuid::now_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    queue(&db, link, "malformed", 2).await;
    let provider = Provider::answering(vec![Err(permanent())]);
    provider.pages.lock().unwrap().push_back(MailboxChangePage {
        changed: Vec::new(),
        removed: Vec::new(),
        position: StreamPosition::Checkpoint(StreamToken::new("next".into())),
        reader_revision: 1,
    });
    let service = sync(&repo, provider);

    assert!(service.reconcile_once().await.is_err());
    // The folder's next delta poll settles the import.
    assert!(service.enumerate_once().await.unwrap());

    assert_eq!(telemetry.events("outlook import completed").len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_invitation_waits_for_its_calendar_parts_then_imports_without_them(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    queue(&db, link, "invite", 0).await;
    let service = sync(
        &repo,
        Provider::answering(vec![
            Ok(Some(invitation(link, "invite"))),
            Ok(Some(invitation(link, "invite"))),
        ]),
    );

    assert!(service.reconcile_once().await.is_err());
    sqlx::query!(
        "UPDATE email_message_reconciliation SET attempts = 2, available_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.reconcile_once().await.unwrap());

    let spans = telemetry.spans("outlook.sync.reconcile");
    assert_eq!(spans[0]["outlook.outcome"], "deferred");
    assert_eq!(spans[0]["outlook.defer_reason"], "calendar_parts");
    assert_eq!(spans[0]["outlook.defer_seconds"], "30");
    assert_eq!(spans[1]["outlook.outcome"], "imported");
    assert_eq!(spans[1]["outlook.calendar_parts_unavailable"], "true");
    assert_eq!(
        telemetry
            .events("outlook invitation imported without calendar parts")
            .len(),
        1
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "stored!" FROM email_messages WHERE link_id = $1 AND provider_id = 'invite'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(stored, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_claims_skip_a_mailbox_that_needs_reauth_until_it_is_cleared(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'folder_catalog','mail')",
        Uuid::now_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    queue(&db, link, "waiting", 0).await;
    let set_reauth = |needs_reauth: bool| {
        sqlx::query!(
            "UPDATE email_links SET needs_reauth = $2 WHERE id = $1",
            link,
            needs_reauth
        )
        .execute(&db)
    };

    set_reauth(true).await.unwrap();
    assert!(repo.claim_catalog(Uuid::now_v7()).await.unwrap().is_none());
    assert!(repo.claim_stream(Uuid::now_v7()).await.unwrap().is_none());
    assert!(repo.claim_message(Uuid::now_v7()).await.unwrap().is_none());

    set_reauth(false).await.unwrap();
    assert!(repo.claim_catalog(Uuid::now_v7()).await.unwrap().is_some());
    assert!(repo.claim_stream(Uuid::now_v7()).await.unwrap().is_some());
    assert!(repo.claim_message(Uuid::now_v7()).await.unwrap().is_some());
}
