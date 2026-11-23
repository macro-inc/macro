//! Projection ordering must survive both row-lock and retry windows.
use super::*;
use crate::domain::mailbox::projection::MailboxProjectionRepository;
use crate::domain::mailbox::projection::ProjectionClaim;
use crate::domain::mailbox::projection_recovery::ProjectionRecoveryRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_slow_projection_unpark_halves_within_the_wrap_until_it_fits(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_projection_outbox (id,link_id,generation,payload,parked_at) SELECT gen_random_uuid(),$1,1,'{\"kind\":\"link_changed\"}',now() FROM generate_series(1,64)",
        link
    ).execute(&db).await.unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_large_attempt")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_medium_attempt")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!("CREATE SEQUENCE unpark_small_attempt")
        .execute(&db)
        .await
        .unwrap();
    // Sequences survive savepoint rollback, exposing the attempted page sizes.
    sqlx::query!(
        r#"
        CREATE FUNCTION projection_unpark_budget() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE amount bigint;
        BEGIN
            SELECT count(*) INTO amount FROM updated_rows;
            IF amount>32 THEN
                PERFORM nextval('unpark_large_attempt'); PERFORM pg_sleep(0.4);
            ELSIF amount>16 THEN
                PERFORM nextval('unpark_medium_attempt'); PERFORM pg_sleep(0.4);
            ELSE PERFORM nextval('unpark_small_attempt');
            END IF;
            RETURN NULL;
        END $$
        "#
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "CREATE TRIGGER projection_unpark_budget AFTER UPDATE ON email_projection_outbox REFERENCING OLD TABLE AS updated_rows FOR EACH STATEMENT EXECUTE FUNCTION projection_unpark_budget()"
    ).execute(&db).await.unwrap();
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
        "64 and 32 must time out before a smaller attempt drains the link"
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
async fn a_projection_recovery_page_is_fenced_and_rolls_back_its_cursor(db: PgPool) {
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
async fn projection_backoff_holds_later_events_of_the_same_link(db: PgPool) {
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
        VALUES ($1, $2, 1, '{"kind":"attachment_recheck","message_id":"00000000-0000-0000-0000-000000000001"}')
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
