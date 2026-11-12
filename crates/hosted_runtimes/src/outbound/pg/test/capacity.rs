use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn offers_use_free_sold_units_per_size(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
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
        repo.sold_out_sizes(&crate::domain::size::current_catalog(), now())
            .await
            .unwrap(),
        vec![]
    );
    for id in [1, 2, 3, 4, 5, 6] {
        bought(&repo, id).await;
    }
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog(), now())
            .await
            .unwrap(),
        vec![ComputerSize::Xl]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_purchases_share_the_sold_unit_limit(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
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
            repo.reserve(request, now(), now() + Duration::minutes(15))
                .await
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn allocation_counts_what_reserve_counts(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    // 24 GB: 3 awake units, sold 3x.
    let host = host(&repo, "capacity-test", 24, 0, 3).await;

    // Awaiting its charge.
    reserve(&repo, standard(1)).await;
    // Bought.
    bought(&repo, 2).await;
    // Bought and two units.
    let mut large = standard(3);
    large.resources.memory_gib = MemoryGib::new(16);
    let large = reserve(&repo, large).await;
    repo.convert_reservation(large.id, active(3), now())
        .await
        .unwrap()
        .unwrap();
    // Charge never landed.
    let refused = reserve(&repo, standard(4)).await;
    assert!(repo.delete_reservation(refused.id).await.unwrap());
    // Released.
    let released = bought(&repo, 5).await.id;
    changed(&repo, released, Event::ReleaseNow, now()).await;

    assert_eq!(
        repo.allocation().await.unwrap(),
        vec![HostAllocation {
            host,
            sold_units: 4,
            vcpus: 12,
            memory_gib: 32,
            disk_gib: 300,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pending_reservation_counts_toward_allocation(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    let host = host(&repo, "capacity-test", 24, 0, 3).await;

    reserve(&repo, standard(1)).await;

    assert_eq!(
        repo.allocation().await.unwrap(),
        vec![HostAllocation {
            host,
            sold_units: 1,
            vcpus: 4,
            memory_gib: 8,
            disk_gib: 100,
        }]
    );
}
