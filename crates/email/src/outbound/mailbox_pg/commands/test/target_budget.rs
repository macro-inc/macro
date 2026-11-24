use super::*;
use crate::domain::models::mailbox_action::MailboxActionTarget;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_modern_command_that_cannot_fit_a_fresh_budget_fails_loudly(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let targets = super::action_groups::targets(&db, work.mailbox.link_id, thread, 65).await;
    let id = command(&db, work.mailbox.link_id, &targets, -60.0).await;
    sqlx::query!(
        "UPDATE email_mailbox_commands SET action_id=id WHERE id=$1",
        id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await,
        Err(MailboxError::Persistence)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_intent_is_reconsidered_after_a_finite_local_floor(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let targets = super::action_groups::targets(&db, work.mailbox.link_id, thread, 1).await;
    let id = command(&db, work.mailbox.link_id, &targets, -60.0).await;
    sqlx::query!(
        "UPDATE email_mailbox_commands SET intent='{}' WHERE id=$1",
        id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    assert!(sqlx::query_scalar!(r#"SELECT blocked_until>now() AND blocked_until<=now()+interval '60 seconds' AS "finite!" FROM email_mailbox_commands WHERE id=$1"#, id)
        .fetch_one(&db).await.unwrap());
    // Model only timer expiry. A later reader must receive this unchanged
    // intent again so it can recognize the newly supported kind.
    sqlx::query!(
        "UPDATE email_mailbox_commands SET blocked_until=now()-interval '1 second' WHERE id=$1",
        id
    )
    .execute(&db)
    .await
    .unwrap();
    let mut tx = sync.mutation_claim_transaction().await.unwrap();
    let window = CommandClaim {
        lease_id: Uuid::now_v7(),
        provider: sync.provider,
    }
    .window(&mut tx)
    .await
    .unwrap();
    assert!(window.ids.contains(&id));
    tx.rollback().await.unwrap();
}

async fn command(db: &PgPool, link: Uuid, targets: &[MailboxActionTarget], delay: f64) -> Uuid {
    let id = Uuid::now_v7();
    let actor = owner();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_commands(id,link_id,generation,actor_id,intent,status,available_at)
            VALUES($1,$2,1,$3,'{"kind":"flagged","value":true}','pending',now()+make_interval(secs=>$4))"#,
        id,
        link,
        actor.as_ref(),
        delay,
    )
    .execute(db).await.unwrap();
    let ids: Vec<_> = targets.iter().map(|target| target.message_id).collect();
    let providers: Vec<_> = targets
        .iter()
        .map(|target| target.provider_id.clone().unwrap())
        .collect();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_command_targets(command_id,message_id,provider_id)
            SELECT $1,input.id,input.provider FROM unnest($2::uuid[],$3::text[]) input(id,provider)"#,
        id,
        &ids,
        &providers,
    ).execute(db).await.unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_spent_target_budget_yields_before_the_next_eligible_command(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let first = super::action_groups::targets(&db, work.mailbox.link_id, thread, 64).await;
    let second = super::action_groups::targets(&db, work.mailbox.link_id, thread, 64).await;
    let third = super::action_groups::targets(&db, work.mailbox.link_id, thread, 1).await;
    command(&db, work.mailbox.link_id, &first[63..], 3600.0).await;
    let blocked_first = command(&db, work.mailbox.link_id, &first, -180.0).await;
    command(&db, work.mailbox.link_id, &second[63..], 3600.0).await;
    let blocked_second = command(&db, work.mailbox.link_id, &second, -120.0).await;
    let eligible = command(&db, work.mailbox.link_id, &third, -60.0).await;
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    for id in [blocked_first, blocked_second] {
        assert!(sqlx::query_scalar!(r#"SELECT blocked_until>now() AS "blocked!" FROM email_mailbox_commands WHERE id=$1"#,id).fetch_one(&db).await.unwrap());
    }
    assert_eq!(
        sync.claim_command(Uuid::now_v7())
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .id,
        eligible
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_blocked_legacy_wide_command_is_skipped_until_its_backstop(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let wide = super::action_groups::targets(&db, work.mailbox.link_id, thread, 5000).await;
    let small = super::action_groups::targets(&db, work.mailbox.link_id, thread, 1).await;
    let predecessor = command(&db, work.mailbox.link_id, &wide[4999..], 3600.0).await;
    let legacy = command(&db, work.mailbox.link_id, &wide, -120.0).await;
    let following = command(&db, work.mailbox.link_id, &small, -60.0).await;
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    let floor = sqlx::query_scalar!(
        "SELECT blocked_until FROM email_mailbox_commands WHERE id=$1",
        legacy
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(floor.is_some());
    assert_eq!(
        sync.claim_command(Uuid::now_v7())
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .id,
        following
    );
    for _ in 0..3 {
        assert!(matches!(
            sync.claim_command(Uuid::now_v7()).await.unwrap(),
            SyncClaim::Idle
        ));
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT blocked_until FROM email_mailbox_commands WHERE id=$1",
                legacy
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            floor
        );
    }
    sqlx::query!(
        "UPDATE email_mailbox_commands SET blocked_until=now()-interval '1 second' WHERE id=$1",
        legacy
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    sqlx::query!(
        "UPDATE email_mailbox_commands SET status='succeeded' WHERE id=$1",
        predecessor
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET blocked_until=now()-interval '1 second' WHERE id=$1",
        legacy
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        sync.claim_command(Uuid::now_v7())
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .id,
        legacy
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn forty_eight_blocked_candidates_stay_inside_one_transaction_deadline(db: PgPool) {
    let (sync, _, work, thread) = setup(&db).await;
    let target = super::action_groups::targets(&db, work.mailbox.link_id, thread, 1).await;
    command(&db, work.mailbox.link_id, &target, 3600.0).await;
    let mut ids = Vec::new();
    for _ in 0..48 {
        ids.push(command(&db, work.mailbox.link_id, &target, -60.0).await);
    }
    // A deployed writer left these routing fields NULL. Disable only this
    // fixture's routing hook while recreating that pre-migration state.
    let mut legacy = db.begin().await.unwrap();
    sqlx::query!(
        "ALTER TABLE email_mailbox_commands DISABLE TRIGGER email_mailbox_commands_derive_provider"
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET provider=NULL WHERE id=ANY($1)",
        &ids[32..]
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    sqlx::query!(
        "ALTER TABLE email_mailbox_commands ENABLE TRIGGER email_mailbox_commands_derive_provider"
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    legacy.commit().await.unwrap();
    let began = std::time::Instant::now();
    assert!(matches!(
        sync.claim_command(Uuid::now_v7()).await.unwrap(),
        SyncClaim::Progress
    ));
    eprintln!(
        "native worst command window: candidates=48, elapsed_ms={}",
        began.elapsed().as_millis()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_mailbox_commands WHERE id=ANY($1) AND blocked_until>now()",
            &ids
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(48)
    );
}
