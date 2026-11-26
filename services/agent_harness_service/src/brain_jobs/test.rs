use super::pg::PgBrainJobs;
use super::*;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

fn job(deadline: DateTime<Utc>) -> Job {
    Job {
        key: JobKey {
            scope: JobScope {
                team_id: Uuid::now_v7(),
                user_id: MacroUserIdStr::try_from_email("worker@example.com").unwrap(),
            },
            id: Uuid::now_v7(),
        },
        intent: TaskTimeIntent {
            action_id: Uuid::now_v7(),
            task_id: "task-placeholder".to_owned(),
            date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            minutes: 15,
        },
        pins: PromptPins {
            repo_head_sha: "a".repeat(40),
            charter_sha256: "b".repeat(64),
            task_pack_id: "task-time".to_owned(),
            task_pack_revision: "revision-1".to_owned(),
        },
        deadline,
    }
}

async fn db_now(pool: &PgPool) -> DateTime<Utc> {
    sqlx::query_scalar!(r#"SELECT clock_timestamp() AS "now!""#)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn claim(store: &PgBrainJobs, scope: &JobScope, holder: Uuid) -> Lease {
    let Some(Claim::Active(lease)) = store.claim(scope, holder).await.unwrap() else {
        panic!("expected active lease");
    };
    lease
}

async fn authorized(lease: &Lease) -> AuthorizedAction<'_> {
    lease.authorize(async |_, _| true).await.unwrap()
}

async fn expire_lease(pool: &PgPool, key: &JobKey) {
    sqlx::query!(
        r#"
        UPDATE agent_brain_job SET lease_until = clock_timestamp() - interval '1 second'
        WHERE team_id = $1 AND user_id = $2 AND id = $3
        "#,
        key.scope.team_id,
        key.scope.user_id.as_ref(),
        key.id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[derive(Default)]
struct FakeWriter {
    writes: usize,
    entry: Option<TimeEntryConfirmation>,
}

impl FakeWriter {
    async fn dispatch(&mut self, pool: &PgPool, grant: Dispatch<'_>) {
        let job = grant.into_lease().job();
        let entry = job.intent.clone();
        let receipt = sqlx::query!(
            "SELECT confirmed_at FROM agent_brain_action_receipt WHERE action_id = $1",
            entry.action_id,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(
            receipt.confirmed_at.is_none(),
            "uncertainty must be durable before dispatch"
        );

        self.writes += 1;
        self.entry = Some(TimeEntryConfirmation {
            user_id: job.key.scope.user_id.clone(),
            entry,
        });
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_duplicate_admission_and_dispatch_are_scoped(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    let original = job(db_now(&pool).await + Duration::hours(1));
    let mut duplicate = original.clone();
    duplicate.intent.minutes = 20;
    duplicate.pins.repo_head_sha = "c".repeat(64);
    duplicate.deadline += Duration::hours(1);

    let (one, two) = tokio::join!(first.admit(&original), second.admit(&original));
    assert_ne!(one.unwrap(), two.unwrap());
    assert!(!second.admit(&duplicate).await.unwrap());

    let mut foreign = original.clone();
    foreign.key.id = Uuid::now_v7();
    foreign.key.scope.user_id = MacroUserIdStr::try_from_email("peer@example.com").unwrap();
    assert!(
        !second.admit(&foreign).await.unwrap(),
        "action uniqueness spans jobs and agents"
    );
    assert!(
        second
            .claim(&foreign.key.scope, Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );
    foreign.key.id = original.key.id;
    assert!(second.revoke(&foreign.key).await.unwrap().is_none());
    foreign.key.scope = original.key.scope.clone();
    foreign.key.scope.team_id = Uuid::now_v7();
    assert!(
        second
            .claim(&foreign.key.scope, Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );

    let holder_one = Uuid::now_v7();
    let holder_two = Uuid::now_v7();
    let (one, two) = tokio::join!(
        first.claim(&original.key.scope, holder_one),
        second.claim(&original.key.scope, holder_two)
    );
    let lease = match (one.unwrap(), two.unwrap()) {
        (Some(Claim::Active(lease)), None) | (None, Some(Claim::Active(lease))) => lease,
        claims => panic!("expected one worker to claim the job: {claims:?}"),
    };
    assert_eq!(lease.job(), &original);
    assert_eq!(lease.epoch(), 1);
    assert!(first.renew(&lease).await.unwrap());

    let (left, right) = tokio::join!(
        first.reserve(authorized(&lease).await),
        second.reserve(authorized(&lease).await)
    );
    let grant = match (left.unwrap(), right.unwrap()) {
        (Some(Reservation::Dispatch(grant)), Some(Reservation::ReconcileOnly))
        | (Some(Reservation::ReconcileOnly), Some(Reservation::Dispatch(grant))) => grant,
        results => panic!("expected only one dispatch permission: {results:?}"),
    };

    let mut writer = FakeWriter::default();
    writer.dispatch(&pool, grant).await;
    assert!(
        first
            .reconcile(authorized(&lease).await, writer.entry.as_ref().unwrap())
            .await
            .unwrap()
    );
    assert!(matches!(
        second.reserve(authorized(&lease).await).await.unwrap(),
        Some(Reservation::AlreadyCommitted)
    ));
    assert_eq!(writer.writes, 1);
    assert_eq!(
        first.finalize(&lease, Completion::Succeeded).await.unwrap(),
        Some(Outcome::Succeeded)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn takeover_reconciles_only_exact_evidence_from_a_prior_dispatch(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    let job = job(db_now(&pool).await + Duration::hours(1));
    first.admit(&job).await.unwrap();

    // Reusing the holder simulates restart with the same replica identity.
    let holder = Uuid::now_v7();
    let previous = claim(&first, &job.key.scope, holder).await;
    let Some(Reservation::Dispatch(grant)) =
        first.reserve(authorized(&previous).await).await.unwrap()
    else {
        panic!("expected dispatch grant");
    };
    let mut writer = FakeWriter::default();
    writer.dispatch(&pool, grant).await;
    expire_lease(&pool, &job.key).await;

    let current = claim(&second, &job.key.scope, holder).await;
    assert_eq!(current.epoch(), previous.epoch() + 1);
    assert!(!first.renew(&previous).await.unwrap());
    assert!(
        first
            .reserve(authorized(&previous).await)
            .await
            .unwrap()
            .is_none()
    );
    let entry = writer.entry.as_ref().unwrap();
    assert!(
        !first
            .reconcile(authorized(&previous).await, entry)
            .await
            .unwrap()
    );
    assert!(
        first
            .finalize(&previous, Completion::Succeeded)
            .await
            .unwrap()
            .is_none()
    );

    assert!(current.authorize(async |_, _| false).await.is_none());
    assert!(matches!(
        second.reserve(authorized(&current).await).await.unwrap(),
        Some(Reservation::ReconcileOnly)
    ));
    let mut mismatch = TimeEntryConfirmation {
        user_id: entry.user_id.clone(),
        entry: entry.entry.clone(),
    };
    mismatch.entry.minutes += 1;
    assert!(
        !second
            .reconcile(authorized(&current).await, &mismatch)
            .await
            .unwrap()
    );
    assert!(
        second
            .reconcile(authorized(&current).await, entry)
            .await
            .unwrap()
    );

    let receipt = sqlx::query!(
        "SELECT dispatch_epoch FROM agent_brain_action_receipt WHERE action_id = $1",
        job.intent.action_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(receipt.dispatch_epoch, previous.epoch());
    assert_eq!(writer.writes, 1);
    assert_eq!(
        second
            .finalize(&current, Completion::Succeeded)
            .await
            .unwrap(),
        Some(Outcome::Succeeded)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn takeover_never_replays_after_crash_before_send_or_after_deletion(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    for sent_then_deleted in [false, true] {
        let job = job(db_now(&pool).await + Duration::hours(1));
        first.admit(&job).await.unwrap();
        let initial = claim(&first, &job.key.scope, Uuid::now_v7()).await;
        // A crash before a receipt is armed leaves it safe to take the first
        // dispatch permission on a later lease.
        expire_lease(&pool, &job.key).await;
        let armed = claim(&second, &job.key.scope, Uuid::now_v7()).await;
        assert_eq!(armed.epoch(), initial.epoch() + 1);
        let Some(Reservation::Dispatch(grant)) =
            second.reserve(authorized(&armed).await).await.unwrap()
        else {
            panic!("expected first dispatch permission");
        };
        let mut writer = FakeWriter::default();
        if sent_then_deleted {
            writer.dispatch(&pool, grant).await;
            writer.entry = None;
        }
        // The replacement can only read for an exact entry. Both breaking
        // before send and deletion after send yield the same missing evidence.
        expire_lease(&pool, &job.key).await;
        let replacement = claim(&first, &job.key.scope, Uuid::now_v7()).await;
        assert!(matches!(
            first.reserve(authorized(&replacement).await).await.unwrap(),
            Some(Reservation::ReconcileOnly)
        ));
        assert!(writer.entry.is_none());
        assert_eq!(writer.writes, usize::from(sent_then_deleted));
        assert_eq!(
            first
                .finalize(&replacement, Completion::Succeeded)
                .await
                .unwrap(),
            Some(Outcome::UnknownOutcome)
        );
        assert!(
            second
                .claim(&job.key.scope, Uuid::now_v7())
                .await
                .unwrap()
                .is_none()
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoke_and_deadline_fence_late_writer_responses(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    assert!(
        !first
            .admit(&job(db_now(&pool).await - Duration::seconds(1)))
            .await
            .unwrap()
    );

    for revoke in [true, false] {
        let job = job(db_now(&pool).await + Duration::hours(1));
        first.admit(&job).await.unwrap();
        let lease = claim(&first, &job.key.scope, Uuid::now_v7()).await;
        let Some(Reservation::Dispatch(grant)) =
            first.reserve(authorized(&lease).await).await.unwrap()
        else {
            panic!("expected dispatch permission");
        };
        let mut writer = FakeWriter::default();
        writer.dispatch(&pool, grant).await;

        if revoke {
            assert_eq!(
                second.revoke(&job.key).await.unwrap(),
                Some(Outcome::UnknownOutcome)
            );
        } else {
            // Advance the fixture past its deadline without waiting on wall-clock time.
            sqlx::query!(
                r#"
                UPDATE agent_brain_job
                SET (deadline_at, lease_until) = (SELECT past, past FROM
                    (SELECT clock_timestamp() - interval '1 second' AS past) tick)
                WHERE team_id = $1 AND user_id = $2 AND id = $3
                "#,
                job.key.scope.team_id,
                job.key.scope.user_id.as_ref(),
                job.key.id,
            )
            .execute(&pool)
            .await
            .unwrap();
        }

        assert!(!first.renew(&lease).await.unwrap());
        assert!(
            !first
                .reconcile(authorized(&lease).await, writer.entry.as_ref().unwrap())
                .await
                .unwrap()
        );
        assert!(
            first
                .finalize(&lease, Completion::Succeeded)
                .await
                .unwrap()
                .is_none()
        );
        let next = second.claim(&job.key.scope, Uuid::now_v7()).await.unwrap();
        if revoke {
            assert!(next.is_none());
        } else {
            assert!(
                matches!(next, Some(Claim::Expired(key, Outcome::UnknownOutcome)) if key == job.key)
            );
        }
        let receipt = sqlx::query!(
            "SELECT confirmed_at FROM agent_brain_action_receipt WHERE action_id = $1",
            job.intent.action_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(receipt.confirmed_at.is_none());
        assert!(!second.admit(&job).await.unwrap());
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_skips_a_busy_job_within_the_same_scope(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    let blocked = job(db_now(&pool).await + Duration::hours(1));
    let mut ready = job(blocked.deadline);
    ready.key.scope = blocked.key.scope.clone();
    first.admit(&blocked).await.unwrap();
    first.admit(&ready).await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM agent_brain_job WHERE team_id = $1 AND user_id = $2 AND id = $3 FOR UPDATE",
        blocked.key.scope.team_id,
        blocked.key.scope.user_id.as_ref(),
        blocked.key.id,
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();

    assert_eq!(
        claim(&second, &ready.key.scope, Uuid::now_v7()).await.job(),
        &ready
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        claim(&first, &blocked.key.scope, Uuid::now_v7())
            .await
            .job(),
        &blocked
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoke_before_reservation_invalidates_a_prechecked_lease(pool: PgPool) {
    let first = PgBrainJobs::new(pool.clone());
    let second = PgBrainJobs::new(pool.clone());
    let job = job(db_now(&pool).await + Duration::hours(1));
    first.admit(&job).await.unwrap();
    let lease = claim(&first, &job.key.scope, Uuid::now_v7()).await;
    let checked = authorized(&lease).await;

    assert_eq!(
        second.revoke(&job.key).await.unwrap(),
        Some(Outcome::Cancelled)
    );
    assert!(first.reserve(checked).await.unwrap().is_none());
    assert!(
        second
            .claim(&job.key.scope, Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );

    let receipt = sqlx::query!(
        "SELECT action_id FROM agent_brain_action_receipt WHERE action_id = $1",
        job.intent.action_id,
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert!(receipt.is_none());
}
