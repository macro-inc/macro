use super::*;

async fn ready(pool: &PgPool, name: &str) -> (PgMessagingRepository, Connection, Uuid) {
    let (team, user) = team(pool, name).await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(&connection(team, user.clone(), name), b"test", None)
        .await
        .unwrap();
    repo.health(&c, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let channel = channel(pool, &user).await;
    (repo, c, channel)
}
async fn queued(repo: &PgMessagingRepository, c: &Connection, channel: Uuid) -> SendProgress {
    let request = reply();
    bind_conversation(repo, c, channel).await;
    repo.enqueue_send(
        c.id,
        channel,
        &c.user_id,
        &request,
        &Sha256::digest(serde_json::to_vec(&request).unwrap()),
    )
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unattempted_crash_retries_but_a_crash_after_the_fence_never_does(pool: PgPool) {
    let (repo, c, channel) = ready(&pool, "attempt-markers").await;
    let send = queued(&repo, &c, channel).await;
    let unattempted = repo.claim_send().await.unwrap().unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_send SET lease_until=now()-interval '1 second' WHERE id=$1",
        send.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(retry.lease.id, send.id);
    assert_ne!(retry.lease.token, unattempted.lease.token);
    assert!(
        repo.prepare_send(
            &unattempted.lease,
            &(&c).into(),
            &conversation(&c, channel),
            "stale"
        )
        .await
        .is_err()
    );
    repo.prepare_send(
        &retry.lease,
        &(&c).into(),
        &conversation(&c, channel),
        "authorized, not proof of delivery",
    )
    .await
    .unwrap();
    assert!(
        repo.prepare_send(
            &retry.lease,
            &(&c).into(),
            &conversation(&c, channel),
            "cannot fence twice"
        )
        .await
        .is_err()
    );
    sqlx::query!("UPDATE meta_messaging_send SET created_at=now()-interval '11 minutes',lease_until=now()-interval '1 second' WHERE id=$1",send.id).execute(&pool).await.unwrap();
    assert!(repo.claim_send().await.unwrap().is_none());
    let state = repo.sends(channel).await.unwrap();
    assert_eq!(state[0].state, DeliveryState::Unknown);
    assert_ne!(state[0].error_code.as_deref(), Some("send_expired"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_unattempted_claim_fails_and_rejects_its_old_worker(pool: PgPool) {
    let (repo, c, channel) = ready(&pool, "old-worker").await;
    let send = queued(&repo, &c, channel).await;
    let work = repo.claim_send().await.unwrap().unwrap();
    // No dispatch fence was crossed; expiration can safely fail this intent.
    sqlx::query!("UPDATE meta_messaging_send SET lease_until=now()-interval '1 second',created_at=now()-interval '20 minutes' WHERE id=$1",send.id).execute(&pool).await.unwrap();
    assert!(repo.claim_send().await.unwrap().is_none());
    assert_eq!(
        repo.sends(channel).await.unwrap()[0].state,
        DeliveryState::Failed
    );
    assert!(
        repo.prepare_send(
            &work.lease,
            &(&c).into(),
            &conversation(&c, channel),
            "stale"
        )
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn definitive_retry_keeps_original_deadline_and_expiry_releases_the_conversation(
    pool: PgPool,
) {
    let (repo, c, channel) = ready(&pool, "retry-expiry").await;
    let first = queued(&repo, &c, channel).await;
    let work = repo.claim_send().await.unwrap().unwrap();
    repo.prepare_send(
        &work.lease,
        &(&c).into(),
        &conversation(&c, channel),
        "rate limited",
    )
    .await
    .unwrap();
    repo.settle_send(
        &work.lease,
        DeliveryState::Pending,
        None,
        Some("provider_rate_limit"),
        Some(3600),
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_send SET created_at=now()-interval '11 minutes' WHERE id=$1",
        first.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let second = queued(&repo, &c, channel).await;
    let next = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(
        next.lease.id, second.id,
        "expiry wins even when the earlier retry is not available yet"
    );
    let progress = repo.sends(channel).await.unwrap();
    let expired = progress.iter().find(|s| s.id == first.id).unwrap();
    assert_eq!(expired.state, DeliveryState::Failed);
    assert_eq!(expired.error_code.as_deref(), Some("send_expired"));
    let marker = sqlx::query_scalar!(
        "SELECT dispatch_started_at FROM meta_messaging_send WHERE id=$1",
        first.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(marker.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fence_uses_database_time_after_waiting_for_the_account_lock(pool: PgPool) {
    let (repo, c, channel) = ready(&pool, "expiry-fence").await;
    let send = queued(&repo, &c, channel).await;
    let work = repo.claim_send().await.unwrap().unwrap();
    let mut lock = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM meta_messaging_connection WHERE id=$1 FOR UPDATE",
        c.id
    )
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    sqlx::query!("UPDATE meta_messaging_send SET created_at=clock_timestamp()-interval '10 minutes'+interval '200 milliseconds' WHERE id=$1",send.id).execute(&mut *lock).await.unwrap();
    let worker = repo.clone();
    let scope = (&c).into();
    let lease = work.lease.clone();
    let mut fence = tokio::spawn(async move {
        worker
            .prepare_send(
                &lease,
                &scope,
                &conversation(&c, channel),
                "expired during account wait",
            )
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut fence)
            .await
            .is_err()
    );
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    lock.commit().await.unwrap();
    assert_eq!(
        *fence.await.unwrap().unwrap_err().current_context(),
        MessagingError::SendExpired
    );
    let state = repo.sends(channel).await.unwrap();
    assert_eq!(state[0].error_code.as_deref(), Some("send_expired"));
    assert!(
        repo.settle_send(
            &work.lease,
            DeliveryState::Accepted,
            Some(&"never-sent".to_owned().try_into().unwrap()),
            None,
            None
        )
        .await
        .is_err()
    );
}

async fn receipt(repo: &PgMessagingRepository, name: &str) -> ReceiptWork {
    let body = serde_json::json!({"object":"instagram","entry":[],"diagnostic":name});
    repo.accept_receipt(Provider::Instagram, &Sha256::digest(name), &body)
        .await
        .unwrap();
    repo.claim_receipt().await.unwrap().unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_distinguishes_completion_partial_decode_and_active_leases(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    let complete = receipt(&repo, "complete").await;
    repo.settle_receipt(&complete.lease, None, None)
        .await
        .unwrap();
    sqlx::query!("UPDATE meta_messaging_receipt SET created_at=now()-interval '10 days',completed_at=now()-interval '8 days' WHERE id=$1",complete.lease.id).execute(&pool).await.unwrap();
    let partial = receipt(&repo, "partial").await;
    repo.record_receipt_decode_failures(&partial.lease, 1)
        .await
        .unwrap();
    repo.settle_receipt(&partial.lease, None, None)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET created_at=now()-interval '10 days' WHERE id=$1",
        partial.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let active = receipt(&repo, "active").await;
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days' WHERE id=$1",
        active.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let counts = repo.cleanup_receipts().await.unwrap();
    assert_eq!(counts.payloads_cleared, 1);
    assert_eq!(counts.receipts_deleted, 0);
    let old = sqlx::query!(
        "SELECT payload,payload_cleared_at FROM meta_messaging_receipt WHERE id=$1",
        complete.lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(old.payload.is_null());
    assert!(old.payload_cleared_at.is_some());
    for id in [partial.lease.id, active.lease.id] {
        assert!(
            sqlx::query_scalar!(
                "SELECT payload_cleared_at FROM meta_messaging_receipt WHERE id=$1",
                id
            )
            .fetch_one(&pool)
            .await
            .unwrap()
            .is_none()
        );
    }
    assert!(
        !repo.heartbeat_receipt(&active.lease).await.unwrap(),
        "a lease cannot extend raw retention forever"
    );
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET lease_until=now()-interval '1 second' WHERE id=$1",
        active.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let counts = repo.cleanup_receipts().await.unwrap();
    assert_eq!(counts.work_expired, 1);
    assert_eq!(counts.receipts_deleted, 1);
    assert!(!repo.heartbeat_receipt(&active.lease).await.unwrap());
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days' WHERE id=ANY($1)",
        &[partial.lease.id, complete.lease.id]
    )
    .execute(&pool)
    .await
    .unwrap();
    let counts = repo.cleanup_receipts().await.unwrap();
    assert_eq!(counts.payloads_cleared, 1);
    assert_eq!(counts.receipts_deleted, 2);
    assert!(!repo.cleanup_receipts().await.unwrap().changed());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn late_success_keeps_seven_days_before_metadata_removal(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    let work = receipt(&repo, "late-success").await;
    repo.settle_receipt(&work.lease, None, None).await.unwrap();
    sqlx::query!("UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days',completed_at=now()-interval '2 days' WHERE id=$1", work.lease.id).execute(&pool).await.unwrap();
    assert!(!repo.cleanup_receipts().await.unwrap().changed());
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET completed_at=now()-interval '8 days' WHERE id=$1",
        work.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let counts = repo.cleanup_receipts().await.unwrap();
    assert_eq!(counts.payloads_cleared, 1);
    assert_eq!(counts.receipts_deleted, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_does_not_treat_a_raw_json_null_as_an_already_cleared_receipt(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    repo.accept_receipt(
        Provider::Instagram,
        &Sha256::digest(b"null"),
        &serde_json::Value::Null,
    )
    .await
    .unwrap();
    let work = repo.claim_receipt().await.unwrap().unwrap();
    repo.settle_receipt(&work.lease, Some("invalid_provider_payload"), None)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days' WHERE id=$1",
        work.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let counts = repo.cleanup_receipts().await.unwrap();
    assert_eq!(counts.payloads_cleared, 1);
    assert_eq!(counts.receipts_deleted, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_is_bounded_and_retries_do_not_extend_the_original_deadline(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    for n in 0..1002 {
        repo.accept_receipt(
            Provider::Instagram,
            &Sha256::digest(format!("bounded-{n}")),
            &serde_json::json!({"object":"instagram","entry":[]}),
        )
        .await
        .unwrap();
    }
    sqlx::query!("UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days',available_at=now()+interval '1 hour',attempts=20").execute(&pool).await.unwrap();
    let first = repo.cleanup_receipts().await.unwrap();
    assert_eq!(first.payloads_cleared, 500);
    assert_eq!(first.receipts_deleted, 500);
    assert_eq!(first.work_expired, 500);
    let second = repo.cleanup_receipts().await.unwrap();
    assert_eq!(second.receipts_deleted, 500);
    assert_eq!(repo.cleanup_receipts().await.unwrap().receipts_deleted, 2);
    assert!(!repo.cleanup_receipts().await.unwrap().changed());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dispatch_fence_rejects_a_retired_phone_even_when_bsuid_is_unchanged(pool: PgPool) {
    let (repo, c, channel) = ready(&pool, "routing-fence").await;
    queued(&repo, &c, channel).await;
    let work = repo.claim_send().await.unwrap().unwrap();
    let stale = repo.conversation(channel).await.unwrap().unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_conversation SET customer_phone='15550000002' WHERE channel_id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        *repo
            .prepare_send(&work.lease, &(&c).into(), &stale, "stale destination")
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Unavailable
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT dispatch_started_at FROM meta_messaging_send WHERE id=$1",
            work.lease.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .is_none()
    );
    let current = repo.conversation(channel).await.unwrap().unwrap();
    repo.prepare_send(
        &work.lease,
        &(&c).into(),
        &current,
        "verified current destination",
    )
    .await
    .unwrap();
}
