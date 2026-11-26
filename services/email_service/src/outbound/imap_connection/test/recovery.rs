use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fresh_reservation_and_live_interactive_lease_stay_out_of_recovery(db: PgPool) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    assert!(repo.claim_pending().await.unwrap().is_none());

    let interactive = repo.lease(&attempt).await.unwrap();
    // Explicitly make the recovery floor due; the still-live nonce must exclude it.
    sqlx::query!(
        "UPDATE email_imap_connection_attempts SET recovery_at = now() - interval '1 second' WHERE id = $1",
        attempt.id,
    ).execute(&db).await.unwrap();
    assert!(repo.claim_pending().await.unwrap().is_none());
    assert!(matches!(
        repo.lease(&attempt).await,
        Err(ImapConnectionError::Changed)
    ));
    repo.defer(&interactive, chrono::Duration::minutes(1))
        .await
        .unwrap();
    assert!(repo.claim_pending().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_nonce_cannot_activate_abandon_or_defer_the_new_owner(db: PgPool) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    let stale = repo.lease(&attempt).await.unwrap();
    // Lease expiry is a fixture transition, without waiting for wall-clock time.
    sqlx::query!(
        "UPDATE email_imap_connection_attempts SET lease_until = now() - interval '1 second', recovery_at = now() - interval '1 second' WHERE id = $1",
        attempt.id,
    ).execute(&db).await.unwrap();
    let current = repo.claim_pending().await.unwrap().unwrap();
    assert_ne!(stale.nonce, current.nonce);
    assert!(matches!(
        repo.activate(&stale).await,
        Err(ImapConnectionError::Changed)
    ));
    assert!(matches!(
        repo.abandon(&stale).await,
        Err(ImapConnectionError::Changed)
    ));
    assert!(matches!(
        repo.defer(&stale, chrono::Duration::minutes(30)).await,
        Err(ImapConnectionError::Changed)
    ));
    assert!(repo.attempt(&actor, attempt.id).await.unwrap().is_some());
    assert_eq!(
        repo.activate(&current).await.unwrap(),
        attempt.binding.link_id
    );
    // A late credential refusal from the old worker cannot remove the promotion.
    assert!(matches!(
        repo.abandon(&stale).await,
        Err(ImapConnectionError::Changed)
    ));
    let completed = repo.attempt(&actor, attempt.id).await.unwrap().unwrap();
    assert!(completed.completed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovery_skips_a_locked_attempt_and_claims_the_next_without_waiting(db: PgPool) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    // A second pending link models an unrelated account; this table deliberately
    // stores only a binding, with no link foreign key or plaintext credentials.
    sqlx::query!(
        r#"
        INSERT INTO email_imap_connection_attempts
            (id, user_id, credential_owner, email, link_id, verification_id, sync_generation, grant_generation, recovery_at)
        VALUES ($1, $2, 'owner', 'owner@example.com', $3, $4, 1, 1, now() - interval '1 minute')
        "#,
        Uuid::from_u128(9),
        actor.as_ref(),
        Uuid::from_u128(10),
        verification.id,
    ).execute(&db).await.unwrap();
    sqlx::query!(
        "UPDATE email_imap_connection_attempts SET recovery_at = now() - interval '2 minutes' WHERE id = $1",
        attempt.id,
    ).execute(&db).await.unwrap();
    let mut locker = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_imap_connection_attempts WHERE id = $1 FOR UPDATE",
        attempt.id
    )
    .fetch_one(&mut *locker)
    .await
    .unwrap();
    let claimed = repo.claim_pending().await.unwrap().unwrap();
    assert_eq!(claimed.attempt.id, Uuid::from_u128(9));
    locker.commit().await.unwrap();
    assert_eq!(
        repo.claim_pending().await.unwrap().unwrap().attempt.id,
        attempt.id
    );
}
