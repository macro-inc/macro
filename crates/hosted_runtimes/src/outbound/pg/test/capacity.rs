use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn offers_use_free_sold_units_per_size(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    // 24 GB: 3 awake units, sold 3x.
    repo.register_host(HostRegistration {
        name: "capacity-test".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog())
            .await
            .unwrap(),
        vec![]
    );
    for id in [1, 2, 3, 4, 5, 6] {
        repo.reserve(standard(id), now()).await.unwrap();
    }
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog())
            .await
            .unwrap(),
        vec![ComputerSize::Xl]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_purchases_share_the_sold_unit_limit(pool: PgPool) {
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
            // Three units each against nine sold units.
            let mut request = standard(id);
            request.resources.memory_gib = crate::domain::size::MemoryGib::new(24);
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
