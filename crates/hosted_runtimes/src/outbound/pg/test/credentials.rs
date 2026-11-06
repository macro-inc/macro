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
    let mut tx = pool.begin().await.unwrap();
    let reserved =
        PgComputerRepo::apply_locked(&mut tx, computer.id, &Event::PaymentConfirmed, now())
            .await
            .unwrap()
            .unwrap();
    assert_eq!(reserved.enrollment_generation, EnrollmentGeneration::new(1));
    tx.rollback().await.unwrap();
    assert_eq!(
        repo.get(computer.id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(0)
    );
    let creates = sqlx::query_scalar!("SELECT count(*) FROM hosted_runtime_effect WHERE computer_id = $1 AND effect->>'effect' = 'create'", computer.id.into_inner())
        .fetch_one(&pool).await.unwrap();
    assert_eq!(creates, Some(0));
    let computer = repo
        .apply(computer.id, Event::PaymentConfirmed, now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(computer.enrollment_generation, EnrollmentGeneration::new(1));
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
    // A duplicate payment event cannot reserve another generation.
    repo.apply(computer.id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
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

#[sqlx::test(migrations = false)]
async fn personas_decode_after_forward_bootstrap_cleanup(pool: PgPool) {
    // SQLx owns this disposable test database; CI may seed it from a migrated template.
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(&pool)
        .await
        .unwrap();
    const STRIP_VERSION: i64 = 20261106175722;
    let before_strip = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < STRIP_VERSION)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_strip.run(&pool).await.unwrap();
    insert_team(&pool).await;
    let id = ComputerId::new(Uuid::from_u128(1));
    let persona = serde_json::json!({
        "name": "Worker", "os_user": "worker",
        "config": {"MACRO_API_KEY": "fixture-api-value", "REPO_TOKEN": "fixture-repo-value", "SOME_SECRET": "fixture-secret-value", "REPO_URL": "https://example.com/repo"},
        "extra_service": {"unit_name": "worker", "exec": "/bin/worker", "env": {"MACRO_API_KEY": "fixture-api-value", "REPO_TOKEN": "fixture-repo-value", "SOME_SECRET": "fixture-secret-value", "REPO_URL": "https://example.com/service"}}
    });
    // Insert raw JSON using the schema before stripping; no Persona has decoded it.
    sqlx::query!(
        r#"INSERT INTO hosted_runtime
        (id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry,
         price_id, state, persona, created_by)
        VALUES ($1, $2, 'Worker', 'standard', 4, 8, 100, 'standard@2026-11',
                'price_standard', $3, $4, 'macro|owner@example.com')"#,
        id.into_inner(),
        TEAM,
        serde_json::to_value(ComputerState::reserved(
            HostId::new(Uuid::from_u128(2)),
            now()
        ))
        .unwrap(),
        persona,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgComputerRepo::new(pool.clone());
    assert!(repo.get(id).await.is_err());
    // Apply the original strip and every forward migration before decoding.
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    let persona = repo.get(id).await.unwrap().unwrap().persona.unwrap();
    assert_eq!(persona.config.len(), 1);
    assert_eq!(
        persona.config.get("REPO_URL").unwrap(),
        "https://example.com/repo"
    );
    assert_eq!(persona.extra_service.env.len(), 1);
    assert_eq!(
        persona.extra_service.env.get("REPO_URL").unwrap(),
        "https://example.com/service"
    );

    // The new forward cleanup matches the case-sensitive validator exactly.
    let persona = serde_json::json!({
        "name": "Worker", "os_user": "worker",
        "config": {"MACRO_API_KEY": "fixture-api-value", "lower_key": "non-secret", "REPO_URL": "https://example.com/repo"},
        "extra_service": {"unit_name": "worker", "exec": "/bin/worker", "env": {"SOME_SECRET": "fixture-secret-value", "lower_token": "non-secret"}}
    });
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = $2 WHERE id = $1",
        id.into_inner(),
        persona
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),
        "/../macro_db_client/migrations/20261106183859_strip_persona_bootstrap_keys_case_sensitively.sql")))
        .execute(&pool).await.unwrap();
    let persona = repo.get(id).await.unwrap().unwrap().persona.unwrap();
    assert_eq!(persona.config.len(), 2);
    assert_eq!(persona.config.get("lower_key").unwrap(), "non-secret");
    assert_eq!(persona.extra_service.env.len(), 1);
    assert_eq!(
        persona.extra_service.env.get("lower_token").unwrap(),
        "non-secret"
    );
}

#[test]
fn bootstrap_strip_follows_every_persona_schema_migration() {
    // Persona's creating migration must precede the cleanup. Later cleanups are
    // data-only; future persona schema changes must also preserve this ordering.
    let schema_changes: Vec<_> = MACRO_DB_MIGRATIONS
        .iter()
        .filter(|migration| {
            migration.sql.contains("CREATE TABLE hosted_runtime (")
                || (migration.sql.contains("ALTER TABLE hosted_runtime")
                    && migration.sql.contains("persona"))
        })
        .collect();
    assert!(!schema_changes.is_empty());
    for migration in schema_changes {
        assert!(
            migration.version < 20261106175722,
            "{}",
            migration.description
        );
    }
}
