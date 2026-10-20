mod fairness;
mod policies;
mod subscription;
use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sha2::{Digest, Sha256};

pub(crate) async fn team(pool: &PgPool, name: &str) -> (Uuid, String) {
    let id = Uuid::now_v7();
    let user = format!("macro|{name}@messaging.test");
    let email = format!("{name}@messaging.test");
    let macro_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
        macro_id,
        email,
        format!("fixture_{id}")
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
        user,
        email,
        macro_id
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id,name,owner_id) VALUES ($1,$2,$3)",
        id,
        name,
        user
    )
    .execute(pool)
    .await
    .unwrap();
    (id, user)
}
fn connection(team_id: Uuid, user_id: String, account: &str) -> Connection {
    Connection {
        id: Uuid::now_v7(),
        team_id,
        user_id,
        provider: Provider::Whatsapp,
        account_id: account.to_owned().try_into().unwrap(),
        business_account_id: Some("business1".to_owned().try_into().unwrap()),
        display_name: "Test business".into(),
        status: ConnectionStatus::Connecting,
        connected_at: Some(Utc::now()),
        credential_expires_at: None,
        human_agent_approved: false,
        whatsapp_mode: None,
        registration_status: None,
        registration_attempted_at: None,
        developer_account: true,

        health_error: None,
    }
}
pub(crate) async fn channel(pool: &PgPool, user: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!("INSERT INTO comms_channels (id,name,owner_id,channel_type) VALUES ($1,'Customer',$2,'private')",id,user).execute(pool).await.unwrap();
    id
}
fn reply() -> SendReply {
    SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "A deliberate reply".into(),
        },
        reply_to: None,
        human_support: false,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn account_mapping_cannot_move_between_teams_or_reconnect_to_another_identity(pool: PgPool) {
    let (alpha, user) = team(&pool, "alpha").await;
    let (beta, other) = team(&pool, "beta").await;
    let repo = PgMessagingRepository::new(pool);
    let original = connection(alpha, user, "phone1");
    let original = repo
        .connect(&original, b"fixture-ciphertext", None)
        .await
        .unwrap();
    let hijack = connection(beta, other, "phone1");
    assert!(matches!(
        repo.connect(&hijack, b"fixture-ciphertext", None)
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Conflict
    ));
    let wrong = connection(alpha, original.user_id.clone(), "phone2");
    assert!(
        repo.connect(&wrong, b"fixture-ciphertext", Some(original.id))
            .await
            .is_err()
    );
    repo.disconnect(alpha, original.id).await.unwrap();
    repo.connect(&original, b"new-fixture-ciphertext", Some(original.id))
        .await
        .unwrap();
    assert_eq!(
        repo.connection(original.id).await.unwrap().unwrap().team_id,
        alpha
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_receipts_and_expired_worker_fences_are_handled_durably(pool: PgPool) {
    let repo = PgMessagingRepository::new(pool.clone());
    let body = serde_json::json!({"object":"instagram","entry":[]});
    let digest = Sha256::digest(b"receipt");
    let (a, b) = tokio::join!(
        repo.accept_receipt(Provider::Instagram, &digest, &body),
        repo.accept_receipt(Provider::Instagram, &digest, &body)
    );
    a.unwrap();
    b.unwrap();
    let first = repo.claim_receipt().await.unwrap().unwrap();
    assert!(repo.claim_receipt().await.unwrap().is_none());
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET lease_until = now() - interval '1 second' WHERE id = $1",
        first.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let second = repo.claim_receipt().await.unwrap().unwrap();
    assert_eq!(first.lease.id, second.lease.id);
    assert_ne!(first.lease.token, second.lease.token);
    assert!(matches!(
        repo.settle_receipt(&first.lease, None, None)
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Conflict
    ));
    repo.settle_receipt(&second.lease, None, None)
        .await
        .unwrap();
    assert!(repo.claim_receipt().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepted_replies_recover_without_becoming_sendable_again(pool: PgPool) {
    let (team, user) = team(&pool, "sender").await;
    let channel = channel(&pool, &user).await;
    let c = connection(team, user.clone(), "phone1");
    let repo = PgMessagingRepository::new(pool.clone());
    repo.connect(&c, b"fixture", None).await.unwrap();
    let request = reply();
    let hash = Sha256::digest(serde_json::to_vec(&request).unwrap());
    let original = repo
        .enqueue_send(c.id, channel, &user, &request, &hash)
        .await
        .unwrap();
    assert_eq!(
        original.id,
        repo.enqueue_send(c.id, channel, &user, &request, &hash)
            .await
            .unwrap()
            .id
    );
    assert!(
        repo.enqueue_send(
            c.id,
            channel,
            &user,
            &request,
            &Sha256::digest(b"different payload")
        )
        .await
        .is_err()
    );
    let work = repo.claim_send().await.unwrap().unwrap();
    let provider_id = "wamid.accepted".to_owned().try_into().unwrap();
    repo.settle_send(
        &work.lease,
        DeliveryState::Accepted,
        Some(&provider_id),
        None,
        None,
    )
    .await
    .unwrap();
    // Simulated crash: no native message was created after provider acceptance.
    let restarted = PgMessagingRepository::new(pool);
    assert!(restarted.claim_send().await.unwrap().is_none());
    let recovered = restarted.accepted_sends().await.unwrap();
    assert_eq!(recovered[0].0.created_at, original.created_at);
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].0.lease.id, original.id);
    assert_eq!(recovered[0].1, provider_id);
    assert!(matches!(
        restarted
            .settle_send(&work.lease, DeliveryState::Failed, None, None, None)
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Conflict
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crashed_network_attempt_is_unknown_and_never_automatically_resent(pool: PgPool) {
    let (team, user) = team(&pool, "unknown").await;
    let channel = channel(&pool, &user).await;
    let c = connection(team, user.clone(), "phone1");
    let repo = PgMessagingRepository::new(pool.clone());
    repo.connect(&c, b"fixture", None).await.unwrap();
    let request = reply();
    bind_conversation(&repo, &c, channel).await;
    repo.enqueue_send(c.id, channel, &user, &request, &Sha256::digest(b"send"))
        .await
        .unwrap();
    let work = repo.claim_send().await.unwrap().unwrap();
    let current = repo.connection(c.id).await.unwrap().unwrap();
    repo.health(&current, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    repo.prepare_send(
        &work.lease,
        &(&current).into(),
        &conversation(&current, channel),
        "An attempted reply",
    )
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_send SET lease_until = now() - interval '1 second' WHERE id = $1",
        work.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.claim_send().await.unwrap().is_none());
    assert_eq!(
        repo.sends(channel).await.unwrap()[0].state,
        DeliveryState::Unknown
    );
    assert!(
        repo.settle_send(
            &work.lease,
            DeliveryState::Accepted,
            Some(&"late-id".to_owned().try_into().unwrap()),
            None,
            None
        )
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn oauth_state_is_single_use_and_bound_to_initiating_team_and_user(pool: PgPool) {
    let (team, user) = team(&pool, "oauth").await;
    let repo = PgMessagingRepository::new(pool);
    let digest = Sha256::digest(b"unguessable-test-state").to_vec();
    repo.begin_authorization(&OAuthAttempt {
        state_sha256: digest.clone(),
        team_id: team,
        user_id: user.clone(),
        provider: Provider::Instagram,
        reconnect_id: None,
        expires_at: Utc::now() + chrono::Duration::minutes(10),
    })
    .await
    .unwrap();
    assert!(
        repo.consume_authorization(&digest, team, "macro|someoneelse@messaging.test")
            .await
            .is_err()
    );
    assert_eq!(
        repo.consume_authorization(&digest, team, &user)
            .await
            .unwrap()
            .user_id,
        user
    );
    assert!(
        repo.consume_authorization(&digest, team, &user)
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_fences_stale_health_and_credential_refresh(pool: PgPool) {
    let (team, user) = team(&pool, "reconnect").await;
    let repo = PgMessagingRepository::new(pool);
    let old = repo
        .connect(&connection(team, user, "phone"), b"old", None)
        .await
        .unwrap();
    repo.health(&old, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let current = repo.connect(&old, b"renewed", Some(old.id)).await.unwrap();
    assert!(
        repo.health(&old, ConnectionStatus::Revoked, Some("stale_failure"))
            .await
            .is_err()
    );
    repo.health(&current, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    assert!(
        repo.refresh_credential(&old, b"stale", Utc::now() + chrono::Duration::days(60))
            .await
            .is_err()
    );
    assert_eq!(repo.credential(old.id).await.unwrap(), b"renewed");
    repo.disconnect(team, old.id).await.unwrap();
    assert!(
        repo.health(&current, ConnectionStatus::Connected, None)
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_retries_only_its_own_failed_receipts(pool: PgPool) {
    let (team, user) = team(&pool, "receipts").await;
    let repo = PgMessagingRepository::new(pool);
    let old = repo
        .connect(&connection(team, user, "phone"), b"old", None)
        .await
        .unwrap();
    for phone in ["phone", "other"] {
        let payload = serde_json::json!({"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":phone}}}]}]});
        repo.accept_receipt(
            Provider::Whatsapp,
            &Sha256::digest(phone.as_bytes()),
            &payload,
        )
        .await
        .unwrap();
        let work = repo.claim_receipt().await.unwrap().unwrap();
        repo.settle_receipt(&work.lease, Some("reconnect required"), None)
            .await
            .unwrap();
    }
    repo.connect(&old, b"renewed", Some(old.id)).await.unwrap();
    let retry = repo.claim_receipt().await.unwrap().unwrap();
    assert_eq!(
        retry.payload["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"],
        "phone"
    );
    assert!(repo.claim_receipt().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn final_crashed_receipt_can_recover_on_reconnect(pool: PgPool) {
    let (team, user) = team(&pool, "last_crash").await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(&connection(team, user, "phone"), b"old", None)
        .await
        .unwrap();
    let payload = serde_json::json!({"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"phone"}}}]}]});
    repo.accept_receipt(Provider::Whatsapp, &Sha256::digest(b"last crash"), &payload)
        .await
        .unwrap();
    let first = repo.claim_receipt().await.unwrap().unwrap();
    sqlx::query!("UPDATE meta_messaging_receipt SET attempts=20,lease_until=now()-interval '1 second' WHERE id=$1",first.lease.id).execute(&pool).await.unwrap();
    assert!(repo.claim_receipt().await.unwrap().is_none());
    repo.connect(&c, b"renewed", Some(c.id)).await.unwrap();
    let retry = repo.claim_receipt().await.unwrap().unwrap();
    assert_eq!(retry.lease.id, first.lease.id);
    assert_eq!(retry.attempts, 1);
    assert_ne!(retry.lease.token, first.lease.token);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn send_dispatch_fences_lifecycle_changes_and_keeps_inflight_acceptance(pool: PgPool) {
    let (team, user) = team(&pool, "dispatch-fence").await;
    let channel = channel(&pool, &user).await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(
            &connection(team, user.clone(), "dispatch-phone"),
            b"fixture",
            None,
        )
        .await
        .unwrap();
    repo.health(&c, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let request = reply();
    bind_conversation(&repo, &c, channel).await;
    repo.enqueue_send(c.id, channel, &user, &request, &Sha256::digest(b"dispatch"))
        .await
        .unwrap();
    let work = repo.claim_send().await.unwrap().unwrap();
    let mut lifecycle = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM meta_messaging_connection WHERE id=$1 FOR UPDATE",
        c.id
    )
    .fetch_one(&mut *lifecycle)
    .await
    .unwrap();
    let dispatch_repo = repo.clone();
    let dispatch_connection = c.clone();
    let dispatch_lease = work.lease.clone();
    let mut dispatch = tokio::spawn(async move {
        dispatch_repo
            .prepare_send(
                &dispatch_lease,
                &(&dispatch_connection).into(),
                &conversation(&dispatch_connection, channel),
                "Rendered body",
            )
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut dispatch)
            .await
            .is_err()
    );
    sqlx::query!(
        "UPDATE meta_messaging_connection SET status='disconnected',credential=NULL WHERE id=$1",
        c.id
    )
    .execute(&mut *lifecycle)
    .await
    .unwrap();
    lifecycle.commit().await.unwrap();
    assert_eq!(
        *dispatch.await.unwrap().unwrap_err().current_context(),
        MessagingError::Disconnected
    );
    let fresh = repo.connect(&c, b"fresh", Some(c.id)).await.unwrap();
    repo.health(&fresh, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    assert_eq!(
        *repo
            .prepare_send(
                &work.lease,
                &(&c).into(),
                &conversation(&c, channel),
                "Stale body"
            )
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Disconnected
    );
    repo.prepare_send(
        &work.lease,
        &(&fresh).into(),
        &conversation(&fresh, channel),
        "Rendered body",
    )
    .await
    .unwrap();
    repo.disconnect(team, c.id).await.unwrap();
    let provider_id = "accepted-inflight".to_owned().try_into().unwrap();
    repo.settle_send(
        &work.lease,
        DeliveryState::Accepted,
        Some(&provider_id),
        None,
        None,
    )
    .await
    .unwrap();
    let accepted = repo.accepted_sends().await.unwrap();
    assert_eq!(accepted.len(), 1);
    assert_eq!(
        accepted[0].0.rendered_text.as_deref(),
        Some("Rendered body")
    );
    assert!(repo.claim_send().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepted_recovery_backoff_yields_past_a_full_failed_page_after_restart(pool: PgPool) {
    let (team, user) = team(&pool, "recovery-backoff").await;
    let channel = channel(&pool, &user).await;
    let repo = PgMessagingRepository::new(pool.clone());
    let c = repo
        .connect(
            &connection(team, user.clone(), "recovery-phone"),
            b"fixture",
            None,
        )
        .await
        .unwrap();
    let mut ids = Vec::new();
    for index in 0..51 {
        let request = reply();
        let queued = repo
            .enqueue_send(
                c.id,
                channel,
                &user,
                &request,
                &Sha256::digest(index.to_string()),
            )
            .await
            .unwrap();
        let work = repo.claim_send().await.unwrap().unwrap();
        assert_eq!(work.lease.id, queued.id);
        let provider = format!("accepted-{index}").try_into().unwrap();
        repo.settle_send(
            &work.lease,
            DeliveryState::Accepted,
            Some(&provider),
            None,
            None,
        )
        .await
        .unwrap();
        ids.push(queued.id);
    }
    let first = repo.accepted_sends().await.unwrap();
    assert_eq!(first.len(), 50);
    for (work, provider) in &first {
        repo.defer_accepted_send(work, provider).await.unwrap();
    }
    let restarted = PgMessagingRepository::new(pool.clone());
    let next = restarted.accepted_sends().await.unwrap();
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].0.lease.id, ids[50]);
    assert!(restarted.claim_send().await.unwrap().is_none());
    assert!(
        restarted
            .sends(channel)
            .await
            .unwrap()
            .iter()
            .all(|send| send.state == DeliveryState::Accepted)
    );
    // Backoff is recovery scheduling, never terminal loss or an outbound retry.
    sqlx::query!(
        "UPDATE meta_messaging_send SET native_retry_at=now() WHERE connection_id=$1",
        c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(restarted.accepted_sends().await.unwrap().len(), 50);
    assert!(restarted.claim_send().await.unwrap().is_none());
}

fn conversation(c: &Connection, channel: Uuid) -> Conversation {
    Conversation {
        kind: crate::domain::groups::ConversationKind::Direct,
        group_status: None,
        channel_id: channel,
        connection_id: c.id,
        customer_id: channel.to_string().try_into().unwrap(),
        customer_display_name: None,
        customer_phone: None,
        customer_handle: None,
        last_customer_message_at: None,
    }
}
async fn bind_conversation(repo: &PgMessagingRepository, c: &Connection, channel: Uuid) {
    sqlx::query!("INSERT INTO meta_messaging_conversation(connection_id,customer_id,channel_id,external_sender_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",c.id,channel.to_string(),channel,Uuid::now_v7()).execute(&repo.pool).await.unwrap();
}
