use super::*;

async fn enqueue(repo: &PgMessagingRepository, c: &Connection, channel: Uuid) -> SendProgress {
    let reply = reply();
    repo.enqueue_send(
        c.id,
        channel,
        &c.user_id,
        &reply,
        &Sha256::digest(serde_json::to_vec(&reply).unwrap()),
    )
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claims_are_account_fair_and_conversation_fifo_through_retry_and_uncertainty(pool: PgPool) {
    let (team, user) = team(&pool, "fair-sends").await;
    let repo = PgMessagingRepository::new(pool.clone());
    let slow = repo
        .connect(&connection(team, user.clone(), "slow"), b"test", None)
        .await
        .unwrap();
    let healthy = repo
        .connect(&connection(team, user.clone(), "healthy"), b"test", None)
        .await
        .unwrap();
    let channels = [
        channel(&pool, &user).await,
        channel(&pool, &user).await,
        channel(&pool, &user).await,
    ];
    let first = enqueue(&repo, &slow, channels[0]).await;
    let later = enqueue(&repo, &slow, channels[0]).await;
    let parallel = enqueue(&repo, &slow, channels[1]).await;
    let capped = enqueue(&repo, &slow, channels[2]).await;
    let good = enqueue(&repo, &healthy, channel(&pool, &user).await).await;
    let claims = tokio::join!(
        repo.claim_send(),
        repo.claim_send(),
        repo.claim_send(),
        repo.claim_send()
    );
    let work: Vec<_> = [claims.0, claims.1, claims.2, claims.3]
        .into_iter()
        .filter_map(|r| r.unwrap())
        .collect();
    assert_eq!(
        work.len(),
        3,
        "two slots for slow account, one for healthy; no duplicate claims"
    );
    assert!(work.iter().any(|w| w.lease.id == good.id));
    assert!(work.iter().any(|w| w.lease.id == parallel.id));
    assert!(
        !work
            .iter()
            .any(|w| w.lease.id == later.id || w.lease.id == capped.id)
    );
    let first_work = work.iter().find(|w| w.lease.id == first.id).unwrap();
    repo.settle_send(
        &first_work.lease,
        DeliveryState::Pending,
        None,
        Some("rate_limit"),
        Some(60),
    )
    .await
    .unwrap();
    let capped_work = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(
        capped_work.lease.id, capped.id,
        "a different conversation progresses during the retry"
    );
    assert!(
        repo.claim_send().await.unwrap().is_none(),
        "later same-conversation reply cannot overtake the retry"
    );
    for w in work
        .iter()
        .filter(|w| w.lease.id != first.id)
        .chain(std::iter::once(&capped_work))
    {
        repo.settle_send(
            &w.lease,
            DeliveryState::Unknown,
            None,
            Some("uncertain"),
            None,
        )
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE meta_messaging_send SET available_at=now() WHERE id=$1",
        first.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(retry.lease.id, first.id);
    repo.settle_send(
        &retry.lease,
        DeliveryState::Unknown,
        None,
        Some("uncertain"),
        None,
    )
    .await
    .unwrap();
    let next = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(
        next.lease.id, later.id,
        "uncertain outcome settles dispatch without optional delivery receipts"
    );
    repo.settle_send(
        &next.lease,
        DeliveryState::Failed,
        None,
        Some("rejected"),
        None,
    )
    .await
    .unwrap();
    assert!(
        repo.claim_send().await.unwrap().is_none(),
        "Unknown is never automatically retried"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn equal_enqueue_times_use_id_order_and_expired_attempt_releases_the_conversation(
    pool: PgPool,
) {
    let (team, user) = team(&pool, "tied-sends").await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(&connection(team, user.clone(), "tie"), b"test", None)
        .await
        .unwrap();
    let channel = channel(&pool, &user).await;
    let a = enqueue(&repo, &c, channel).await;
    let b = enqueue(&repo, &c, channel).await;
    sqlx::query!(
        "UPDATE meta_messaging_send SET created_at=$2 WHERE channel_id=$1",
        channel,
        a.created_at
    )
    .execute(&pool)
    .await
    .unwrap();
    let first = repo.claim_send().await.unwrap().unwrap();
    repo.health(&c, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    repo.prepare_send(&first.lease, &(&c).into(), "Attempted before lease expiry")
        .await
        .unwrap();
    assert_eq!(first.lease.id, a.id.min(b.id));
    assert!(repo.claim_send().await.unwrap().is_none());
    sqlx::query!(
        "UPDATE meta_messaging_send SET lease_until=now()-interval '1 second' WHERE id=$1",
        first.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let next = repo.claim_send().await.unwrap().unwrap();
    assert_eq!(next.lease.id, a.id.max(b.id));
    assert!(
        repo.settle_send(
            &first.lease,
            DeliveryState::Accepted,
            Some(&"late".to_owned().try_into().unwrap()),
            None,
            None
        )
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn receipt_claims_cap_a_slow_account_but_do_not_block_a_healthy_one(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool);
    for (n, account) in ["slow", "slow", "slow", "healthy"].into_iter().enumerate() {
        let payload = serde_json::json!({"object":"instagram","entry":[{"id":account}]});
        repo.accept_receipt(
            Provider::Instagram,
            &Sha256::digest(n.to_string()),
            &payload,
        )
        .await
        .unwrap();
    }
    let claims = tokio::join!(
        repo.claim_receipt(),
        repo.claim_receipt(),
        repo.claim_receipt(),
        repo.claim_receipt()
    );
    let work: Vec<_> = [claims.0, claims.1, claims.2, claims.3]
        .into_iter()
        .filter_map(|r| r.unwrap())
        .collect();
    assert_eq!(work.len(), 3);
    assert_eq!(
        work.iter()
            .filter(|w| w.payload["entry"][0]["id"] == "slow")
            .count(),
        2
    );
    assert_eq!(
        work.iter()
            .filter(|w| w.payload["entry"][0]["id"] == "healthy")
            .count(),
        1
    );
    let ids: std::collections::HashSet<_> = work.iter().map(|w| w.lease.id).collect();
    assert_eq!(ids.len(), work.len());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn account_failure_settled_after_concurrent_reconnects_recovers_without_another_reconnect(
    pool: PgPool,
) {
    let (team, user) = team(&pool, "receipt-timing").await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(&connection(team, user, "phone"), b"test", None)
        .await
        .unwrap();
    let payload = serde_json::json!({"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"phone"}}}]}]});
    repo.accept_receipt(Provider::Whatsapp, &Sha256::digest(b"race"), &payload)
        .await
        .unwrap();
    let old = repo.claim_receipt().await.unwrap().unwrap();
    let reconnects = tokio::join!(
        repo.connect(&c, b"first", Some(c.id)),
        repo.connect(&c, b"second", Some(c.id))
    );
    reconnects.0.unwrap();
    reconnects.1.unwrap();
    // The worker read revoked/old generation before either reconnect, then settled after both.
    repo.settle_receipt(&old.lease, Some("account_state_changed"), Some(30))
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET attempts=20,available_at=now() WHERE id=$1",
        old.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_receipt().await.unwrap().unwrap();
    assert_eq!(retry.lease.id, old.lease.id);
    assert_eq!(
        retry.attempts, 20,
        "account-state recovery is not exhausted by revoked time"
    );
    assert_ne!(retry.lease.token, old.lease.token);
    repo.settle_receipt(&retry.lease, None, None).await.unwrap();
    assert!(repo.claim_receipt().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn healthy_account_is_claimable_behind_a_large_slow_backlog(pool: PgPool) {
    let (team, user) = team(&pool, "backlog-fairness").await;
    let repo = PgMessagingRepository::new(pool.clone());
    let slow = repo
        .connect(&connection(team, user.clone(), "backlogged"), b"test", None)
        .await
        .unwrap();
    let healthy = repo
        .connect(&connection(team, user.clone(), "healthy"), b"test", None)
        .await
        .unwrap();
    let a = channel(&pool, &user).await;
    let b = channel(&pool, &user).await;
    for _ in 0..500 {
        enqueue(&repo, &slow, a).await;
        enqueue(&repo, &slow, b).await;
    }
    let good = enqueue(&repo, &healthy, channel(&pool, &user).await).await;
    assert_eq!(
        repo.claim_send().await.unwrap().unwrap().connection_id,
        slow.id
    );
    assert_eq!(
        repo.claim_send().await.unwrap().unwrap().connection_id,
        slow.id
    );
    assert_eq!(repo.claim_send().await.unwrap().unwrap().lease.id, good.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn decode_diagnostics_survive_recovery_and_reject_stale_leases(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    repo.accept_receipt(
        Provider::Instagram,
        &Sha256::digest(b"diagnostics"),
        &serde_json::json!({"object":"instagram","entry":[]}),
    )
    .await
    .unwrap();
    let work = repo.claim_receipt().await.unwrap().unwrap();
    repo.record_receipt_decode_failures(&work.lease, 2)
        .await
        .unwrap();
    repo.settle_receipt(&work.lease, Some("account_state_changed"), Some(1))
        .await
        .unwrap();
    assert!(
        repo.record_receipt_decode_failures(&work.lease, 3)
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT decode_failures FROM meta_messaging_receipt WHERE id=$1",
            work.lease.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}
