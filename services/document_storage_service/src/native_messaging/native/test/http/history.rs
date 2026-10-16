//! Release policy exercised through signed webhooks, durable workers and native storage.
use super::*;

fn envelope(field: &str, value: Value) -> Value {
    json!({"object":"whatsapp_business_account","entry":[{"id":"waba","changes":[{"field":field,"value":value}]}]})
}

fn history(account: &ProviderId) -> Value {
    envelope(
        "history",
        json!({
            "metadata":{"phone_number_id":account},
            // A current timestamp must not turn onboarding history into live activity.
            "messages":[{"from":"current-history","id":"history-current","timestamp":Utc::now().timestamp().to_string(),"type":"text","text":{"body":"Still history"}}],
            "history":[{"metadata":{"progress":100},"threads":[
                {"id":"existing-customer","messages":[{"id":"history-old","from":"existing-customer","timestamp":"1700000000","type":"text","text":{"body":"Old conversation"}}]},
                {"id":"media-history","messages":[{"id":"history-image","from":"media-history","timestamp":"1700000001","type":"image","image":{"id":"must-not-download"}}]}
            ]}]
        }),
    )
}

async fn native_counts(pool: &PgPool) -> (i64, i64) {
    let row = sqlx::query!(
        "SELECT (SELECT COUNT(*) FROM comms_channels) AS \"channels!\", (SELECT COUNT(*) FROM comms_messages) AS \"messages!\""
    ).fetch_one(pool).await.unwrap();
    (row.channels, row.messages)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_connections_skip_history_and_new_activity_still_creates_channels(pool: PgPool) {
    let Fixture {
        app,
        service,
        repo,
        remote,
        ..
    } = fixture(&pool, Provider::Whatsapp, Some("fresh-phone")).await;
    let (status, begin) = request(
        &app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"whatsapp"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{begin}");
    let (status, complete) = request(
        &app,
        "POST",
        "/authorize/complete",
        Some("owner"),
        json!({"state":begin["state"],"code":"fixture-code"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{complete}");
    let c = repo
        .account(Provider::Whatsapp, &remote.connection.account_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(c.history_status, HistoryStatus::NotRequested);
    service.maintain().await.unwrap();
    assert_eq!(
        repo.connection(c.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );

    let old = history(&c.account_id);
    assert_eq!(
        signed(&app, Provider::Whatsapp, old.clone(), true).await,
        StatusCode::OK
    );
    drain(&service).await;
    assert_eq!(native_counts(&pool).await, (0, 0));
    assert!(repo.claim_receipt().await.unwrap().is_none());
    let after = repo.connection(c.id).await.unwrap().unwrap();
    assert_eq!(after.history_status, HistoryStatus::NotRequested);
    assert_eq!(after.history_progress, None);
    assert_eq!(after.status, ConnectionStatus::Connected);
    assert_eq!(after.health_error, None);

    // The customer existed on WhatsApp, but their first live event creates one Macro channel.
    let at = connected_time(&repo, c.id).await;
    let live = envelope(
        "messages",
        json!({"metadata":{"phone_number_id":c.account_id},
        "contacts":[{"wa_id":"existing-customer","profile":{"name":"Customer"}}],
        "messages":[{"from":"existing-customer","id":"live-one","timestamp":at.timestamp().to_string(),"type":"text","text":{"body":"New activity"}}]}),
    );
    assert_eq!(
        signed(&app, Provider::Whatsapp, live.clone(), true).await,
        StatusCode::OK
    );
    drain(&service).await;
    let (channel, message) = repo.message_target(c.id, "live-one").await.unwrap();
    let before = repo.conversation(channel).await.unwrap().unwrap();
    assert!(before.last_customer_message_at.is_some());
    assert_eq!(native_counts(&pool).await, (1, 1));

    // Duplicate receipts and a late history batch neither duplicate nor backfill that chat.
    assert_eq!(
        signed(&app, Provider::Whatsapp, live, true).await,
        StatusCode::OK
    );
    let mut late_history = old;
    late_history["entry"][0]["changes"][0]["value"]["history"][0]["metadata"]["progress"] =
        json!(75);
    assert_eq!(
        signed(&app, Provider::Whatsapp, late_history, true).await,
        StatusCode::OK
    );
    drain(&service).await;
    assert_eq!(native_counts(&pool).await, (1, 1));
    let after = repo.conversation(channel).await.unwrap().unwrap();
    assert_eq!(
        before.last_customer_message_at,
        after.last_customer_message_at
    );
    assert_eq!(before.standard_window_until, after.standard_window_until);
    let stored = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), message)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.content, "New activity");

    // A batched history notification must not swallow live activity beside it.
    let mut mixed = history(&c.account_id);
    mixed["entry"][0]["changes"].as_array_mut().unwrap().push(json!({
        "field":"messages", "value":{"metadata":{"phone_number_id":c.account_id},
        "messages":[{"from":"existing-customer","id":"live-two","timestamp":Utc::now().timestamp().to_string(),"type":"text","text":{"body":"Another new message"}}]}
    }));
    assert_eq!(
        signed(&app, Provider::Whatsapp, mixed, true).await,
        StatusCode::OK
    );
    drain(&service).await;
    assert_eq!(native_counts(&pool).await, (1, 2));
    assert_eq!(
        repo.message_target(c.id, "live-two").await.unwrap().0,
        channel
    );

    // A phone-app echo is new activity too, but cannot open the customer reply window.
    let echo = envelope(
        "smb_message_echoes",
        json!({"metadata":{"phone_number_id":c.account_id},
        "message_echoes":[{"from":c.account_id,"to":"phone-app-customer","id":"echo-one","timestamp":Utc::now().timestamp().to_string(),"type":"text","text":{"body":"Sent in the phone app"}}]}),
    );
    assert_eq!(
        signed(&app, Provider::Whatsapp, echo, true).await,
        StatusCode::OK
    );
    drain(&service).await;
    let (echo_channel, _) = repo.message_target(c.id, "echo-one").await.unwrap();
    assert_ne!(echo_channel, channel);
    assert!(
        repo.conversation(echo_channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_none()
    );
    assert_eq!(native_counts(&pool).await, (2, 3));
    assert_eq!(remote.sends.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn queued_history_is_ignored_even_with_legacy_sync_flags_or_no_account(pool: PgPool) {
    let Fixture {
        app,
        service,
        repo,
        c,
        ..
    } = fixture(&pool, Provider::Whatsapp, None).await;
    let mut legacy_ids = Vec::new();
    for (index, status) in [
        HistoryStatus::Pending,
        HistoryStatus::Syncing,
        HistoryStatus::Complete,
        HistoryStatus::Failed,
    ]
    .into_iter()
    .enumerate()
    {
        let mut legacy = c.clone();
        legacy.id = Uuid::now_v7();
        legacy.account_id = format!("legacy-{index}").try_into().unwrap();
        legacy.history_status = status;
        legacy_ids.push(legacy.id);
        repo.connect(&legacy, b"fixture-token", None).await.unwrap();
        assert_eq!(
            signed(&app, Provider::Whatsapp, history(&legacy.account_id), true).await,
            StatusCode::OK
        );
        let sync = envelope(
            "smb_app_state_sync",
            json!({"metadata":{"phone_number_id":legacy.account_id},"contacts":[{"wa_id":"old-contact","name":"Old contact"}]}),
        );
        assert_eq!(
            signed(&app, Provider::Whatsapp, sync, true).await,
            StatusCode::OK
        );
    }
    let unknown: ProviderId = "unconnected-phone".to_owned().try_into().unwrap();
    assert_eq!(
        signed(&app, Provider::Whatsapp, history(&unknown), true).await,
        StatusCode::OK
    );
    // Maintenance is deliberately run before the queued receipts, like a restarted worker.
    service.maintain().await.unwrap();
    drain(&service).await;
    assert_eq!(native_counts(&pool).await, (0, 0));
    assert!(repo.claim_receipt().await.unwrap().is_none());
    for id in legacy_ids {
        let account = repo.connection(id).await.unwrap().unwrap();
        assert_eq!(account.status, ConnectionStatus::Connected);
        assert_eq!(account.health_error, None);
    }
    service.maintain().await.unwrap();
    assert_eq!(native_counts(&pool).await, (0, 0));
}

async fn start_import(f: &Fixture) -> Value {
    let (status, view) = request(
        &f.app,
        "POST",
        &format!("/connections/{}/history", f.c.id),
        Some("owner"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{view}");
    view
}
async fn run_import(f: &Fixture) {
    for _ in 0..10 {
        let Some(work) = f.repo.claim_history_import().await.unwrap() else {
            return;
        };
        f.service.process_history_import(&work).await.unwrap();
    }
    panic!("import failed to reach a checkpoint");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicit_whatsapp_import_reuses_channels_and_never_opens_reply_windows(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    // Test-number protection is enforced by the server, not just hiding a button.
    let path = format!("/connections/{}/history", f.c.id);
    assert_eq!(
        request(&f.app, "POST", &path, Some("owner"), json!({}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::query!(
        "UPDATE meta_messaging_connection SET developer_account=false WHERE id=$1",
        f.c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&f.app, "POST", &path, Some("outsider"), json!({}))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/connections/{}/history", Uuid::now_v7()),
            Some("owner"),
            json!({})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // A queued receipt from before consent must remain ignored even if processed later.
    let queued = history(&f.c.account_id);
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, queued, true).await,
        StatusCode::OK
    );
    let start = start_import(&f).await;
    assert_eq!(start["import"]["status"], "pending");
    start_import(&f).await; // double-click is idempotent
    run_import(&f).await;
    assert_eq!(f.remote.history_requests.load(Ordering::SeqCst), 2);
    drain(&f.service).await;
    assert_eq!(native_counts(&pool).await, (0, 0));
    let old = envelope(
        "history",
        json!({"metadata":{"phone_number_id":f.c.account_id},"history":[{"metadata":{"progress":100},"threads":[{"id":"customer-history","messages":[
            {"id":"old-incoming","from":"customer-history","timestamp":"1700000000","type":"text","text":{"body":"Important old conversation"}},
            {"id":"old-outgoing","from":"business-number","timestamp":"1700000001","type":"text","text":{"body":"Old business reply"}}
        ]}]}]}),
    );
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, old.clone(), true).await,
        StatusCode::OK
    );
    drain(&f.service).await;
    let (channel, _) = f.repo.message_target(f.c.id, "old-incoming").await.unwrap();
    assert_eq!(
        f.repo
            .message_target(f.c.id, "old-outgoing")
            .await
            .unwrap()
            .0,
        channel
    );
    let imported = f.repo.conversation(channel).await.unwrap().unwrap();
    assert!(imported.last_customer_message_at.is_none());
    assert!(imported.standard_window_until.is_none());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM comms_activity WHERE channel_id=$1",
            channel
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(native_counts(&pool).await, (1, 2));
    let (_, view) = request(&f.app, "GET", &path, Some("owner"), json!(null)).await;
    assert_eq!(view["import"]["status"], "complete");
    // Late lower progress and a different envelope carrying the same messages are harmless.
    let mut duplicate = old;
    duplicate["entry"][0]["changes"][0]["value"]["history"][0]["metadata"]["progress"] = json!(25);
    signed(&f.app, Provider::Whatsapp, duplicate, true).await;
    drain(&f.service).await;
    assert_eq!(native_counts(&pool).await, (1, 2));
    let (_, view) = request(&f.app, "GET", &path, Some("owner"), json!(null)).await;
    assert_eq!(view["import"]["progress"], 100);
    // Ordinary rename survives a subsequent customer event.
    sqlx::query!(
        "UPDATE comms_channels SET name='Our important customer' WHERE id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    let now = connected_time(&f.repo, f.c.id).await;
    let live = envelope(
        "messages",
        json!({"metadata":{"phone_number_id":f.c.account_id},"messages":[{"id":"new-after-import","from":"customer-history","timestamp":now.timestamp().to_string(),"type":"text","text":{"body":"Back again"}}]}),
    );
    signed(&f.app, Provider::Whatsapp, live, true).await;
    drain(&f.service).await;
    assert_eq!(
        f.repo
            .message_target(f.c.id, "new-after-import")
            .await
            .unwrap()
            .0,
        channel
    );
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_some()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT name FROM comms_channels WHERE id=$1", channel)
            .fetch_one(&pool)
            .await
            .unwrap()
            .as_deref(),
        Some("Our important customer")
    );
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_import_recovers_pages_and_fences_expired_workers(pool: PgPool) {
    use meta_messaging::domain::history::*;
    let f = fixture(&pool, Provider::Instagram, None).await;
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    let mut first = incoming(&c, "ig-history-first");
    first.provenance = Provenance::OnboardingHistory;
    // A recent timestamp is still history and cannot open a service window.
    first.timestamp = Utc::now();
    f.remote
        .history_pages
        .lock()
        .unwrap()
        .push_back(Ok(HistoryPage {
            messages: vec![first.clone()],
            next: Some("page-2".into()),
        }));
    start_import(&f).await;
    let work = f.repo.claim_history_import().await.unwrap().unwrap();
    f.service.process_history_import(&work).await.unwrap();
    assert!(!f.repo.heartbeat_history_import(&work.lease).await.unwrap());
    assert!(
        f.repo
            .settle_history_import(&work, HistoryStatus::Complete, None, None)
            .await
            .is_err()
    );
    // A crash after native persistence but before cursor advancement replays safely.
    let abandoned = f.repo.claim_history_import().await.unwrap().unwrap();
    assert_eq!(abandoned.cursor.as_deref(), Some("page-2"));
    let mut second = first.clone();
    second.message_id = "ig-history-second".to_owned().try_into().unwrap();
    let native = fixture_native(&pool).await;
    native.ingest(&c, &second, vec![]).await.unwrap();
    sqlx::query!("UPDATE meta_messaging_history_import SET lease_until=now()-interval '1 second' WHERE connection_id=$1",c.id).execute(&pool).await.unwrap();
    f.remote
        .history_pages
        .lock()
        .unwrap()
        .push_back(Ok(HistoryPage {
            messages: vec![first, second],
            next: None,
        }));
    let recovered = f.repo.claim_history_import().await.unwrap().unwrap();
    assert_ne!(recovered.lease.token, abandoned.lease.token);
    assert!(
        !f.repo
            .heartbeat_history_import(&abandoned.lease)
            .await
            .unwrap()
    );
    f.service.process_history_import(&recovered).await.unwrap();
    assert_eq!(native_counts(&pool).await, (1, 2));
    let (channel, _) = f
        .repo
        .message_target(c.id, "ig-history-first")
        .await
        .unwrap();
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_none()
    );
    assert_eq!(
        f.repo.history_import(&c).await.unwrap().unwrap().status,
        HistoryStatus::Complete
    );
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
    assert_eq!(
        request(
            &f.app,
            "GET",
            &format!("/channels/{channel}"),
            Some("outsider"),
            json!(null)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn import_eligibility_disconnect_and_ambiguous_whatsapp_request(pool: PgPool) {
    use meta_messaging::domain::history::*;
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    sqlx::query!("UPDATE meta_messaging_connection SET developer_account=false,connected_at=now()-interval '25 hours' WHERE id=$1",f.c.id).execute(&pool).await.unwrap();
    let path = format!("/connections/{}/history", f.c.id);
    assert_eq!(
        request(&f.app, "POST", &path, Some("owner"), json!({}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::query!(
        "UPDATE meta_messaging_connection SET connected_at=now() WHERE id=$1",
        f.c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    start_import(&f).await;
    let work = f.repo.claim_history_import().await.unwrap().unwrap();
    // Mark the one-time request before external I/O; emulate crash after dispatch.
    f.repo
        .checkpoint_history_import(&work, HistoryStep::ContactsRequested, None, None)
        .await
        .unwrap();
    sqlx::query!("UPDATE meta_messaging_history_import SET lease_until=now()-interval '1 second' WHERE connection_id=$1",f.c.id).execute(&pool).await.unwrap();
    run_import(&f).await;
    assert_eq!(f.remote.history_requests.load(Ordering::SeqCst), 0);
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(
        f.repo.history_import(&c).await.unwrap().unwrap().status,
        HistoryStatus::Failed
    );
    assert_eq!(
        f.repo
            .history_import(&c)
            .await
            .unwrap()
            .unwrap()
            .error_code
            .as_deref(),
        Some("history_request_unconfirmed")
    );
    // Reauthorization invalidates old consent rather than reviving an automatic import.
    let c = f.repo.connect(&c, b"refreshed", Some(c.id)).await.unwrap();
    assert!(f.repo.history_import(&c).await.unwrap().is_none());
    f.repo
        .health(&c, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    start_import(&f).await;
    let work = f.repo.claim_history_import().await.unwrap().unwrap();
    f.repo.disconnect(c.team_id, c.id).await.unwrap();
    assert!(!f.repo.heartbeat_history_import(&work.lease).await.unwrap());
    assert!(f.repo.claim_history_import().await.unwrap().is_none());
    assert_eq!(
        request(&f.app, "POST", &path, Some("owner"), json!({}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_media_keeps_original_direction_and_reports_missing_files(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    sqlx::query!(
        "UPDATE meta_messaging_connection SET developer_account=false WHERE id=$1",
        f.c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    start_import(&f).await;
    run_import(&f).await;
    let placeholder = envelope(
        "history",
        json!({"metadata":{"phone_number_id":f.c.account_id},"history":[{"metadata":{"progress":100},"threads":[{"id":"media-customer","messages":[{"id":"outgoing-photo","from":"business-phone","timestamp":"1700000000","type":"media_placeholder"}]}]}]}),
    );
    signed(&f.app, Provider::Whatsapp, placeholder, true).await;
    drain(&f.service).await;
    // Meta may provide media in a separate envelope after progress reaches 100.
    let media = envelope(
        "history",
        json!({"metadata":{"phone_number_id":f.c.account_id},"messages":[{"id":"outgoing-photo","from":"business-phone","timestamp":"1700000000","type":"image","image":{"id":"unavailable-history-media"}}]}),
    );
    signed(&f.app, Provider::Whatsapp, media, true).await;
    drain(&f.service).await;
    assert_eq!(native_counts(&pool).await, (1, 1));
    let identity = f
        .repo
        .history_message_identity(f.c.id, &"outgoing-photo".to_owned().try_into().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(identity.0.as_str(), "media-customer");
    assert_eq!(identity.1, Direction::Outbound);
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert!(
        f.repo
            .history_import(&c)
            .await
            .unwrap()
            .unwrap()
            .unavailable_media
    );
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_event_after_historical_copy_can_open_the_real_window(pool: PgPool) {
    use meta_messaging::domain::history::*;
    let f = fixture(&pool, Provider::Instagram, None).await;
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    let mut m = incoming(&c, "overlapping-live-message");
    m.timestamp = connected_time(&f.repo, c.id).await;
    m.provenance = Provenance::OnboardingHistory;
    f.remote
        .history_pages
        .lock()
        .unwrap()
        .push_back(Ok(HistoryPage {
            messages: vec![m.clone()],
            next: None,
        }));
    start_import(&f).await;
    run_import(&f).await;
    let (channel, _) = f
        .repo
        .message_target(c.id, m.message_id.as_str())
        .await
        .unwrap();
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_none()
    );
    let live = json!({"object":"instagram","entry":[{"id":c.account_id,"messaging":[{"sender":{"id":m.customer_id},"recipient":{"id":c.account_id},"timestamp":m.timestamp.timestamp_millis(),"message":{"mid":m.message_id,"text":m.content}}]}]});
    signed(&f.app, Provider::Instagram, live, true).await;
    drain(&f.service).await;
    assert_eq!(native_counts(&pool).await, (1, 1));
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_some()
    );
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_instagram_import_resumes_without_resetting_completed_pages(pool: PgPool) {
    use meta_messaging::domain::history::*;
    let f = fixture(&pool, Provider::Instagram, None).await;
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    f.remote.history_pages.lock().unwrap().extend([
        Ok(HistoryPage {
            messages: vec![],
            next: Some("resume-at-page-2".into()),
        }),
        Err(MessagingError::ProviderAccessRequired.into()),
    ]);
    start_import(&f).await;
    run_import(&f).await;
    let status = f.repo.history_import(&c).await.unwrap().unwrap();
    assert_eq!(status.status, HistoryStatus::Failed);
    assert_eq!(
        status.error_code.as_deref(),
        Some("history_meta_access_required")
    );
    start_import(&f).await;
    let work = f.repo.claim_history_import().await.unwrap().unwrap();
    assert_eq!(work.cursor.as_deref(), Some("resume-at-page-2"));
    f.remote
        .history_pages
        .lock()
        .unwrap()
        .push_back(Ok(HistoryPage {
            messages: vec![],
            next: None,
        }));
    f.service.process_history_import(&work).await.unwrap();
    assert_eq!(
        f.repo.history_import(&c).await.unwrap().unwrap().status,
        HistoryStatus::Complete
    );
    assert_eq!(native_counts(&pool).await, (0, 0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whatsapp_history_stops_when_its_consenting_admin_loses_access(pool: PgPool) {
    use entity_access::domain::models::AdminTeamRole;
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    sqlx::query!(
        "UPDATE meta_messaging_connection SET developer_account=false WHERE id=$1",
        f.c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    let importer = user(&pool, "history-admin", Some(c.team_id)).await;
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id=$2",
        c.team_id,
        importer
    )
    .execute(&pool)
    .await
    .unwrap();
    let native = fixture_native(&pool).await;
    let actor = MacroUserIdStr::try_from(importer.clone()).unwrap();
    let access = native
        .access
        .generate_entity_access_receipt::<AdminTeamRole>(
            &actor.0,
            None,
            &c.team_id.to_string(),
            EntityType::Team,
        )
        .await
        .unwrap();
    f.service.import_history(&access, c.id).await.unwrap();
    run_import(&f).await;
    assert_eq!(f.remote.history_requests.load(Ordering::SeqCst), 2);
    sqlx::query!(
        "UPDATE team_user SET team_role='member' WHERE team_id=$1 AND user_id=$2",
        c.team_id,
        importer
    )
    .execute(&pool)
    .await
    .unwrap();
    let payload = envelope(
        "history",
        json!({"metadata":{"phone_number_id":c.account_id},"history":[{"metadata":{"progress":100},"threads":[{"id":"customer","messages":[{"id":"permission-lost-history","from":"customer","timestamp":"1700000000","type":"text","text":{"body":"Must not import after permission loss"}}]}]}]}),
    );
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    let receipt = f.repo.claim_receipt().await.unwrap().unwrap();
    let events = webhook::decode(receipt.provider, &receipt.payload).unwrap();
    assert_eq!(
        *f.service
            .process_receipt(&receipt, events.clone())
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::Forbidden
    );
    assert_eq!(native_counts(&pool).await, (0, 0));
    let import = f.repo.history_import(&c).await.unwrap().unwrap();
    assert_eq!(import.status, HistoryStatus::Failed);
    assert_eq!(
        import.error_code.as_deref(),
        Some("history_permission_lost")
    );
    // A late progress event and replay cannot silently restore revoked consent.
    f.repo
        .history_import_progress(&c, Some(100), false)
        .await
        .unwrap();
    f.service.process_receipt(&receipt, events).await.unwrap();
    assert_eq!(native_counts(&pool).await, (0, 0));
    assert_eq!(
        f.repo.history_import(&c).await.unwrap().unwrap().status,
        HistoryStatus::Failed
    );
    assert_eq!(
        f.repo.connection(c.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
}
