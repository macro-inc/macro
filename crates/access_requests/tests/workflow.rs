use access_requests::{
    domain::{
        models::*,
        ports::{Clock, RequestRepository},
        service::AccessRequestService,
    },
    outbound::postgres::PgRequestRepository,
};
use chrono::{DateTime, Utc};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use uuid::Uuid;

#[derive(Clone)]
struct TestClock(Arc<AtomicI64>);
impl Clock for TestClock {
    fn now(&self) -> DateTime<Utc> {
        DateTime::from_timestamp(self.0.load(Ordering::SeqCst), 0).unwrap()
    }
}
type Service = AccessRequestService<
    PgRequestRepository,
    EntityAccessServiceImpl<PgAccessRepository>,
    TestClock,
>;
fn setup(pool: PgPool) -> (Service, TestClock) {
    let clock = TestClock(Arc::new(AtomicI64::new(1_800_000_000)));
    (
        AccessRequestService::new(
            Arc::new(PgRequestRepository::new(pool.clone())),
            Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(pool))),
            clock.clone(),
        ),
        clock,
    )
}
fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@requests.test")).unwrap()
}
fn entity() -> ShareEntity {
    ShareEntity {
        entity_type: ShareEntityType::Document,
        entity_id: Uuid::from_u128(16),
    }
}
fn ask(level: AccessLevel, revision: Option<i32>) -> RequestAccess {
    RequestAccess {
        requested_level: level,
        revision,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn upgrades_and_private_state(pool: PgPool) {
    let (s, _) = setup(pool);
    assert!(matches!(
        s.submit(user("owner"), entity(), ask(AccessLevel::Edit, None))
            .await,
        Err(RequestError::Forbidden)
    ));
    let outsider = s.state(user("outsider"), entity(), 0).await.unwrap();
    assert!(outsider.access_level.is_none());
    assert!(outsider.owner.is_none());
    assert!(!outsider.can_review);
    assert!(outsider.requests.is_empty());
    assert_eq!(outsider.pending_count, 0);
    for level in [AccessLevel::View, AccessLevel::Owner] {
        assert!(matches!(
            s.submit(user("reader"), entity(), ask(level, None)).await,
            Err(RequestError::InvalidLevel)
        ));
    }
    let request = s
        .submit(user("reader"), entity(), ask(AccessLevel::Edit, None))
        .await
        .unwrap();
    let reader = s.state(user("reader"), entity(), 0).await.unwrap();
    assert_eq!(reader.mine.unwrap().id, request.id);
    assert!(reader.requests.is_empty());
    assert_eq!(reader.pending_count, 0);
    assert_eq!(
        s.state(user("owner"), entity(), 0)
            .await
            .unwrap()
            .pending_count,
        1
    );
    assert!(matches!(
        s.resolve(
            user("reader"),
            entity(),
            request.id,
            ResolveRequest {
                revision: 1,
                granted_level: Some(AccessLevel::Edit)
            }
        )
        .await,
        Err(RequestError::Forbidden)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn initial_access_requires_owner_approval_and_supports_cancellation(pool: PgPool) {
    let (s, clock) = setup(pool);
    let first = s
        .submit(user("outsider"), entity(), ask(AccessLevel::View, None))
        .await
        .unwrap();
    let state = s.state(user("outsider"), entity(), 0).await.unwrap();
    assert!(state.access_level.is_none());
    assert!(state.owner.is_none());
    assert_eq!(state.mine.unwrap().id, first.id);
    assert!(state.requests.is_empty());
    assert_eq!(state.pending_count, 0);
    assert!(matches!(
        s.direct_access(user("outsider"), entity()).await,
        Err(RequestError::Forbidden)
    ));
    assert!(matches!(
        s.set_direct_access(
            user("outsider"),
            entity(),
            user("outsider"),
            Some(AccessLevel::Edit)
        )
        .await,
        Err(RequestError::Forbidden)
    ));
    assert!(matches!(
        s.resolve(
            user("outsider"),
            entity(),
            first.id,
            ResolveRequest {
                revision: first.revision,
                granted_level: Some(AccessLevel::Edit)
            }
        )
        .await,
        Err(RequestError::Forbidden)
    ));
    s.cancel(user("outsider"), entity(), first.revision)
        .await
        .unwrap();
    let cancelled = s
        .state(user("outsider"), entity(), 0)
        .await
        .unwrap()
        .mine
        .unwrap();
    assert_eq!(cancelled.status, RequestStatus::Cancelled);
    clock.0.fetch_add(60, Ordering::SeqCst);
    let request = s
        .submit(
            user("outsider"),
            entity(),
            ask(AccessLevel::View, Some(cancelled.revision)),
        )
        .await
        .unwrap();
    let owner = s.state(user("owner"), entity(), 0).await.unwrap();
    assert_eq!(owner.requests[0].id, request.id);
    s.resolve(
        user("owner"),
        entity(),
        request.id,
        ResolveRequest {
            revision: request.revision,
            granted_level: Some(AccessLevel::View),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        s.state(user("outsider"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::View)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn edits_cancel_and_stale_reviews(pool: PgPool) {
    let (s, clock) = setup(pool);
    let first = s
        .submit(user("reader"), entity(), ask(AccessLevel::Comment, None))
        .await
        .unwrap();
    let replay = s
        .submit(user("reader"), entity(), ask(AccessLevel::Comment, None))
        .await
        .unwrap();
    assert_eq!(first.revision, replay.revision);
    clock.0.fetch_add(60, Ordering::SeqCst);
    let changed = s
        .submit(
            user("reader"),
            entity(),
            ask(AccessLevel::Edit, Some(first.revision)),
        )
        .await
        .unwrap();
    assert_eq!(changed.id, first.id);
    assert!(matches!(
        s.resolve(
            user("owner"),
            entity(),
            first.id,
            ResolveRequest {
                revision: first.revision,
                granted_level: Some(AccessLevel::Comment)
            }
        )
        .await,
        Err(RequestError::Conflict)
    ));
    s.cancel(user("reader"), entity(), changed.revision)
        .await
        .unwrap();
    assert_eq!(
        s.state(user("owner"), entity(), 0)
            .await
            .unwrap()
            .pending_count,
        0
    );
    let events = s.repository.claim_events().await.unwrap();
    let cancel = events
        .iter()
        .find(|e| {
            e.request
                .as_ref()
                .is_some_and(|r| r.status == RequestStatus::Cancelled)
        })
        .unwrap();
    assert_eq!(cancel.superseded.len(), 1);
    let edited = events
        .iter()
        .find(|event| {
            event.request.as_ref().is_some_and(|r| {
                r.status == RequestStatus::Pending && r.revision == changed.revision
            })
        })
        .unwrap();
    let initial = events
        .iter()
        .find(|event| {
            event
                .request
                .as_ref()
                .is_some_and(|r| r.status == RequestStatus::Pending && r.revision == first.revision)
        })
        .unwrap();
    assert_eq!(cancel.superseded[0].0, edited.id);
    assert_eq!(edited.superseded.len(), 1);
    assert_eq!(edited.superseded[0].0, initial.id);
    assert!(initial.superseded.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn denial_cooldown_applies_to_both_levels(pool: PgPool) {
    let (s, clock) = setup(pool);
    let request = s
        .submit(user("reader"), entity(), ask(AccessLevel::Edit, None))
        .await
        .unwrap();
    let denied = s
        .resolve(
            user("owner"),
            entity(),
            request.id,
            ResolveRequest {
                revision: request.revision,
                granted_level: None,
            },
        )
        .await
        .unwrap();
    for level in [AccessLevel::Comment, AccessLevel::Edit] {
        assert!(matches!(
            s.submit(user("reader"), entity(), ask(level, Some(denied.revision)))
                .await,
            Err(RequestError::Cooldown(_))
        ));
    }
    clock.0.fetch_add(24 * 60 * 60, Ordering::SeqCst);
    assert!(
        s.submit(
            user("reader"),
            entity(),
            ask(AccessLevel::Comment, Some(denied.revision))
        )
        .await
        .is_ok()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn requester_cannot_repeat_notifications_by_changing_levels_or_cancelling(pool: PgPool) {
    let (service, clock) = setup(pool);
    let first = service
        .submit(user("outsider"), entity(), ask(AccessLevel::View, None))
        .await
        .unwrap();
    let deadline = clock.now() + chrono::Duration::seconds(60);
    assert_eq!(first.retry_after, Some(deadline));
    let replay = service
        .submit(user("outsider"), entity(), ask(AccessLevel::View, None))
        .await
        .unwrap();
    assert_eq!(replay.revision, first.revision);
    assert_eq!(replay.retry_after, Some(deadline));
    for level in [AccessLevel::Comment, AccessLevel::Edit] {
        assert!(matches!(
            service.submit(user("outsider"), entity(), ask(level, Some(first.revision))).await,
            Err(RequestError::Cooldown(until)) if until == deadline
        ));
    }

    service
        .cancel(user("outsider"), entity(), first.revision)
        .await
        .unwrap();
    let cancelled = service
        .state(user("outsider"), entity(), 0)
        .await
        .unwrap()
        .mine
        .unwrap();
    assert_eq!(cancelled.status, RequestStatus::Cancelled);
    assert_eq!(cancelled.retry_after, Some(deadline));
    clock.0.fetch_add(59, Ordering::SeqCst);
    assert!(matches!(
        service.submit(user("outsider"), entity(), ask(AccessLevel::View, Some(cancelled.revision))).await,
        Err(RequestError::Cooldown(until)) if until == deadline
    ));
    clock.0.fetch_add(1, Ordering::SeqCst);
    let resubmitted = service
        .submit(
            user("outsider"),
            entity(),
            ask(AccessLevel::Comment, Some(cancelled.revision)),
        )
        .await
        .unwrap();
    assert_eq!(resubmitted.id, first.id);
    assert_eq!(
        resubmitted.retry_after,
        Some(deadline + chrono::Duration::seconds(60))
    );
    assert!(matches!(
        service
            .submit(
                user("outsider"),
                entity(),
                ask(AccessLevel::Edit, Some(resubmitted.revision))
            )
            .await,
        Err(RequestError::Cooldown(_))
    ));
    let events = service.repository.claim_events().await.unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.request.as_ref().unwrap().status == RequestStatus::Pending)
            .count(),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn approval_allows_an_immediate_further_upgrade(pool: PgPool) {
    let (service, _) = setup(pool);
    let first = service
        .submit(user("outsider"), entity(), ask(AccessLevel::View, None))
        .await
        .unwrap();
    let granted = service
        .resolve(
            user("owner"),
            entity(),
            first.id,
            ResolveRequest {
                revision: first.revision,
                granted_level: Some(AccessLevel::View),
            },
        )
        .await
        .unwrap();
    assert!(granted.retry_after.is_none());
    let upgraded = service
        .submit(
            user("outsider"),
            entity(),
            ask(AccessLevel::Edit, Some(granted.revision)),
        )
        .await
        .unwrap();
    assert_eq!(upgraded.requested_level, AccessLevel::Edit);
    assert_eq!(upgraded.status, RequestStatus::Pending);
    assert!(upgraded.retry_after.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn first_review_wins_and_grants_are_manageable(pool: PgPool) {
    let (s, _) = setup(pool);
    let request = s
        .submit(user("reader"), entity(), ask(AccessLevel::Edit, None))
        .await
        .unwrap();
    let args = || ResolveRequest {
        revision: request.revision,
        granted_level: Some(AccessLevel::Comment),
    };
    let (a, b) = tokio::join!(
        s.resolve(user("owner"), entity(), request.id, args()),
        s.resolve(user("owner"), entity(), request.id, args())
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::Comment)
    );
    assert_eq!(
        s.direct_access(user("owner"), entity())
            .await
            .unwrap()
            .len(),
        1
    );
    s.set_direct_access(
        user("owner"),
        entity(),
        user("reader"),
        Some(AccessLevel::Edit),
    )
    .await
    .unwrap();
    assert_eq!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::Edit)
    );
    s.set_direct_access(user("owner"), entity(), user("reader"), None)
        .await
        .unwrap();
    assert!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn concurrent_duplicate_submissions_have_one_request_and_event(pool: PgPool) {
    let (s, _) = setup(pool);
    let (a, b) = tokio::join!(
        s.submit(user("reader"), entity(), ask(AccessLevel::Edit, None)),
        s.submit(user("reader"), entity(), ask(AccessLevel::Edit, None))
    );
    assert_eq!(a.unwrap().id, b.unwrap().id);
    assert_eq!(s.repository.claim_events().await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn approval_preserves_stronger_access_and_rejects_owner_grants(pool: PgPool) {
    let (s, _) = setup(pool);
    let request = s
        .submit(user("reader"), entity(), ask(AccessLevel::Edit, None))
        .await
        .unwrap();
    assert!(matches!(
        s.resolve(
            user("owner"),
            entity(),
            request.id,
            ResolveRequest {
                revision: request.revision,
                granted_level: Some(AccessLevel::Owner)
            }
        )
        .await,
        Err(RequestError::InvalidLevel)
    ));
    s.set_direct_access(
        user("owner"),
        entity(),
        user("reader"),
        Some(AccessLevel::Edit),
    )
    .await
    .unwrap();
    s.resolve(
        user("owner"),
        entity(),
        request.id,
        ResolveRequest {
            revision: request.revision,
            granted_level: Some(AccessLevel::Comment),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::Edit)
    );
    assert!(matches!(
        s.set_direct_access(user("owner"), entity(), user("owner"), None)
            .await,
        Err(RequestError::Forbidden)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document", "folder"))]
async fn folder_grants_propagate_without_overwriting_direct_child_access(pool: PgPool) {
    let (s, _) = setup(pool);
    let folder = ShareEntity {
        entity_type: ShareEntityType::Project,
        entity_id: Uuid::from_u128(32),
    };
    let request = s
        .submit(user("reader"), folder, ask(AccessLevel::Edit, None))
        .await
        .unwrap();
    s.resolve(
        user("owner"),
        folder,
        request.id,
        ResolveRequest {
            revision: request.revision,
            granted_level: Some(AccessLevel::Edit),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::Edit)
    );
    s.set_direct_access(user("owner"), folder, user("reader"), None)
        .await
        .unwrap();
    assert_eq!(
        s.state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::View)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn bot_sponsor_can_review_without_a_separate_user_grant(pool: PgPool) {
    sqlx::query!("INSERT INTO bots (id, kind, owner_user_id, name, handle) VALUES ('00000000-0000-0000-0000-000000000020', 'owned', 'macro|owner@requests.test', 'Owner bot', 'request-owner')")
        .execute(&pool).await.unwrap();
    sqlx::query!(r#"UPDATE "Document" SET owner = 'bot|00000000-0000-0000-0000-000000000020' WHERE id = '00000000-0000-0000-0000-000000000010'"#)
        .execute(&pool).await.unwrap();
    sqlx::query!("DELETE FROM entity_access WHERE source_id = 'macro|owner@requests.test'")
        .execute(&pool)
        .await
        .unwrap();
    let (service, _) = setup(pool);
    let state = service.state(user("owner"), entity(), 0).await.unwrap();
    assert!(state.can_review);
    assert!(state.access_level.is_none());
    let request = service
        .submit(user("outsider"), entity(), ask(AccessLevel::View, None))
        .await
        .unwrap();
    let approved = service
        .resolve(
            user("owner"),
            entity(),
            request.id,
            ResolveRequest {
                revision: request.revision,
                granted_level: Some(AccessLevel::View),
            },
        )
        .await
        .unwrap();
    assert_eq!(approved.status, RequestStatus::Granted);
    assert_eq!(
        service
            .direct_access(user("owner"), entity())
            .await
            .unwrap()
            .len(),
        2
    );
    service
        .set_direct_access(user("owner"), entity(), user("outsider"), None)
        .await
        .unwrap();
    assert!(
        service
            .state(user("outsider"), entity(), 0)
            .await
            .unwrap()
            .access_level
            .is_none()
    );
    assert!(matches!(
        service
            .set_direct_access(
                user("reader"),
                entity(),
                user("outsider"),
                Some(AccessLevel::Edit)
            )
            .await,
        Err(RequestError::Forbidden)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn request_workflow_does_not_acquire_a_second_pool_connection(pool: PgPool) {
    let single = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(2))
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let (service, _) = setup(single);
    assert_eq!(
        service
            .state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::View)
    );
    let request = service
        .submit(user("reader"), entity(), ask(AccessLevel::Comment, None))
        .await
        .unwrap();
    service
        .resolve(
            user("owner"),
            entity(),
            request.id,
            ResolveRequest {
                revision: request.revision,
                granted_level: Some(AccessLevel::Comment),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .direct_access(user("reader"), entity())
            .await
            .unwrap()[0]
            .access_level,
        AccessLevel::Comment
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn notification_supersession_follows_revisions_when_transaction_times_are_reordered(
    pool: PgPool,
) {
    let (service, clock) = setup(pool.clone());
    let first = service
        .submit(user("reader"), entity(), ask(AccessLevel::Comment, None))
        .await
        .unwrap();
    clock.0.fetch_add(60, Ordering::SeqCst);
    let second = service
        .submit(
            user("reader"),
            entity(),
            ask(AccessLevel::Edit, Some(first.revision)),
        )
        .await
        .unwrap();

    // PostgreSQL now() captures transaction start. Guard acquisition can occur
    // in the opposite order, so timestamps need not follow request revisions.
    sqlx::query!(
        "UPDATE entity_access_request_event SET created_at = CASE WHEN (payload->'request'->>'revision')::integer = 1 THEN '2001-01-01'::timestamptz ELSE '2000-01-01'::timestamptz END WHERE request_id = $1",
        first.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let pending_events = service.repository.claim_events().await.unwrap();
    let second_event = pending_events
        .iter()
        .find(|event| event.request.as_ref().unwrap().revision == second.revision)
        .unwrap();

    service
        .cancel(user("reader"), entity(), second.revision)
        .await
        .unwrap();
    let cancelled_events = service.repository.claim_events().await.unwrap();
    assert_eq!(cancelled_events.len(), 1);
    assert_eq!(
        cancelled_events[0].superseded,
        vec![(second_event.id, vec![user("owner")])]
    );
}
