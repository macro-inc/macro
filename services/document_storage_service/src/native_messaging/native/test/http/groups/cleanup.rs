//! Cleanup-specific authority, callback ordering and runtime regressions.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replaced_saved_request_cannot_bind_and_stale_setups_do_not_block_unrelated_facts(
    pool: PgPool,
) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT request_id FROM meta_messaging_group_setup WHERE channel_id=$1",
            channel
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .as_deref(),
        Some("request-1")
    );
    sqlx::query!("UPDATE meta_messaging_group_setup SET started_at=now()-interval '3 minutes' WHERE channel_id=$1",channel).execute(&pool).await.unwrap();
    group_fact(&f, "group_status_update", json!({"timestamp":Utc::now().timestamp().to_string(),"type":"group_suspend","group_id":"unrelated"})).await;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_receipt WHERE status='pending'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/channels/{channel}/group/retry"),
            Some("owner"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    bind(&f, "request-1", "replaced", Utc::now().timestamp()).await;
    assert!(f.repo.conversation(channel).await.unwrap().is_none());
    // Staleness bounds dependencies, not a saved request's validity.
    sqlx::query!("UPDATE meta_messaging_group_setup SET started_at=now()-interval '3 minutes' WHERE channel_id=$1",channel).execute(&pool).await.unwrap();
    bind(&f, "request-2", "current", Utc::now().timestamp()).await;
    assert_eq!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "current"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn callback_before_create_response_uses_durable_dependency_without_subscription_contention(
    pool: PgPool,
) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    f.remote.pause_group_create.store(true, Ordering::SeqCst);
    let app = f.app.clone();
    let connection = f.c.id;
    let client = tokio::spawn(async move {
        request(
            &app,
            "POST",
            &format!("/connections/{connection}/groups"),
            Some("owner"),
            json!({"channel_id":channel,"subject":"Customer project"}),
        )
        .await
    });
    f.remote.operation_entered.notified().await;
    bind(&f, "request-1", "early", Utc::now().timestamp()).await;
    assert!(f.repo.conversation(channel).await.unwrap().is_none());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT attempts FROM meta_messaging_receipt WHERE error_code='group_binding_pending'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    f.remote.operation_release.notify_one();
    assert_eq!(client.await.unwrap().0, StatusCode::OK);
    sqlx::query!("UPDATE meta_messaging_receipt SET available_at=now() WHERE status='pending'")
        .execute(&pool)
        .await
        .unwrap();
    drain_groups(&f.service).await;
    assert_eq!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "early"
    );
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn binding_racing_discard_is_atomic_and_never_deletes_remotely(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    sqlx::query!("UPDATE meta_messaging_group_setup SET started_at=now()-interval '3 minutes' WHERE channel_id=$1",channel).execute(&pool).await.unwrap();
    let (discard, ()) = tokio::join!(
        f.service.discard_group_setup(
            channel,
            &f.c.user_id,
            meta_messaging::domain::policy::SendAuthority::Human
        ),
        bind(&f, "request-1", "racing", Utc::now().timestamp())
    );
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM comms_channels WHERE id=$1) AS \"exists!\"",
        channel
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let bound = f.repo.conversation(channel).await.unwrap();
    match discard {
        Ok(()) => {
            assert!(!exists);
            assert!(bound.is_none());
        }
        Err(error) => {
            assert!(matches!(error.current_context(), MessagingError::Conflict));
            assert!(exists);
            assert!(bound.is_some());
        }
    }
    assert_eq!(f.remote.group_deletes.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn api_keys_cannot_delete_groups_or_read_links_but_can_delete_ordinary_channels(
    pool: PgPool,
) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    bind(&f, "request-1", "human-only", Utc::now().timestamp()).await;
    for (method, path) in [
        ("DELETE", format!("/channels/{channel}/group")),
        ("GET", format!("/channels/{channel}/group/link")),
        ("POST", format!("/channels/{channel}/group/discard")),
        ("DELETE", format!("/native/channels/{channel}")),
    ] {
        let response = f
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header(macro_authorization::USER_API_KEY_HEADER, "fixture-key")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("chat.whatsapp.com"));
    }
    assert_eq!(f.remote.group_deletes.load(Ordering::SeqCst), 0);
    assert_eq!(f.remote.group_removes.load(Ordering::SeqCst), 0);
    assert!(f.repo.conversation(channel).await.unwrap().is_some());
    let ordinary = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    PgChannelsRepo::ensure_reserved_channel_in(
        &mut tx,
        &HistoricalChannel {
            id: ordinary,
            name: "Ordinary".into(),
            kind: HistoricalChannelKind::Private,
            owner: f.c.user_id.clone().try_into().unwrap(),
            participants: HashSet::new(),
            created_at: Utc::now(),
        },
        true,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let response = f
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/native/channels/{ordinary}"))
                .header(macro_authorization::USER_API_KEY_HEADER, "fixture-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

/// Run explicitly: this observation window measures actual PostgreSQL statements,
/// including all worker drivers, without making real provider requests.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "explicit idle-query and latency measurement"]
async fn worker_idle_and_delivery_probe(pool: PgPool) {
    use std::time::{Duration, Instant};
    use tokio_util::{sync::CancellationToken, task::TaskTracker};
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    bind(&f, "request-1", "worker-probe", Utc::now().timestamp()).await;
    sqlx::query!(
        "UPDATE meta_messaging_conversation SET last_customer_message_at=now() WHERE channel_id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    let cancellation = CancellationToken::new();
    let tracker = TaskTracker::new();
    crate::native_messaging::spawn(
        f.service.clone(),
        f.repo.work_ready.clone(),
        tracker.clone(),
        cancellation.clone(),
    );
    // Timed observation, not condition polling: separate startup from steady idle.
    assert!(
        tokio::time::timeout(Duration::from_secs(1), cancellation.cancelled())
            .await
            .is_err()
    );
    let before=sqlx::query!("SELECT COALESCE(sum(calls),0)::bigint AS \"total!\", COALESCE(sum(calls) FILTER(WHERE query LIKE '%meta_messaging_%'),0)::bigint AS \"messaging!\" FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT LIKE '%pg_stat_statements%'").fetch_one(&pool).await.unwrap();
    let observed = Instant::now();
    assert!(
        tokio::time::timeout(Duration::from_secs(10), cancellation.cancelled())
            .await
            .is_err()
    );
    let after=sqlx::query!("SELECT COALESCE(sum(calls),0)::bigint AS \"total!\", COALESCE(sum(calls) FILTER(WHERE query LIKE '%meta_messaging_%'),0)::bigint AS \"messaging!\" FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT LIKE '%pg_stat_statements%'").fetch_one(&pool).await.unwrap();
    let idle_seconds = observed.elapsed().as_secs_f64();
    println!(
        "worker_total_idle_statements {}",
        after.total - before.total
    );
    let started = Instant::now();
    let accepted=request(&f.app,"POST",&format!("/channels/{channel}/replies"),Some("owner"),json!({"idempotency_key":Uuid::now_v7(),"message":{"type":"text","text":"Worker notification latency"}})).await;
    assert_eq!(accepted.0, StatusCode::OK);
    tokio::time::timeout(
        Duration::from_secs(1),
        f.remote.operation_entered.notified(),
    )
    .await
    .expect("committed local send wakes promptly on an idle system");
    let dispatch_ms = started.elapsed().as_millis();
    cancellation.cancel();
    tracker.close();
    tracker.wait().await;
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 1);
    let sends = f.repo.sends(channel).await.unwrap();
    assert!(
        sends[0].message_id.is_some(),
        "shutdown drains the accepted native materialization"
    );
    println!(
        "worker_probe {{\"idle_seconds\":{idle_seconds},\"idle_statements\":{},\"dispatch_ms\":{dispatch_ms},\"native_ms\":{}}}",
        after.messaging - before.messaging,
        started.elapsed().as_millis()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn native_binding_metadata_is_available_to_viewers_without_channel_participation(
    pool: PgPool,
) {
    use channels::domain::models::{ChannelType, CreateChannelRequest};
    let f = platform(&pool).await;
    let repo = PgChannelsRepo::new(pool.clone());
    for kind in [ChannelType::Public, ChannelType::Team, ChannelType::Private] {
        let channel = repo
            .create_channel(
                f.c.user_id.clone().try_into().unwrap(),
                None,
                CreateChannelRequest {
                    name: Some("Metadata".into()),
                    channel_type: kind,
                    team_id: (kind == ChannelType::Team).then_some(f.c.team_id),
                    auto_join_team: false,
                    participants: HashSet::new(),
                },
            )
            .await
            .unwrap();
        let (status, body) = request(
            &f.app,
            "GET",
            &format!("/native/channels/{}", channel.id),
            Some("outsider"),
            json!({}),
        )
        .await;
        if kind == ChannelType::Private {
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        } else {
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["messaging_binding"], "native");
        }
    }
}
