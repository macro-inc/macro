use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edit_rearms_a_resting_synced_draft(db: PgPool) {
    let (sync, repo, mut input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    sync.settle_draft(&lease, &checkpoint(&lease, DraftStage::Ready))
        .await
        .unwrap();
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert!(sqlx::query_scalar!("SELECT blocked_until='infinity'::timestamptz AS \"resting!\" FROM email_mailbox_drafts WHERE message_id=$1",input.db_id)
        .fetch_one(&db).await.unwrap());
    input.body_text = Some("Edited after the draft became quiet".into());
    repo.insert_message(
        &input,
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
    let next = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(next.message_id, input.db_id);
    assert_eq!(
        next.input.body_text.as_deref(),
        Some("Edited after the draft became quiet")
    );
    assert_eq!(next.revision, lease.revision + 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn schedule_changes_and_cancel_rearm_without_sending_early(db: PgPool) {
    let (sync, _, input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    sync.settle_draft(&lease, &checkpoint(&lease, DraftStage::Ready))
        .await
        .unwrap();
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now()+interval '1 hour',$3)",link,input.db_id,ACTOR)
        .execute(&db).await.unwrap();
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert!(sqlx::query_scalar!("SELECT d.blocked_until=s.send_time AS \"waits!\" FROM email_mailbox_drafts d JOIN email_scheduled_messages s ON s.message_id=d.message_id WHERE d.message_id=$1",input.db_id)
        .fetch_one(&db).await.unwrap());
    assert!(matches!(
        sync.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Idle
    ));
    sqlx::query!("UPDATE email_scheduled_messages SET send_time=now()-interval '1 second' WHERE message_id=$1",input.db_id)
        .execute(&db).await.unwrap();
    let due = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(due.message_id, input.db_id);
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id=$1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    sync.release_draft(&due, 0).await.unwrap();
    let released = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(
        released.message_id, input.db_id,
        "cancel must not strand a draft revision"
    );
    assert!(matches!(
        sync.start_delivery(&released, &checkpoint(&released, DraftStage::Ready))
            .await
            .unwrap(),
        DeliveryStart::NotDue
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_legacy_null_provider_is_relabelled_before_the_correct_gateway_claims_it(db: PgPool) {
    let (imap, _, input, _) =
        setup_for_provider(&db, false, crate::domain::models::UserProvider::Imap).await;
    // This is the representation of a row inserted before the nullable routing
    // column existed. All new writers derive routing through the trigger.
    sqlx::query!(
        "ALTER TABLE email_mailbox_drafts DISABLE TRIGGER email_mailbox_drafts_derive_provider"
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_drafts SET provider=NULL WHERE message_id=$1",
        input.db_id
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
    let outlook = PgMailboxSync::new(db.clone());
    assert!(matches!(
        outlook
            .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT provider::text FROM email_mailbox_drafts WHERE message_id=$1",
            input.db_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .as_deref(),
        Some("IMAP")
    );
    let lease = imap
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(lease.message_id, input.db_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_parent_provider_change_after_the_window_cannot_route_a_wrong_gateway(db: PgPool) {
    let (outlook, _, input, link) = setup(&db, false).await;
    let mut claim = outlook.mutation_claim_transaction().await.unwrap();
    let window = sqlx::query_file!(
        "src/outbound/mailbox_pg/drafts/claim/window.sql",
        "OUTLOOK",
        true
    )
    .fetch_one(&mut *claim)
    .await
    .unwrap();
    assert!(window.ids.contains(&input.db_id));
    // Unsupported parent mutation is still fenced at the actual acquisition.
    sqlx::query!("UPDATE email_links SET provider='IMAP' WHERE id=$1", link)
        .execute(&db)
        .await
        .unwrap();
    let acquired = sqlx::query_file!(
        "src/outbound/mailbox_pg/drafts/claim/acquire.sql",
        Uuid::now_v7(),
        true,
        "OUTLOOK",
        input.db_id,
        128_i64,
        128_i64
    )
    .fetch_optional(&mut *claim)
    .await
    .unwrap();
    assert!(acquired.is_none());
    claim.commit().await.unwrap();
    assert!(matches!(
        outlook
            .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap(),
        SyncClaim::Progress
    ));
    let imap = PgMailboxSync::new(db).with_provider(crate::domain::models::UserProvider::Imap);
    assert_eq!(
        imap.claim_draft(Uuid::now_v7(), DraftClaimMode::All)
            .await
            .unwrap()
            .into_lease()
            .unwrap()
            .message_id,
        input.db_id
    );
}
