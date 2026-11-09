use super::*;
use crate::domain::enrollment::EnrollmentGeneration;

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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(0)
    );
    let creates = sqlx::query_scalar!("SELECT count(*) FROM hosted_runtime_effect WHERE computer_id = $1 AND effect->>'effect' = 'create'", computer.id.as_uuid())
        .fetch_one(&pool).await.unwrap();
    assert_eq!(creates, Some(0));
    let computer = repo
        .apply(computer.id, Event::PaymentConfirmed, now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(computer.enrollment_generation, EnrollmentGeneration::new(1));
    let outbox = sqlx::query_scalar!("SELECT effect FROM hosted_runtime_effect WHERE computer_id = $1 AND effect->>'effect' = 'create'", computer.id.as_uuid())
        .fetch_one(&pool).await.unwrap();
    assert_eq!(
        outbox,
        serde_json::json!({"effect":"create", "host": computer.state.host().unwrap(), "start":true, "generation":1})
    );
    // A duplicate payment event cannot reserve another generation.
    repo.apply(computer.id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    assert_eq!(
        repo.get(computer.id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrollment_guard_uses_the_claim_transaction_namespace(pool: PgPool) {
    let repo = PgComputerRepo::new(pool.clone());
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let guard = repo.lock_enrollment(id).await.unwrap();
    let mut claim = pool.begin().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('hosted-enrollment:' || $1::uuid::text, 0)) AS "locked!""#,
        id.as_uuid(),
    ).fetch_one(&mut *claim).await.unwrap();
    assert!(!locked);
    guard.rollback().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('hosted-enrollment:' || $1::uuid::text, 0)) AS "locked!""#,
        id.as_uuid(),
    ).fetch_one(&mut *claim).await.unwrap();
    assert!(locked);
}
