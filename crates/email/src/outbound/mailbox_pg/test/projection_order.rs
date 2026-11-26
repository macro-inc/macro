//! Projection ordering must survive both row-lock and retry windows.
use super::*;
use crate::domain::mailbox::parked_work_recovery::ParkedWorkRecoveryRepository;
use crate::domain::mailbox::projection::MailboxProjectionRepository;
use crate::domain::mailbox::projection::ProjectionClaim;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_discards_a_payload_without_an_entity_and_claims_the_next_notice(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let malformed = Uuid::now_v7();
    let notice = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_projection_outbox (id,link_id,generation,payload,available_at)
           VALUES ($1,$3,1,'{}',now()-interval '1 second'),
                  ($2,$3,1,'{"kind":"link_changed"}',now())"#,
        malformed,
        notice,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Progress
    ));
    let quarantined = sqlx::query_scalar!(
        "SELECT reason FROM email_mailbox_work_quarantine WHERE work='projection' AND work_id=$1",
        malformed,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(quarantined, "decode");
    let ProjectionClaim::Acquired(lease) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the valid notice must be claimable");
    };
    assert_eq!(lease.id, notice);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quarantining_a_keyed_head_wakes_its_same_thread_successor(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (_, successor) = malformed_projection_and_successor(&db, link).await;
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Progress
    ));
    let ProjectionClaim::Acquired(lease) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the same-thread successor must be claimable as soon as its head is quarantined");
    };
    assert_eq!(lease.id, successor);
}

async fn malformed_projection_and_successor(db: &PgPool, link: Uuid) -> (Uuid, Uuid) {
    let malformed = Uuid::now_v7();
    let successor = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_projection_outbox (id,link_id,generation,payload,available_at)
           VALUES ($1,$3,1,'{"kind":"message","thread_id":"00000000-0000-0000-0000-000000000010"}',now()-interval '1 second'),
                  ($2,$3,1,'{"kind":"organization","thread_id":"00000000-0000-0000-0000-000000000010"}',now())"#,
        malformed, successor, link
    )
    .execute(db)
    .await
    .unwrap();
    (malformed, successor)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quarantined_projection_successor_has_a_bounded_lost_wake_backstop(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (malformed, successor) = malformed_projection_and_successor(&db, link).await;
    let mut tx = repo.begin_claim().await.unwrap();
    let window = repo.lock_projection_window(&mut tx).await.unwrap();
    let outcome = repo
        .claim_locked_projection(&mut tx, Uuid::now_v7(), &window)
        .await
        .unwrap();
    assert!(matches!(outcome.claim, ProjectionClaim::Progress));
    // A failed replica committed the quarantine but never ran the wake.
    tx.commit().await.unwrap();
    let reason = sqlx::query_scalar!(
        "SELECT reason FROM email_mailbox_work_quarantine WHERE work='projection' AND work_id=$1",
        malformed,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(reason, "decode");
    let deadline_is_bounded = sqlx::query_scalar!(
        r#"SELECT COALESCE(blocked_until > now() AND blocked_until <= now() + interval '3 minutes', false) AS "bounded!"
           FROM email_projection_outbox WHERE id=$1"#,
        successor,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(deadline_is_bounded);
    sqlx::query!(
        "UPDATE email_projection_outbox SET blocked_until=now() WHERE id=$1",
        successor,
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(lease) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the backstop must wake the successor after expiry");
    };
    assert_eq!(lease.id, successor);
}

/// 64 parked projection rows on `link`, behind a trigger that sleeps 0.4 s
/// on any unpark UPDATE over 10 rows and counts each attempt by size.
async fn slow_projection_unpark(db: &PgPool, link: Uuid) {
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at) SELECT gen_random_uuid(),$1,1,'{\"kind\":\"link_changed\"}',now() FROM generate_series(1,64)",
        link
    ).execute(db).await.unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_large_attempt")
        .execute(db)
        .await
        .unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_medium_attempt")
        .execute(db)
        .await
        .unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_small_attempt")
        .execute(db)
        .await
        .unwrap();
    // Sequences survive savepoint rollback. With projection-only work across
    // the five families, a link page's first UPDATE is 13, 7, 4 or 2 rows for
    // budgets 64, 32, 16 or 8, and its borrowing UPDATE takes the rest of the
    // page, so attempts over 10 rows sleep past the probe's 250 ms statement
    // timeout and halve until the page fits; a page takes several probes.
    sqlx::query!(
        r#"
        CREATE FUNCTION projection_unpark_budget() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE amount bigint;
        BEGIN
            SELECT count(*) INTO amount FROM updated_rows;
            IF amount>16 THEN
                PERFORM nextval('unpark_large_attempt'); PERFORM pg_sleep(0.4);
            ELSIF amount>10 THEN
                PERFORM nextval('unpark_medium_attempt'); PERFORM pg_sleep(0.4);
            ELSE PERFORM nextval('unpark_small_attempt');
            END IF;
            RETURN NULL;
        END $$
        "#
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "CREATE TRIGGER projection_unpark_budget AFTER UPDATE ON email_projection_outbox REFERENCING OLD TABLE AS updated_rows FOR EACH STATEMENT EXECUTE FUNCTION projection_unpark_budget()"
    ).execute(db).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_slow_projection_unpark_halves_within_the_wrap_until_it_fits(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    // The page's timed-out attempts add up past the production budget, which
    // the next test covers; this one checks what the halving achieves.
    let repo = repo.with_recovery_page_budget(std::time::Duration::from_secs(60));
    slow_projection_unpark(&db, link).await;
    let page = repo.recover_page(64).await.unwrap().unwrap();
    assert_eq!(page.rows_unparked, 64);
    assert_eq!(page.failed_probes, 0);
    let all_called = sqlx::query_scalar!(
        r#"SELECT COALESCE(bool_and(last_value IS NOT NULL),false) AS "called!"
        FROM pg_sequences WHERE schemaname='public'
            AND sequencename IN ('unpark_large_attempt','unpark_medium_attempt','unpark_small_attempt')"#
    ).fetch_one(&db).await.unwrap();
    assert!(
        all_called,
        "large and medium attempts must time out before smaller ones drain the link"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_recovery_page_past_its_budget_reports_deadline_exceeded(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let repo = repo.with_recovery_page_budget(std::time::Duration::from_millis(300));
    slow_projection_unpark(&db, link).await;
    let error = repo.recover_page(64).await.unwrap_err();
    assert!(
        matches!(
            error,
            MailboxError::Database(crate::domain::mailbox::DatabaseFailure::DeadlineExceeded),
        ),
        "{error:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_slow_recovery_probe_keeps_prior_commits_and_skips_only_that_link(db: PgPool) {
    let (repo, _) = fixture(&db).await;
    let mut links = Vec::new();
    for _ in 0..64 {
        let link = Uuid::now_v7();
        let address = format!("{link}@example.com");
        sqlx::query!(
            "INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation) VALUES ($1,'macro|probe@example.com',$2::text,$2::text,'OUTLOOK',1)",
            link, address
        ).execute(&db).await.unwrap();
        links.push(link);
        sqlx::query!(
            "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',now())",
            Uuid::now_v7(), link
        ).execute(&db).await.unwrap();
    }
    links.sort();
    let slow = *links.last().unwrap();
    sqlx::query!(
        "UPDATE email_projection_outbox SET payload=jsonb_set(payload,'{slow_probe}','true') WHERE link_id=$1",
        slow
    ).execute(&db).await.unwrap();
    sqlx::query!(
        r#"
        CREATE FUNCTION slow_projection_unpark() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.payload->>'slow_probe'='true' THEN PERFORM pg_sleep(0.4); END IF;
            RETURN NEW;
        END $$
        "#
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "CREATE TRIGGER slow_projection_unpark BEFORE UPDATE ON email_projection_outbox FOR EACH ROW EXECUTE FUNCTION slow_projection_unpark()"
    ).execute(&db).await.unwrap();
    let page = repo.recover_page(64).await.unwrap().unwrap();
    assert_eq!(page.links_scanned, 64);
    assert_eq!(
        page.rows_unparked, 63,
        "only the timed-out link must remain parked"
    );
    let cursor = sqlx::query_scalar!("SELECT link_after FROM email_projection_unpark_sweep")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(
        cursor, slow,
        "successful earlier probes must remain committed"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finishing_a_two_second_projection_wakes_its_successor_on_the_next_poll(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload)
        VALUES ($1,$3,1,'{"kind":"link_changed"}'),
            ($2,$3,1,'{"kind":"link_changed"}')
        "#,
        first,
        second,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the first event must be claimable")
    };
    assert_eq!(head.id, first);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert!(!matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Acquired(_)
    ));
    repo.finish_projection(&head, None).await.unwrap();
    let ProjectionClaim::Acquired(next) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("finishing the head must wake its successor without changing fixture timestamps")
    };
    assert_eq!(next.id, second);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_successor_wake_preserves_its_own_retry_floor(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let floor = chrono::DateTime::from_timestamp(chrono::Utc::now().timestamp() + 3600, 0).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload,available_at,blocked_until)
        VALUES ($1,$3,1,'{"kind":"link_changed"}',now(),NULL),
            ($2,$3,1,'{"kind":"link_changed"}',$4,now()+interval '2 hours')
        "#,
        first, second, link, floor
    ).execute(&db).await.unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the head must be claimable")
    };
    repo.finish_projection(&head, None).await.unwrap();
    let row = sqlx::query!(
        "SELECT available_at,blocked_until FROM email_projection_outbox WHERE id=$1",
        second
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.available_at, floor);
    assert!(row.blocked_until.is_none());
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Idle
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_binary_finish_is_recovered_by_the_blocking_deadline(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload)
        VALUES ($1,$3,1,'{"kind":"link_changed"}'),
            ($2,$3,1,'{"kind":"link_changed"}')
        "#,
        first,
        second,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the head must be claimable")
    };
    assert_eq!(head.id, first);
    // The deployed binary deletes a completed head without the new wake.
    sqlx::query!(
        "DELETE FROM email_projection_outbox WHERE id=$1 AND lease_id=$2",
        head.id,
        head.lease_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Idle
    ));
    // Simulate expiry of the labelled jittered rollout backstop, leaving the
    // event's own available_at unchanged.
    sqlx::query!(
        "UPDATE email_projection_outbox SET blocked_until=now() WHERE id=$1",
        second
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(next) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the backstop must recover a successor without an old-binary wake")
    };
    assert_eq!(next.id, second);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_binary_reactivation_recovers_parked_rows_without_changing_backoff(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let id = Uuid::now_v7();
    let future =
        chrono::DateTime::from_timestamp(chrono::Utc::now().timestamp() + 3600, 0).unwrap();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at,available_at,attempts,seq) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}',now(),$3,4,NULL)",
        id,link,future
    ).execute(&db).await.unwrap();
    // The deployed binary knows nothing about the new parking column.
    sqlx::query!(
        "UPDATE email_links SET is_sync_active = false WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_links SET is_sync_active = true WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let page = repo
        .recover_page(64)
        .await
        .unwrap()
        .expect("old-binary activation must recover automatically");
    assert_eq!(page.rows_unparked, 1);
    let row = sqlx::query!(
        "SELECT parked_at,available_at,attempts FROM email_projection_outbox WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.parked_at.is_none());
    assert_eq!(row.available_at, future);
    assert_eq!(row.attempts, 4);
    let next = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,1,'{\"kind\":\"link_changed\"}')",
        next,link
    ).execute(&db).await.unwrap();
    // Expire the fixture's real backoff; recovery itself must not lower it.
    sqlx::query!(
        "UPDATE email_projection_outbox SET available_at=now() WHERE id=$1",
        id
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the recovered legacy head must drain before a new sequence event")
    };
    assert_eq!(head.id, id);
    repo.finish_projection(&head, None).await.unwrap();
    let ProjectionClaim::Acquired(successor) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("a new event must follow the recovered legacy head")
    };
    assert_eq!(successor.id, next);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inactive_hot_projection_link_costs_one_recovery_probe(db: PgPool) {
    let (repo, dead) = fixture_for_provider(&db, crate::domain::models::UserProvider::Gmail).await;

    let (_, active) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false WHERE id=$1",
        dead
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at)
        SELECT gen_random_uuid(),$1,1,'{"kind":"link_changed"}',now() FROM generate_series(1,20002)
        "#,
        dead
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at)
        VALUES ($1,$2,1,'{"kind":"link_changed"}',now())
        "#,
        Uuid::now_v7(),
        active
    )
    .execute(&db)
    .await
    .unwrap();
    let page = repo.recover_page(64).await.unwrap().unwrap();
    assert_eq!(page.links_scanned, 2);
    assert_eq!(page.rows_unparked, 1);
    let dead_rows = sqlx::query_scalar!(
        "SELECT count(*) FROM email_projection_outbox WHERE link_id=$1 AND parked_at IS NOT NULL",
        dead
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(dead_rows, Some(20002));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_parked_work_recovery_page_is_fenced_and_rolls_back_its_cursor(db: PgPool) {
    let (repo, _) = fixture(&db).await;
    let mut owner = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_projection_unpark_sweep FOR UPDATE")
        .fetch_one(&mut *owner)
        .await
        .unwrap();
    assert!(repo.recover_page(64).await.unwrap().is_none());
    sqlx::query!(
        "UPDATE email_projection_unpark_sweep SET link_after=$1",
        Uuid::now_v7()
    )
    .execute(&mut *owner)
    .await
    .unwrap();
    owner.rollback().await.unwrap();
    let cursor = sqlx::query_scalar!("SELECT link_after FROM email_projection_unpark_sweep")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(cursor, Uuid::nil());
    assert!(repo.recover_page(64).await.unwrap().unwrap().complete);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_hot_active_projection_link_recovers_in_bounded_fifo_pages(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at)
        SELECT gen_random_uuid(),$1,1,'{"kind":"link_changed"}',now() FROM generate_series(1,100)
        "#,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let first = repo.recover_page(64).await.unwrap().unwrap();
    assert_eq!(first.rows_unparked, 64);
    assert!(!first.complete);
    let split = sqlx::query!(
        r#"
        SELECT min(seq) FILTER (WHERE parked_at IS NOT NULL) AS parked,
            max(seq) FILTER (WHERE parked_at IS NULL) AS recovered
        FROM email_projection_outbox WHERE link_id=$1
        "#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(split.recovered.unwrap() < split.parked.unwrap());
    let second = repo.recover_page(64).await.unwrap().unwrap();
    assert_eq!(second.rows_unparked, 36);
    assert!(second.complete);
    let due = sqlx::query_scalar!("SELECT available_at>now() FROM email_projection_unpark_sweep")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(due.unwrap());
    assert!(repo.recover_page(64).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_backoff_holds_later_events_of_the_same_entity(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload, available_at)
        VALUES
            ($1, $3, 1, '{"kind":"link_changed"}', now() + interval '1 hour'),
            ($2, $3, 1, '{"kind":"link_changed"}', now())
        "#,
        first,
        second,
        link,
    )
    .execute(&db)
    .await
    .unwrap();

    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Idle | ProjectionClaim::Progress
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_projection_retry_does_not_hold_a_reauthorization_warning(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::from_u128(1);
    let same_thread = Uuid::from_u128(2);
    let other_thread = Uuid::from_u128(3);
    let warning = Uuid::from_u128(4);
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload)
        VALUES ($1,$5,1,'{"kind":"organization","thread_id":"00000000-0000-0000-0000-000000000010"}'),
            ($2,$5,1,'{"kind":"absent","thread_id":"00000000-0000-0000-0000-000000000010","message_id":"00000000-0000-0000-0000-000000000100"}'),
            ($3,$5,1,'{"kind":"absent","thread_id":"00000000-0000-0000-0000-000000000020","message_id":"00000000-0000-0000-0000-000000000200"}'),
            ($4,$5,1,'{"kind":"reauthorization_required"}')
        "#,
        first,
        same_thread,
        other_thread,
        warning,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the first event must be claimable")
    };
    assert_eq!(head.id, first);
    repo.finish_projection(
        &head,
        Some(MessageRetry::After {
            seconds: 300,
            counted: false,
        }),
    )
    .await
    .unwrap();

    for id in [other_thread, warning] {
        let ProjectionClaim::Acquired(next) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
        else {
            panic!("unrelated events must stay claimable during backoff")
        };
        assert_eq!(next.id, id);
        repo.finish_projection(&next, None).await.unwrap();
    }
    assert!(!matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Acquired(_)
    ));
    sqlx::query!(
        "UPDATE email_projection_outbox SET available_at=now() WHERE id=$1",
        first
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(head) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the backing-off head must run again when due")
    };
    assert_eq!(head.id, first);
    repo.finish_projection(&head, None).await.unwrap();
    let ProjectionClaim::Acquired(delete) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("the same-thread deletion must run after its predecessor")
    };
    assert_eq!(delete.id, same_thread);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_row_lock_before_lease_commit_holds_its_successor(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload, available_at)
        VALUES
            ($1, $3, 1, '{"kind":"link_changed"}', now() - interval '1 minute'),
            ($2, $3, 1, '{"kind":"link_changed"}', now())
        "#,
        first,
        second,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let mut earlier_claimer = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_projection_outbox WHERE id = $1 FOR UPDATE",
        first
    )
    .fetch_one(&mut *earlier_claimer)
    .await
    .unwrap();

    // No lease has committed: the earlier unfinished row itself must block B.
    let later = repo.claim_projection(Uuid::now_v7()).await.unwrap();
    earlier_claimer.rollback().await.unwrap();
    assert!(matches!(later, ProjectionClaim::Progress));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_projection_claimer_drains_main_style_rows_for_every_provider(db: PgPool) {
    let (repo, gmail) = fixture_for_provider(&db, crate::domain::models::UserProvider::Gmail).await;

    let (_, imap) = fixture_for_provider(&db, crate::domain::models::UserProvider::Imap).await;

    let (_, outlook) = fixture(&db).await;
    for link in [gmail, imap, outlook] {
        let event = Uuid::now_v7();
        // Omitted routing fields are exactly the insert shape used on main.
        sqlx::query!(
            r#"
            INSERT INTO email_projection_outbox (id, link_id, generation, payload)
            VALUES ($1, $2, 1, '{"kind":"link_changed"}')
            "#,
            event,
            link,
        )
        .execute(&db)
        .await
        .unwrap();
        let ProjectionClaim::Acquired(lease) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
        else {
            panic!("expected a projection lease");
        };
        assert_eq!(lease.id, event);
        assert_eq!(lease.mailbox.link_id, link);
        repo.finish_projection(&lease, None).await.unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_legacy_null_precedes_a_main_style_numbered_insert(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let legacy = Uuid::from_u128(3);
    let numbered = Uuid::from_u128(1);
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload, seq, available_at)
        VALUES ($1, $2, 1, '{"kind":"link_changed"}', NULL, now() + interval '1 hour')
        "#,
        legacy,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let seq = sqlx::query_scalar!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload)
        VALUES ($1, $2, 1, '{"kind":"link_changed"}')
        RETURNING seq
        "#,
        numbered,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(seq.is_some());
    assert!(matches!(
        repo.claim_projection(Uuid::now_v7()).await.unwrap(),
        ProjectionClaim::Progress
    ));
    // Expire only the head's real retry. Finishing it must wake the successor.
    sqlx::query!(
        "UPDATE email_projection_outbox SET available_at = now() WHERE id = $1",
        legacy
    )
    .execute(&db)
    .await
    .unwrap();
    let ProjectionClaim::Acquired(first) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("expected a projection lease");
    };
    assert_eq!(first.id, legacy);
    repo.finish_projection(&first, None).await.unwrap();
    let ProjectionClaim::Acquired(second) = repo.claim_projection(Uuid::now_v7()).await.unwrap()
    else {
        panic!("expected a projection lease");
    };
    assert_eq!(second.id, numbered);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_backed_off_projection_head_cannot_poison_another_links_claim_window(db: PgPool) {
    let (repo, blocked) = fixture(&db).await;
    let ready = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
        VALUES ($1, 'macro|other@example.com', 'other-owner', 'other@example.com', 'OUTLOOK', 1)
        "#,
        ready,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload, available_at)
        VALUES ($1, $2, 1, '{"kind":"link_changed"}', now() + interval '1 hour')
        "#,
        Uuid::now_v7(),
        blocked,
    )
    .execute(&db)
    .await
    .unwrap();
    let siblings = (0..20002).map(|_| Uuid::now_v7()).collect::<Vec<_>>();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload, available_at)
        SELECT id, $2, 1, '{"kind":"link_changed"}', now() - interval '1 hour'
        FROM unnest($1::uuid[]) AS id
        "#,
        &siblings,
        blocked,
    )
    .execute(&db)
    .await
    .unwrap();
    let event = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_projection_outbox (id, link_id, generation, payload)
        VALUES ($1, $2, 1, '{"kind":"link_changed"}')
        "#,
        event,
        ready,
    )
    .execute(&db)
    .await
    .unwrap();

    let mut claimed = None;
    for _ in 0..314 {
        if let ProjectionClaim::Acquired(lease) =
            repo.claim_projection(Uuid::now_v7()).await.unwrap()
        {
            claimed = Some(lease);
            break;
        }
    }
    assert_eq!(claimed.map(|lease| lease.id), Some(event));
}
