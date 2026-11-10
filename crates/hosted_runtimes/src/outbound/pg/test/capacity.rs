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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn allocation_counts_every_computer_holding_units_until_released(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    // 24 GB: 3 awake units, sold 3x.
    let host = repo
        .register_host(HostRegistration {
            name: "capacity-test".to_owned(),
            memory_gb: 24,
            reserve_gb: 0,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    let id = |n: u128| ComputerId::new_from_uuid(Uuid::from_u128(n));
    let drive = async |n: u128, events: &[Event]| {
        let mut phase = None;
        for event in events {
            phase = Some(
                repo.apply(id(n), event.clone(), now())
                    .await
                    .unwrap()
                    .unwrap()
                    .state
                    .phase,
            );
        }
        phase
    };

    // Awaiting payment.
    repo.reserve(standard(1), now()).await.unwrap();
    // Paid and starting.
    repo.reserve(standard(2), now()).await.unwrap();
    assert_eq!(
        drive(2, &[Event::PaymentConfirmed]).await,
        Some(Phase::Provisioning {
            host: host.id,
            start: true
        })
    );
    // Turned off: holds its disk and sold units, not host RAM.
    let mut large = standard(3);
    large.resources.memory_gib = crate::domain::size::MemoryGib::new(16);
    repo.reserve(large, now()).await.unwrap();
    assert_eq!(
        drive(
            3,
            &[
                Event::PaymentConfirmed,
                Event::InstanceStarted,
                Event::PowerOff,
                Event::InstanceStopped
            ]
        )
        .await,
        Some(Phase::Stopped { host: host.id })
    );
    // Payment refused.
    repo.reserve(standard(4), now()).await.unwrap();
    assert_eq!(
        drive(4, &[Event::PurchaseFailed]).await,
        Some(Phase::PaymentFailed)
    );
    // Released.
    repo.reserve(standard(5), now()).await.unwrap();
    assert_eq!(
        drive(5, &[Event::PaymentConfirmed, Event::ReleaseNow]).await,
        Some(Phase::Destroyed)
    );

    assert_eq!(
        repo.allocation().await.unwrap(),
        vec![HostAllocation {
            host,
            sold_units: 4,
            awake_units: 1,
            vcpus: 12,
            memory_gib: 32,
            disk_gib: 300,
        }]
    );
}
