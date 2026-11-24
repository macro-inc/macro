use super::*;

async fn leased_commands(db: &PgPool, link: Uuid, targets: &[Uuid], count: usize) -> Vec<Uuid> {
    let ids: Vec<_> = (0..count).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(r#"
        INSERT INTO email_mailbox_commands(id,link_id,generation,actor_id,intent,status,lease_id,lease_until)
        SELECT id,$2,1,$3,'{"kind":"flagged","value":true}','running',id,now()+interval '3 minutes'
        FROM unnest($1::uuid[]) input(id)
    "#, &ids,link,ACTOR).execute(db).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_mailbox_command_targets(command_id,message_id,provider_id)
        SELECT c.id,m.id,m.provider_id FROM email_mailbox_commands c CROSS JOIN email_messages m
        WHERE c.id=ANY($1::uuid[]) AND m.id=ANY($2::uuid[])
    "#,
        &ids,
        targets
    )
    .execute(db)
    .await
    .unwrap();
    ids
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_spent_exclusion_budget_yields_before_the_next_draft(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let second = second_draft(&db, &repo, &input, link).await;
    let third = second_draft(&db, &repo, &input, link).await;
    let ids = [input.db_id, second, third];
    sqlx::query!(
        r#"UPDATE email_mailbox_drafts SET available_at=now()-make_interval(secs=>
        CASE WHEN message_id=$1 THEN 180.0 WHEN message_id=$2 THEN 120.0 ELSE 60.0 END)
        WHERE message_id=ANY($3::uuid[])"#,
        input.db_id,
        second,
        &ids
    )
    .execute(&db)
    .await
    .unwrap();
    leased_commands(&db, link, &ids[..2], 64).await;
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_drafts WHERE message_id=ANY($1) AND blocked_until>now()",&ids[..2])
        .fetch_one(&db).await.unwrap(),Some(2));
    assert_eq!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .message_id,
        third
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_overflowed_lease_scope_rearms_after_orphaned_leases_expire(db: PgPool) {
    let (sync, _, input, link) =
        setup_for_provider(&db, false, crate::domain::models::UserProvider::Imap).await;
    let other = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_messages(id,link_id,thread_id,provider_id)
        SELECT $1,link_id,thread_id,'budget-other' FROM email_messages WHERE id=$2"#,
        other,
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    let commands = leased_commands(&db, link, &[other], 129).await;
    let before = sqlx::query!(
        "SELECT available_at,lease_id,lease_until FROM email_mailbox_drafts WHERE message_id=$1",
        input.db_id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    let after = sqlx::query!("SELECT available_at,lease_id,lease_until,blocked_until FROM email_mailbox_drafts WHERE message_id=$1",input.db_id)
        .fetch_one(&db).await.unwrap();
    assert_eq!(after.available_at, before.available_at);
    assert_eq!(after.lease_id, before.lease_id);
    assert_eq!(after.lease_until, before.lease_until);
    assert!(after.blocked_until.is_some());
    assert!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .is_none()
    );
    sqlx::query!(
        "UPDATE email_mailbox_commands SET lease_until=now()-interval '1 second' WHERE id=ANY($1)",
        &commands[..2]
    )
    .execute(&db)
    .await
    .unwrap();
    // Model the local timer without sleeping; the real retry/lease floors stay intact.
    sqlx::query!("UPDATE email_mailbox_drafts SET blocked_until=now()-interval '1 second' WHERE message_id=$1",input.db_id)
        .execute(&db).await.unwrap();
    assert_eq!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .message_id,
        input.db_id
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sixty_four_resting_drafts_stay_inside_one_transaction_deadline(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let mut ids = vec![input.db_id];
    for _ in 1..64 {
        let next = ResolvedDraftInput {
            db_id: Uuid::now_v7(),
            ..input.clone()
        };
        repo.insert_message(
            &next,
            &UpsertedContacts {
                from_contact_id: None,
                recipients: Vec::new(),
            },
            link,
            None,
            true,
        )
        .await
        .unwrap()
        .unwrap();
        ids.push(next.db_id);
    }
    sqlx::query!("UPDATE email_mailbox_drafts SET state='synced',available_at=now()-interval '1 minute' WHERE message_id=ANY($1)",&ids)
        .execute(&db).await.unwrap();
    // Recreate only the routing state left by a deployed writer.
    sqlx::query!(
        "ALTER TABLE email_mailbox_drafts DISABLE TRIGGER email_mailbox_drafts_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET provider=NULL WHERE message_id=ANY($1)",
        &ids[32..]
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "ALTER TABLE email_mailbox_drafts ENABLE TRIGGER email_mailbox_drafts_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    let began = std::time::Instant::now();
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    eprintln!(
        "native worst draft window: candidates=64, elapsed_ms={}",
        began.elapsed().as_millis()
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_drafts WHERE message_id=ANY($1) AND blocked_until='infinity'::timestamptz AND lease_id IS NULL",&ids)
        .fetch_one(&db).await.unwrap(),Some(64));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_scope_that_does_not_fit_the_remainder_waits_for_a_fresh_budget(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, false).await;
    let mut ids = vec![input.db_id];
    for _ in 1..43 {
        let next = ResolvedDraftInput {
            db_id: Uuid::now_v7(),
            ..input.clone()
        };
        repo.insert_message(
            &next,
            &UpsertedContacts {
                from_contact_id: None,
                recipients: Vec::new(),
            },
            link,
            None,
            true,
        )
        .await
        .unwrap()
        .unwrap();
        ids.push(next.db_id);
    }
    sqlx::query!("UPDATE email_mailbox_drafts SET available_at=now()-make_interval(secs=>1000.0-array_position($1::uuid[],message_id)) WHERE message_id=ANY($1)",&ids)
        .execute(&db).await.unwrap();
    sqlx::query!(
        "ALTER TABLE email_mailbox_drafts DISABLE TRIGGER email_mailbox_drafts_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET provider=NULL WHERE message_id=ANY($1)",
        &ids[32..]
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "ALTER TABLE email_mailbox_drafts ENABLE TRIGGER email_mailbox_drafts_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    leased_commands(&db, link, &ids[..42], 3).await;
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_drafts WHERE message_id=ANY($1) AND blocked_until>now()",&ids[..42])
        .fetch_one(&db).await.unwrap(),Some(42));
    assert!(
        sqlx::query_scalar!(
            "SELECT blocked_until FROM email_mailbox_drafts WHERE message_id=$1",
            ids[42]
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .is_none()
    );
    assert_eq!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .message_id,
        ids[42]
    );
}
