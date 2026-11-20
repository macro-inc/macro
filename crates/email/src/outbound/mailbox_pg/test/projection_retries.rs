//! When a projection event that keeps failing, or keeps ending unfinished,
//! is given up, and what is left of it.

use super::fixture;
use crate::domain::events::EmailMacroEvent;
use crate::domain::mailbox::projection::*;
use crate::domain::mailbox::{MailboxError, MailboxKey};
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;

/// Effects whose view refresh, the one effect a `link_changed` event runs,
/// fails with `error` every time.
struct FailingRefresh {
    error: fn() -> MailboxError,
    refreshes: Arc<AtomicUsize>,
}

impl FailingRefresh {
    fn new(error: fn() -> MailboxError) -> Self {
        Self {
            error,
            refreshes: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl MailboxProjectionEffects for FailingRefresh {
    async fn publish(&self, _: EmailMacroEvent) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn refresh(
        &self,
        _: Uuid,
        _: &HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
        Err((self.error)())
    }
    async fn notify(&self, _: MailboxNotification) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn contacts(&self, _: CorrespondenceProjection) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn attachments(
        &self,
        _: MailboxKey,
        _: &ProjectionContext,
        _: bool,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn invitations(
        &self,
        _: Uuid,
        _: &[crate::domain::models::calendar_invitation::CalendarInvitation],
    ) -> Result<(), MailboxError> {
        Ok(())
    }
}

fn downstream() -> MailboxError {
    MailboxError::Effect(crate::domain::mailbox::EffectFailure::Downstream)
}

/// Queues a `link_changed` event that has already been claimed `attempts` times.
async fn queue(db: &PgPool, link: Uuid, attempts: i32) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,attempts) VALUES ($1,$2,1,$3,$4)",
        id,
        link,
        serde_json::json!({"kind": "link_changed"}),
        attempts
    )
    .execute(db)
    .await
    .unwrap();
    id
}

/// The entry's claims so far, or `None` once it is gone.
async fn attempts(db: &PgPool, id: Uuid) -> Option<i32> {
    sqlx::query_scalar!(
        "SELECT attempts FROM email_projection_outbox WHERE id = $1",
        id
    )
    .fetch_optional(db)
    .await
    .unwrap()
}

/// Makes a deferred entry due again without waiting out its backoff.
async fn make_due(db: &PgPool, id: Uuid) {
    sqlx::query!(
        "UPDATE email_projection_outbox SET available_at = now() WHERE id = $1",
        id
    )
    .execute(db)
    .await
    .unwrap();
}

fn outcomes(telemetry: &Telemetry) -> Vec<(String, String)> {
    telemetry
        .spans("outlook.sync.project")
        .iter()
        .map(|span| {
            (
                span["outlook.outcome"].clone(),
                span["outlook.defer_reason"].clone(),
            )
        })
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_that_keeps_failing_is_deleted_at_the_bound_and_logged_once(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 48).await;
    let service = MailboxProjectionService::new(repo, FailingRefresh::new(downstream));

    // The 49th failure still backs off; the 50th gives the event up.
    assert!(service.project_once().await.is_err());
    assert_eq!(attempts(&db, id).await, Some(49));
    make_due(&db, id).await;
    assert!(service.project_once().await.is_err());

    assert_eq!(attempts(&db, id).await, None);
    assert!(!service.project_once().await.unwrap());
    assert_eq!(
        outcomes(&telemetry),
        [
            ("deferred".into(), "effect".into()),
            ("abandoned".into(), "effect".into())
        ]
    );
    let events = telemetry.events("mailbox projection abandoned");
    let [(level, fields)] = events.as_slice() else {
        panic!("expected one abandonment, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::WARN);
    assert_eq!(fields["link_id"], link.to_string());
    assert_eq!(fields["event_id"], id.to_string());
    assert_eq!(fields["event_kind"], "link_changed");
    assert_eq!(fields["attempts"], "50");
    assert_eq!(fields["defer_reason"], "effect");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_the_database_refuses_is_given_up_after_three_tries(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 2).await;
    let service = MailboxProjectionService::new(
        repo,
        FailingRefresh::new(|| MailboxError::Unstorable("22001".into())),
    );

    assert!(service.project_once().await.is_err());

    assert_eq!(attempts(&db, id).await, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn throttling_never_moves_a_projection_toward_abandonment(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 60).await;
    let service = MailboxProjectionService::new(
        repo,
        FailingRefresh::new(|| {
            MailboxError::Provider(EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Local,
            })
        }),
    );

    assert!(service.project_once().await.is_err());

    // The claim is given back, so the count stays past the bound and the
    // event is still queued.
    assert_eq!(attempts(&db, id).await, Some(60));
}

/// Ends the current claim as a worker that stopped would: its lease runs out.
async fn expire_lease(db: &PgPool, id: Uuid) {
    sqlx::query!(
        "UPDATE email_projection_outbox SET lease_until = now() - interval '1 second' WHERE id = $1",
        id
    )
    .execute(db)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_whose_claims_keep_ending_unfinished_is_abandoned_unprojected(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 0).await;
    for claimed_after in 0..5 {
        let lease = repo
            .claim_projection(Uuid::now_v7())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(lease.unfinished_claims, claimed_after);
        expire_lease(&db, id).await;
    }
    let effects = FailingRefresh::new(downstream);
    let refreshes = effects.refreshes.clone();
    let service = MailboxProjectionService::new(repo, effects);

    assert!(matches!(
        service.project_once().await,
        Err(MailboxError::ClaimsUnfinished(5))
    ));

    assert_eq!(refreshes.load(Ordering::SeqCst), 0);
    assert_eq!(attempts(&db, id).await, None);
    assert_eq!(
        outcomes(&telemetry),
        [("abandoned".into(), "unfinished".into())]
    );
    let events = telemetry.events("mailbox projection abandoned");
    let [(_, fields)] = events.as_slice() else {
        panic!("expected one abandonment, got {events:?}");
    };
    assert_eq!(fields["event_id"], id.to_string());
    assert_eq!(fields["attempts"], "6");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_worker_that_lost_its_lease_cannot_abandon_the_entry_a_second_time(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 0).await;
    for _ in 0..5 {
        repo.claim_projection(Uuid::now_v7())
            .await
            .unwrap()
            .unwrap();
        expire_lease(&db, id).await;
    }
    // This worker claims the entry to give it up, then pauses past its lease.
    let paused = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    expire_lease(&db, id).await;
    let next_worker = MailboxProjectionService::new(repo.clone(), FailingRefresh::new(downstream));
    assert!(matches!(
        next_worker.project_once().await,
        Err(MailboxError::ClaimsUnfinished(6))
    ));

    let late = repo
        .finish_projection(&paused, Some(crate::domain::mailbox::MessageRetry::Abandon))
        .await;

    assert!(matches!(late, Err(MailboxError::Stale)), "{late:?}");
    assert_eq!(telemetry.events("mailbox projection abandoned").len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_recorded_outcome_starts_the_count_of_unfinished_claims_over(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 0).await;
    for _ in 0..3 {
        repo.claim_projection(Uuid::now_v7())
            .await
            .unwrap()
            .unwrap();
        expire_lease(&db, id).await;
    }
    let unfinished = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unfinished.unfinished_claims, 3);

    repo.finish_projection(
        &unfinished,
        Some(crate::domain::mailbox::MessageRetry::After {
            seconds: 30,
            counted: true,
        }),
    )
    .await
    .unwrap();
    make_due(&db, id).await;

    let next = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.unfinished_claims, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retry_recorded_after_the_lease_ran_out_still_counts_as_unfinished(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let id = queue(&db, link, 0).await;
    let late = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    expire_lease(&db, id).await;

    repo.finish_projection(
        &late,
        Some(crate::domain::mailbox::MessageRetry::After {
            seconds: 30,
            counted: false,
        }),
    )
    .await
    .unwrap();

    // The late retry neither cleared the lease nor gave its claim back.
    let next = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((next.attempts, next.unfinished_claims), (2, 1));
}
