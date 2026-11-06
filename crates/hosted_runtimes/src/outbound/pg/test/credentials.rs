use super::*;
use crate::domain::persona_credentials::EnrollmentGeneration;
use std::collections::BTreeMap;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn generations_and_create_outbox_never_persist_issuance_material(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    repo.register_host(HostRegistration {
        name: "fixture-host".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    let computer = repo.reserve(standard(1), now()).await.unwrap();
    assert_eq!(computer.enrollment_generation, EnrollmentGeneration::new(0));
    let computer = repo
        .apply(computer.id, Event::PaymentConfirmed, now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(computer.enrollment_generation, EnrollmentGeneration::new(0));
    let outbox = sqlx::query_scalar!("SELECT effect FROM hosted_runtime_effect WHERE computer_id = $1 AND effect->>'effect' = 'create'", computer.id.into_inner())
        .fetch_one(&pool).await.unwrap();
    assert_eq!(
        outbox,
        serde_json::json!({"effect":"create", "host": computer.state.host().unwrap(), "start":true, "generation":1})
    );
    for forbidden in [
        "fixture-issued-value-1",
        "MACRO_API_KEY",
        "secrets",
        "persona_enrollment",
        "https://app.example.com",
    ] {
        assert!(!outbox.to_string().contains(forbidden));
    }
    assert!(
        repo.record_generation(computer.id, EnrollmentGeneration::new(1))
            .await
            .unwrap()
    );
    assert!(
        repo.record_generation(computer.id, EnrollmentGeneration::new(1))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .record_generation(computer.id, EnrollmentGeneration::new(3))
            .await
            .unwrap()
    );
    assert_eq!(
        repo.get(computer.id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
    repo.apply(computer.id, Event::InstanceStarted, now())
        .await
        .unwrap();
    repo.apply(computer.id, Event::InstanceLost, now())
        .await
        .unwrap();
    assert!(
        repo.record_generation(computer.id, EnrollmentGeneration::new(2))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .record_generation(computer.id, EnrollmentGeneration::new(1))
            .await
            .unwrap()
    );
    assert_eq!(
        repo.get(computer.id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_removes_bootstrap_values_from_both_maps_and_keeps_non_secret_config(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    repo.register_host(HostRegistration {
        name: "fixture-host".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    let computer = repo.reserve(standard(1), now()).await.unwrap();
    let persona = serde_json::json!({
        "name":"Worker", "os_user":"worker",
        "config":{"MACRO_API_KEY":"fixture-api-value", "MACRO_REPO_TOKEN":"fixture-repo-value", "ANTHROPIC_AUTH_TOKEN":"fixture-auth-value", "OTHER_SECRET":"fixture-secret-value", "lower_key":"fixture-lower-value", "AGENT_ID":"fixture-agent"},
        "extra_service":{"unit_name":"worker","exec":"/bin/worker","env":{"MACRO_API_KEY":"fixture-api-value", "MACRO_REPO_TOKEN":"fixture-repo-value", "ANTHROPIC_AUTH_TOKEN":"fixture-auth-value", "OTHER_SECRET":"fixture-secret-value", "RUST_LOG":"info"}}
    });
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = $2 WHERE id = $1",
        computer.id.into_inner(),
        persona
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../macro_db_client/migrations/20261106175722_strip_persisted_persona_bootstrap_values.sql"
    )))
    .execute(&pool)
    .await
    .unwrap();
    let persona = repo
        .get(computer.id)
        .await
        .unwrap()
        .unwrap()
        .persona
        .unwrap();
    assert_eq!(
        persona.config,
        BTreeMap::from([(
            crate::domain::enrollment::PersonaConfigKey::parse("AGENT_ID").unwrap(),
            "fixture-agent".to_owned()
        )])
    );
    assert_eq!(
        persona.extra_service.env,
        BTreeMap::from([(
            crate::domain::enrollment::PersonaConfigKey::parse("RUST_LOG").unwrap(),
            "info".to_owned()
        )])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrollment_guard_uses_the_claim_transaction_namespace(pool: PgPool) {
    let repo = PgComputerRepo::new(pool.clone());
    let id = ComputerId::new(Uuid::from_u128(1));
    let guard = repo.lock_enrollment(id).await.unwrap();
    let mut claim = pool.begin().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('hosted-enrollment:' || $1::uuid::text, 0)) AS "locked!""#,
        id.into_inner(),
    ).fetch_one(&mut *claim).await.unwrap();
    assert!(!locked);
    guard.rollback().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('hosted-enrollment:' || $1::uuid::text, 0)) AS "locked!""#,
        id.into_inner(),
    ).fetch_one(&mut *claim).await.unwrap();
    assert!(locked);
}
