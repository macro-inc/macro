use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn confirmed_payment_clears_recovery_and_creation_is_due_immediately(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    repo.register_host(HostRegistration {
        name: "payment-host".to_owned(),
        memory_gb: 32,
        reserve_gb: 4,
        oversell_factor: 2,
    })
    .await
    .unwrap();
    let reserved = repo.reserve(standard(71), now()).await.unwrap();
    assert!(matches!(reserved.state.phase, Phase::PendingPayment { .. }));
    let confirmed = repo
        .apply(reserved.id, Event::PaymentConfirmed, now())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(confirmed.state.phase, Phase::Provisioning { .. }));
    repo.apply(reserved.id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT COUNT(*) AS \"count!\" FROM hosted_runtime_effect WHERE computer_id = $1 AND worker = 'billing'",
        reserved.id.as_uuid(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(row.count, 0);
    let effects = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(effects.len(), 1);
    assert!(matches!(effects[0].effect, Effect::Create { .. }));
    repo.complete_effect(effects[0].id).await.unwrap();
    assert!(
        repo.lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.lease_effects(
            EffectWorker::Billing,
            10,
            now() + crate::domain::lifecycle::PAYMENT_CONFIRM_DELAY,
            now() + Duration::minutes(3)
        )
        .await
        .unwrap()
        .is_empty()
    );
}
