//! Shared subscription ownership and actionable health, through actual domain/DB/HTTP paths.
use super::*;
use entity_access::domain::models::{EntityType, MemberTeamRole};
use std::time::Duration;

async fn phone(f: &Fixture, name: &str, business: &str) -> Connection {
    let mut c = f.c.clone();
    c.id = Uuid::now_v7();
    c.account_id = name.to_owned().try_into().unwrap();
    c.business_account_id = Some(business.to_owned().try_into().unwrap());
    let c = f.repo.connect(&c, b"fixture-token", None).await.unwrap();
    f.repo
        .health(&c, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    f.repo.connection(c.id).await.unwrap().unwrap()
}
async fn disconnect(f: &Fixture, id: Uuid) -> (StatusCode, Value) {
    request(
        &f.app,
        "POST",
        &format!("/connections/{id}/disconnect"),
        Some("owner"),
        json!({}),
    )
    .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnect_keeps_other_teams_shared_waba_then_removes_the_last_subscription(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let first = phone(&f, "phone-one", "shared-waba").await;
    let other_user = user(&pool, "other-admin", None).await;
    let other_team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id,name,owner_id) VALUES ($1,'Other messaging team',$2)",
        other_team,
        other_user
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'owner')",
        other_team,
        other_user
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut sibling = first.clone();
    sibling.id = Uuid::now_v7();
    sibling.account_id = "phone-two".to_owned().try_into().unwrap();
    sibling.team_id = other_team;
    sibling.user_id = other_user.clone();
    let sibling = f
        .repo
        .connect(&sibling, b"other-token", None)
        .await
        .unwrap();
    f.repo
        .health(&sibling, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let (status, body) = disconnect(&f, first.id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["shared_subscription_kept"], true);
    assert_eq!(body["remote_unsubscribed"], false);
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 0);
    assert!(f.repo.credential(first.id).await.is_err());
    assert_eq!(
        f.repo.connection(sibling.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
    // The first team's administrator cannot disconnect the sibling on another team.
    assert_eq!(disconnect(&f, sibling.id).await.0, StatusCode::NOT_FOUND);
    let actor = MacroUserIdStr::try_from(other_user).unwrap();
    let access = fixture_native(&pool)
        .await
        .access
        .generate_entity_access_receipt::<MemberTeamRole>(
            &actor.0,
            None,
            &other_team.to_string(),
            EntityType::Team,
        )
        .await
        .unwrap();
    let result = f.service.disconnect(&access, sibling.id).await.unwrap();
    assert!(result.remote_unsubscribed);
    assert!(!result.shared_subscription_kept);
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 1);
    // Idempotent local disconnect never resurrects credentials or unlinks another account.
    assert_eq!(disconnect(&f, first.id).await.0, StatusCode::OK);
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repeated_disconnect_is_authorized_and_read_only_while_subscription_is_locked(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    f.repo.disconnect(f.c.team_id, f.c.id).await.unwrap();
    let _guard = f.repo.lock_subscription(&f.c).await.unwrap().unwrap();

    let (status, body) = disconnect(&f, f.c.id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["remote_unsubscribed"], false);
    assert_eq!(body["shared_subscription_kept"], false);
    let (status, body) = request(
        &f.app,
        "POST",
        &format!("/connections/{}/disconnect", f.c.id),
        Some("outsider"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(f.repo.credential(f.c.id).await.is_err());
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.repo.connection(f.c.id).await.unwrap().unwrap().status,
        ConnectionStatus::Disconnected
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_disconnect_remains_account_scoped(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let mut other = f.c.clone();
    other.id = Uuid::now_v7();
    other.account_id = "other-instagram".to_owned().try_into().unwrap();
    let other = f.repo.connect(&other, b"other-token", None).await.unwrap();
    f.repo
        .health(&other, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let (status, body) = disconnect(&f, f.c.id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["remote_unsubscribed"], true);
    assert_eq!(body["shared_subscription_kept"], false);
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 1);
    assert_eq!(
        f.repo.connection(other.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_phone_cannot_race_a_shared_subscription_removal(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let first = phone(&f, "last-phone", "race-waba").await;
    f.remote.pause_unsubscribe.store(true, Ordering::SeqCst);
    let app = f.app.clone();
    let task = tokio::spawn(async move {
        request(
            &app,
            "POST",
            &format!("/connections/{}/disconnect", first.id),
            Some("owner"),
            json!({}),
        )
        .await
    });
    tokio::time::timeout(
        Duration::from_secs(3),
        f.remote.operation_entered.notified(),
    )
    .await
    .unwrap();
    let other_repo = PgMessagingRepository::new(pool.clone()); // A different service instance must see the same database lock.
    let mut new = f.c.clone();
    new.id = Uuid::now_v7();
    new.account_id = "new-phone".to_owned().try_into().unwrap();
    new.business_account_id = Some("race-waba".to_owned().try_into().unwrap());
    let candidate = new.clone();
    let repository = other_repo.clone();
    let mut connect =
        tokio::spawn(async move { repository.connect(&candidate, b"new-token", None).await });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut connect)
            .await
            .is_err()
    );
    assert!(other_repo.connection(new.id).await.unwrap().is_none());
    f.remote.operation_release.notify_one();
    assert_eq!(task.await.unwrap().0, StatusCode::OK);
    tokio::time::timeout(Duration::from_secs(3), connect)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    f.service.maintain().await.unwrap();
    assert_eq!(
        other_repo.connection(new.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
    assert_eq!(f.remote.subscriptions.load(Ordering::SeqCst), 1);
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn late_subscribe_cleanup_cannot_unsubscribe_a_sibling(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let first = phone(&f, "first-phone", "late-waba").await;
    let sibling = phone(&f, "sibling-phone", "late-waba").await;
    let first = f
        .repo
        .connect(&first, b"new-token", Some(first.id))
        .await
        .unwrap();
    f.remote.pause_subscribe.store(true, Ordering::SeqCst);
    let service = f.service.clone();
    let task = tokio::spawn(async move { service.maintain().await });
    tokio::time::timeout(
        Duration::from_secs(3),
        f.remote.operation_entered.notified(),
    )
    .await
    .unwrap();
    // Provider revocation can arrive through a webhook while subscription I/O is in flight.
    f.repo.disconnect(first.team_id, first.id).await.unwrap();
    f.remote.operation_release.notify_one();
    task.await.unwrap().unwrap();
    assert_eq!(f.remote.unsubscriptions.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.repo.connection(sibling.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn health_failures_keep_specific_safe_recovery_codes(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let cases = [
        (
            MessagingError::Disconnected,
            ConnectionStatus::Revoked,
            "meta_authorization_expired_or_revoked",
        ),
        (
            MessagingError::ProviderAccessRequired,
            ConnectionStatus::Error,
            "meta_access_required",
        ),
        (
            MessagingError::Forbidden,
            ConnectionStatus::Revoked,
            "connecting_member_access_lost",
        ),
        // A transient check failure keeps the account's current status.
        (
            MessagingError::Unavailable,
            ConnectionStatus::Connecting,
            "connection_temporarily_unavailable",
        ),
        (
            MessagingError::Invalid("private diagnostic must not be exposed"),
            ConnectionStatus::Error,
            "connection_configuration_required",
        ),
        (
            MessagingError::ProviderRejected,
            ConnectionStatus::Error,
            "provider_connection_rejected",
        ),
    ];
    for (error, status, code) in cases {
        let current = f.repo.connection(f.c.id).await.unwrap().unwrap();
        f.repo
            .connect(&current, b"fixture-token", Some(f.c.id))
            .await
            .unwrap();
        *f.remote.subscribe_error.lock().unwrap() = Some(error);
        f.service.maintain().await.unwrap();
        let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
        assert_eq!(c.status, status);
        assert_eq!(c.health_error.as_deref(), Some(code));
        let (http, connections) =
            request(&f.app, "GET", "/connections", Some("owner"), json!(null)).await;
        assert_eq!(http, StatusCode::OK);
        assert_eq!(connections[0]["health_error"], code);
        assert!(!connections.to_string().contains("private diagnostic"));
        if code == "meta_access_required" {
            let (_, view) = request(
                &f.app,
                "GET",
                &format!("/connections/{}/history", f.c.id),
                Some("owner"),
                json!(null),
            )
            .await;
            assert!(
                view["reason"]
                    .as_str()
                    .unwrap()
                    .contains("account confirmation")
            );
        }
    }
    *f.remote.subscribe_error.lock().unwrap() = None;
    let current = f.repo.connection(f.c.id).await.unwrap().unwrap();
    f.repo
        .connect(&current, b"renewed", Some(f.c.id))
        .await
        .unwrap();
    f.service.maintain().await.unwrap();
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(c.status, ConnectionStatus::Connected);
    assert!(c.health_error.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn temporary_check_failure_keeps_sending_and_rechecks_within_minutes(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let backdate = |interval: &'static str| {
        sqlx::query(
            "UPDATE meta_messaging_connection SET checked_at = now() - $2::interval WHERE id = $1",
        )
        .bind(f.c.id)
        .bind(interval)
        .execute(&pool)
    };
    backdate("2 hours").await.unwrap();
    *f.remote.subscribe_error.lock().unwrap() = Some(MessagingError::Unavailable);
    f.service.maintain().await.unwrap();
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(c.status, ConnectionStatus::Connected);
    assert_eq!(
        c.health_error.as_deref(),
        Some("connection_temporarily_unavailable")
    );
    assert!(f.repo.maintenance_connections().await.unwrap().is_empty());
    backdate("6 minutes").await.unwrap();
    assert_eq!(f.repo.maintenance_connections().await.unwrap().len(), 1);
    *f.remote.subscribe_error.lock().unwrap() = None;
    f.service.maintain().await.unwrap();
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(c.status, ConnectionStatus::Connected);
    assert!(c.health_error.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_provider_disconnect_preserves_reconnected_generations(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let old = phone(&f, "reconnected-phone", "revocation-waba").await;
    let sibling = phone(&f, "revoked-phone", "revocation-waba").await;
    let payload = json!({"object":"whatsapp_business_account","entry":[{"id":"revocation-waba","changes":[{"field":"account_update","value":{"event":"PARTNER_REMOVED"}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    let receipt = f.repo.claim_receipt().await.unwrap().unwrap();
    let reconnected = f
        .repo
        .connect(&old, b"new-generation", Some(old.id))
        .await
        .unwrap();
    f.repo
        .health(&reconnected, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let events = webhook::decode(receipt.provider, &receipt.payload).unwrap();
    f.service.process_receipt(&receipt, events).await.unwrap();
    assert_eq!(
        f.repo.connection(old.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
    assert_eq!(f.repo.credential(old.id).await.unwrap(), b"new-generation");
    assert_eq!(
        f.repo.connection(sibling.id).await.unwrap().unwrap().status,
        ConnectionStatus::Disconnected
    );
    // A reconnect between account lookup and the UPDATE must also win the fence.
    f.repo
        .disconnect_received(&old, Utc::now() + chrono::Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(f.repo.credential(old.id).await.unwrap(), b"new-generation");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn receipt_failure_does_not_hide_other_accounts_or_messages(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let now = connected_time(&f.repo, f.c.id).await;
    let payload = json!({"object":"whatsapp_business_account","entry":[{"id":"fixture-waba","changes":[
        {"field":"messages","value":{"metadata":{"phone_number_id":"not-connected"},"messages":[{"from":"other-customer","id":"unknown-account-message","timestamp":now.timestamp().to_string(),"type":"text","text":{"body":"Unconnected account"}}]}},
        {"field":"messages","value":{"metadata":{"phone_number_id":f.c.account_id},"messages":[
            {"from":"customer","id":"failed-media","timestamp":now.timestamp().to_string(),"type":"image","image":{"id":"unavailable-history-media"}},
            {"from":"customer","id":"healthy-text","timestamp":now.timestamp().to_string(),"type":"text","text":{"body":"Process me despite the earlier failures"}}
        ]}}
    ]}]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    let receipt = f.repo.claim_receipt().await.unwrap().unwrap();
    let events = webhook::decode(receipt.provider, &receipt.payload).unwrap();
    let error = f
        .service
        .process_receipt(&receipt, events.clone())
        .await
        .unwrap_err();
    // The retryable unknown account must retain retry even alongside permanent media failure.
    assert_eq!(*error.current_context(), MessagingError::Unavailable);
    let target = f.repo.message_target(f.c.id, "healthy-text").await.unwrap();
    assert!(f.service.process_receipt(&receipt, events).await.is_err());
    assert_eq!(
        f.repo.message_target(f.c.id, "healthy-text").await.unwrap(),
        target
    );
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM meta_messaging_message WHERE connection_id=$1",
        f.c.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, Some(2));
    // Lease loss remains fatal before any following event can commit.
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET lease_until=now()-interval '1 second' WHERE id=$1",
        receipt.lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let message = incoming(&f.c, "expired-worker-message");
    let error = f
        .service
        .process_receipt(&receipt, vec![IncomingEvent::Message(message)])
        .await
        .unwrap_err();
    assert_eq!(*error.current_context(), MessagingError::Conflict);
    assert!(
        f.repo
            .message_target(f.c.id, "expired-worker-message")
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_received_while_revoked_is_replayed_after_reconnect(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let original = incoming(&f.c, "unsent-while-revoked");
    fixture_native(&pool)
        .await
        .ingest(&f.c, &original, vec![])
        .await
        .unwrap();
    let current = f.repo.connection(f.c.id).await.unwrap().unwrap();
    f.repo
        .health(
            &current,
            ConnectionStatus::Revoked,
            Some("meta_authorization_expired_or_revoked"),
        )
        .await
        .unwrap();
    let at = connected_time(&f.repo, f.c.id).await;
    let payload = json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[
        {"sender":{"id":original.customer_id},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":{"mid":"sent-while-revoked","text":"Are you still there?"}},
        {"sender":{"id":original.customer_id},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":{"mid":original.message_id,"is_deleted":true}}
    ]}]});
    assert_eq!(
        signed(&f.app, Provider::Instagram, payload, true).await,
        StatusCode::OK
    );
    let work = f.repo.claim_receipt().await.unwrap().unwrap();
    let error = f
        .service
        .process_receipt(
            &work,
            webhook::decode(work.provider, &work.payload).unwrap(),
        )
        .await
        .unwrap_err();
    // Settle as the driver does: a non-transient error leaves replayable failed work.
    f.repo
        .settle_receipt(
            &work.lease,
            Some(&error.current_context().to_string()),
            None,
        )
        .await
        .unwrap();
    assert!(
        f.repo
            .message_target(f.c.id, "sent-while-revoked")
            .await
            .is_err()
    );
    f.repo
        .connect(&f.c, b"renewed-token", Some(f.c.id))
        .await
        .unwrap();
    drain(&f.service).await;
    let messages = PgMessageRepository::new(pool);
    let (channel, id) = f
        .repo
        .message_target(f.c.id, "sent-while-revoked")
        .await
        .unwrap();
    let replayed = messages
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replayed.content, "Are you still there?");
    let (channel, id) = f
        .repo
        .message_target(f.c.id, original.message_id.as_str())
        .await
        .unwrap();
    let unsent = messages
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert!(unsent.deleted_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscribed_unrendered_events_do_not_change_account_health(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let current = f.repo.connection(f.c.id).await.unwrap().unwrap();
    f.repo
        .health(&current, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    let at = connected_time(&f.repo, f.c.id).await;
    let payload = json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[{"sender":{"id":"customer"},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"postback":{"title":"Get started","payload":"GET_STARTED"}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Instagram, payload, true).await,
        StatusCode::OK
    );
    drain(&f.service).await;
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(c.status, ConnectionStatus::Connected);
    assert_eq!(c.health_error, None);
}
