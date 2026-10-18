use super::*;

async fn connect_platform(f: &Fixture) -> Uuid {
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"whatsapp"}),
    )
    .await;
    let (status, body) = request(
        &f.app,
        "POST",
        "/authorize/complete",
        Some("owner"),
        json!({"state":begin["state"],"code":"fixture-code","whatsapp_mode":"platform"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["registration_status"], "required");
    body["id"].as_str().unwrap().parse().unwrap()
}
async fn register(f: &Fixture, id: Uuid, pin: bool) -> (StatusCode, Value) {
    request(
        &f.app,
        "POST",
        &format!("/connections/{id}/register"),
        Some("owner"),
        if pin {
            json!({"pin":"123456"})
        } else {
            json!({})
        },
    )
    .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn exchanged_credentials_survive_registration_rejection_and_require_explicit_pin(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, Some("platform-phone")).await;
    let id = connect_platform(&f).await;
    assert!(f.repo.credential(id).await.is_ok());
    f.service.maintain().await.unwrap();
    assert!(!f.repo.connection(id).await.unwrap().unwrap().is_ready());
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 0);
    *f.remote.registration_result.lock().unwrap() = 1;
    let (status, body) = register(&f, id, true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["health_error"], "registration_pin_incorrect");
    assert_eq!(body["registration_status"], "required");
    assert!(f.repo.credential(id).await.is_ok());
    assert!(!serde_json::to_string(&body).unwrap().contains("123456"));
    *f.remote.registration_result.lock().unwrap() = 0;
    let (_, body) = register(&f, id, true).await;
    assert_eq!(body["registration_status"], "registered");
    assert_eq!(body["status"], "connected");
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 1);
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn uncertain_registration_reconciles_without_repeating_and_maintenance_cannot_promote_it(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, Some("platform-phone")).await;
    let id = connect_platform(&f).await;
    *f.remote.registration_result.lock().unwrap() = 2;
    assert_eq!(
        register(&f, id, true).await.1["registration_status"],
        "unconfirmed"
    );
    f.remote
        .registration_unavailable
        .store(true, Ordering::SeqCst);
    f.service.maintain().await.unwrap();
    assert!(!f.repo.connection(id).await.unwrap().unwrap().is_ready());
    register(&f, id, true).await;
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 1);
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/connections/{id}/register"),
            Some("outsider"),
            json!({"pin":"123456"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    f.remote
        .registration_unavailable
        .store(false, Ordering::SeqCst);
    f.remote.registered.store(true, Ordering::SeqCst);
    let (_, body) = register(&f, id, false).await;
    assert_eq!(body["status"], "connected");
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registration_limit_cooldown_is_renewed_on_a_new_rejected_attempt(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, Some("platform-phone")).await;
    let id = connect_platform(&f).await;
    *f.remote.registration_result.lock().unwrap() = 3;
    register(&f, id, true).await;
    register(&f, id, true).await;
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 1);
    sqlx::query!("UPDATE meta_messaging_connection SET registration_attempted_at=now()-interval '73 hours' WHERE id=$1",id).execute(&pool).await.unwrap();
    register(&f, id, true).await;
    register(&f, id, true).await;
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_positive_unregistered_check_allows_explicit_retry_without_reexchanging_credentials(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, Some("platform-phone")).await;
    let id = connect_platform(&f).await;
    *f.remote.registration_result.lock().unwrap() = 2;
    assert_eq!(
        register(&f, id, true).await.1["registration_status"],
        "unconfirmed"
    );
    let (_, body) = register(&f, id, false).await;
    assert_eq!(body["registration_status"], "required");
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 1);
    *f.remote.registration_result.lock().unwrap() = 0;
    assert_eq!(register(&f, id, true).await.1["status"], "connected");
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 2);
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connector_departure_during_provider_verification_prevents_registration(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, Some("platform-phone")).await;
    let id = connect_platform(&f).await;
    f.remote
        .pause_registration_check
        .store(true, Ordering::SeqCst);
    let app = f.app.clone();
    let operation = tokio::spawn(async move {
        request(
            &app,
            "POST",
            &format!("/connections/{id}/register"),
            Some("owner"),
            json!({"pin":"123456"}),
        )
        .await
    });
    f.remote.operation_entered.notified().await;
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    f.remote.operation_release.notify_one();
    assert_eq!(operation.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(f.remote.registrations.load(Ordering::SeqCst), 0);
}
