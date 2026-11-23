//! Concurrency contracts for projection claim snapshots, finishes and recovery.
use super::*;
use crate::domain::mailbox::projection::{
    MailboxProjectionRepository, ProjectionClaim, ProjectionLease,
};
use crate::domain::mailbox::projection_recovery::ProjectionRecoveryRepository;
use std::time::Duration;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_projection_probe_retains_its_attempt_fields(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',now())",
        Uuid::now_v7(),link
    ).execute(&db).await.unwrap();
    sqlx::query!(
        r#"CREATE FUNCTION pause_projection_unpark() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$"#
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "CREATE TRIGGER pause_projection_unpark BEFORE UPDATE ON email_projection_outbox FOR EACH ROW EXECUTE FUNCTION pause_projection_unpark()"
    ).execute(&db).await.unwrap();
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let mut page = Box::pin(repo.recover_page(64));
    let sleeping = async {
        loop {
            let sleeping = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event='PgSleep') AS "sleeping!""#
            )
            .fetch_one(&db)
            .await
            .unwrap();
            if sleeping {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    tokio::select! {
        result = &mut page => panic!("the probe completed before its controlled pause: {result:?}"),
        result = tokio::time::timeout(Duration::from_secs(2),sleeping) => result.expect("the probe must enter its unpark attempt"),
    }
    // An absolute timeout or shutdown drops the same future. Observe the
    // cancelled probe without waiting for its SQL statement to complete.
    drop(page);
    let spans = telemetry.spans("email.projection.unpark_probe");
    let span = spans.last().expect("the cancelled probe span must close");
    assert_eq!(span["projection.unpark_attempts"], "1");
    assert_eq!(span["projection.unpark_limit"], "64");
    assert_eq!(span["projection.discovery_skipped"], "false");
}

async fn leased_head_and_new_successor(db: &PgPool) -> (PgMailboxSync, Box<ProjectionLease>, Uuid) {
    let (repo, link) = fixture(db).await;
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}')",
        Uuid::now_v7(),link
    ).execute(db).await.unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the head must be claimable")
    };
    let next = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}')",
        next,link
    ).execute(db).await.unwrap();
    (repo, head, next)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_eligibility_uses_a_fresh_snapshot_after_locking_its_window(db: PgPool) {
    let (repo, head, next) = leased_head_and_new_successor(&db).await;
    let mut claim = repo.begin_claim().await.unwrap();
    let ids = repo.lock_projection_window(&mut claim).await.unwrap();
    assert_eq!(ids, [next]);
    // The original single-statement race needs a mid-scan pause. Check the
    // fresh-snapshot contract directly, without a production test hook. An
    // old-binary fenced delete can commit here; a new finish would wait on S.
    let deleted = sqlx::query!(
        "DELETE FROM email_projection_outbox WHERE id=$1 AND lease_id=$2 AND lease_until>now()",
        head.id,
        head.lease_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(deleted.rows_affected(), 1);
    let result = repo
        .claim_locked_projection(&mut claim, Uuid::now_v7(), &ids)
        .await
        .unwrap();
    claim.commit().await.unwrap();
    let ProjectionClaim::Acquired(successor) = result else {
        panic!("the fresh statement must see the completed head and claim its successor")
    };
    assert_eq!(successor.id, next);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_finish_waiting_on_the_window_wakes_after_its_deferral(db: PgPool) {
    let (repo, head, next) = leased_head_and_new_successor(&db).await;
    let mut claim = repo.begin_claim().await.unwrap();
    let ids = repo.lock_projection_window(&mut claim).await.unwrap();
    assert_eq!(ids, [next]);
    let other = repo.clone();
    let finish = tokio::spawn(async move { other.finish_projection(&head, None).await });
    let waited = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock') AS "waiting!""#
            )
            .fetch_one(&db)
            .await
            .unwrap();
            if waiting {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(matches!(
        repo.claim_locked_projection(&mut claim, Uuid::now_v7(), &ids)
            .await
            .unwrap(),
        ProjectionClaim::Progress
    ));
    claim.commit().await.unwrap();
    finish.await.unwrap().unwrap();
    assert!(
        waited.is_ok(),
        "the finish must wait on the locked successor"
    );
    let blocked = sqlx::query_scalar!(
        "SELECT blocked_until FROM email_projection_outbox WHERE id=$1",
        next
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        blocked.is_none(),
        "the finishing worker's later wake must win over the deferral"
    );
    let ProjectionClaim::Acquired(successor) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the concurrent finish must leave the successor immediately claimable")
    };
    assert_eq!(successor.id, next);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_backstop_deadlines_are_jittered_without_shortening_them(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let head = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,available_at) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',now()+interval '1 day')",
        head,link
    ).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) SELECT gen_random_uuid(),$1,1,'{\"kind\":\"link_changed\"}' FROM generate_series(1,64)",
        link
    ).execute(&db).await.unwrap();
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Progress
    ));
    let deadlines = sqlx::query!(
        r#"SELECT count(DISTINCT blocked_until) AS "deadlines!",
            bool_and(blocked_until>=now()+interval '59 minutes' AND blocked_until<=now()+interval '2 hours') AS "bounded!"
        FROM email_projection_outbox WHERE link_id=$1 AND id<>$2"#,
        link,head
    ).fetch_one(&db).await.unwrap();
    assert!(
        deadlines.deadlines > 1,
        "the backstop must not create one synchronized burst"
    );
    assert!(
        deadlines.bounded,
        "jitter must retain a long but bounded rollout backstop"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_finishes_serialize_before_taking_any_child_row_lock(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let later = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,seq) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',2)",
        later, link
    ).execute(&db).await.unwrap();
    let ProjectionClaim::Acquired(first) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the committed producer must be claimable")
    };
    // A different producer allocated an earlier sequence, but committed later.
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,seq) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',1)",
        Uuid::now_v7(), link
    ).execute(&db).await.unwrap();
    let ProjectionClaim::Acquired(second) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the earlier allocation can coexist with the first lease")
    };
    let mut fence = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
        link
    )
    .fetch_one(&mut *fence)
    .await
    .unwrap();
    let other = repo.clone();
    let a = tokio::spawn(async move { other.finish_projection(&first, None).await });
    let b = tokio::spawn(async move { repo.finish_projection(&second, None).await });
    let queued = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT count(*) AS "count!" FROM pg_locks
                WHERE locktype='advisory' AND NOT granted
                    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())"#
            )
            .fetch_one(&db)
            .await
            .unwrap();
            if waiting == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    let retained = sqlx::query_scalar!(
        "SELECT count(*) FROM email_projection_outbox WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    fence.rollback().await.unwrap();
    let outcomes = (a.await.unwrap(), b.await.unwrap());
    assert!(
        queued.is_ok(),
        "both finishes must wait on the link fence before deleting either row"
    );
    assert_eq!(retained, Some(2));
    assert!(
        outcomes.0.is_ok() && outcomes.1.is_ok(),
        "serialized finishes must not deadlock"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_recovery_can_skip_a_discovery_timeout(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',now())",
        Uuid::now_v7(),link
    ).execute(&db).await.unwrap();
    let mut blocker = db.begin().await.unwrap();
    sqlx::query!("LOCK TABLE email_projection_outbox IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let result = repo.recover_page(1).await;
    blocker.rollback().await.unwrap();
    let page = result
        .expect("discovery timeout must advance the cursor instead of failing the sweep")
        .expect("the sweep must own its cursor");
    assert_eq!(page.failed_probes, 1);
    let cursor = sqlx::query_scalar!("SELECT link_after FROM email_projection_unpark_sweep")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(cursor, link);
    // The skipped link is retried on the next wrap after the lock disappears.
    sqlx::query!(
        "UPDATE email_projection_unpark_sweep SET link_after=$1,available_at=now()",
        Uuid::nil()
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        repo.recover_page(64).await.unwrap().unwrap().rows_unparked,
        1
    );
}
