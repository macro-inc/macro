use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn persona_reservations_cannot_oversell_awake_capacity(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "capacity-test".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    for (id, memory, persona, accepted) in [
        (1, 8, false, true),
        (2, 8, true, true),
        (3, 16, true, true),
        (4, 8, true, false),
        (5, 8, false, true),
    ] {
        let mut request = standard(id);
        request.resources.memory_gib = crate::domain::size::MemoryGib::new(memory);
        if persona {
            request.persona = Some(
                serde_json::from_value(serde_json::json!({
                    "name": "Test persona", "os_user": "test-agent",
                    "extra_service": { "unit_name": "test-agent", "exec": "/bin/true", "env": {} },
                    "config": {}
                }))
                .unwrap(),
            );
        }
        assert_eq!(
            repo.reserve(request, now()).await.is_ok(),
            accepted,
            "reservation {id}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn persona_offers_use_free_awake_units_per_size(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "capacity-test".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    for (always_on, sold_out) in [(false, vec![]), (true, vec![ComputerSize::Xl])] {
        assert_eq!(
            repo.sold_out_sizes(&crate::domain::size::current_catalog(), always_on)
                .await
                .unwrap(),
            sold_out
        );
    }
    let mut request = standard(1);
    request.persona = Some(serde_json::from_value(serde_json::json!({
        "name": "Test persona", "os_user": "test-agent",
        "extra_service": { "unit_name": "test-agent", "exec": "/bin/true", "env": {} }, "config": {}
    })).unwrap());
    repo.reserve(request, now()).await.unwrap();
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog(), true)
            .await
            .unwrap(),
        vec![ComputerSize::Xl]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_persona_purchases_share_the_awake_reservation_limit(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "capacity-test".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(4));
    let mut purchases = Vec::new();
    for id in [1, 2, 3, 4] {
        let repo = repo.clone();
        let barrier = barrier.clone();
        purchases.push(tokio::spawn(async move {
            let mut request = standard(id);
            request.persona = Some(serde_json::from_value(serde_json::json!({
                "name": "Test persona", "os_user": "test-agent",
                "extra_service": { "unit_name": "test-agent", "exec": "/bin/true", "env": {} }, "config": {}
            })).unwrap());
            barrier.wait().await;
            repo.reserve(request, now()).await
        }));
    }
    let mut accepted = 0;
    for purchase in purchases {
        match purchase.await.unwrap() {
            Ok(_) => accepted += 1,
            Err(ReserveError::SoldOut) => {}
            Err(error) => panic!("unexpected reservation error: {error:?}"),
        }
    }
    assert_eq!(accepted, 3);
}
