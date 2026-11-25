use super::*;
use crate::domain::image_upgrade::{
    ComputerUpgradeState, ImageFile, ImageFileName, ImageSource, ImageUpgrades, ImageVersion,
    NewImageUpgrade, Sha256, SourceUrl, StartUpgradeError, UpgradeState,
};
use crate::domain::moves::ComputerMoves;
use crate::domain::operator::start_image_upgrade;

fn request(computers: Vec<ComputerId>, bytes: u64) -> NewImageUpgrade {
    NewImageUpgrade {
        image: ImageVersion::try_new("macro-box/2026-11-24a").unwrap(),
        sources: [
            ImageFileName::Vmlinux,
            ImageFileName::RootfsExt4,
            ImageFileName::BootArgs,
        ]
        .into_iter()
        .map(|name| ImageSource {
            file: ImageFile {
                name,
                sha256: Sha256::try_new(&"c".repeat(64)).unwrap(),
                bytes,
            },
            url: SourceUrl::try_new("https://bucket/file.zst?X-Amz-Signature=s").unwrap(),
        })
        .collect(),
        computers,
        batch_size: 2,
        idle_wait: chrono::Duration::minutes(30),
        reconnect_timeout: chrono::Duration::minutes(10),
        created_by: "https://github.com/macro-inc/macro/actions/runs/1".to_owned(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_upgrade_is_leased_by_one_replica_holds_its_computers_and_hears_macrod(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = host(&repo, "upgrade-host", 32, 0, 3).await;
    let computer = bought(&repo, 1).await;
    changed(&repo, computer.id, Event::InstanceStarted, now()).await;
    changed(&repo, computer.id, Event::MacrodConnected, now()).await;

    let created = start_image_upgrade(&repo, &request(vec![computer.id], 7), now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(created.state, UpgradeState::Staging);
    assert_eq!(created.sources.as_ref().unwrap().len(), 3);
    // One unfinished upgrade at a time.
    assert_eq!(
        start_image_upgrade(&repo, &request(vec![computer.id], 7), now())
            .await
            .unwrap(),
        Err(StartUpgradeError::AnotherUnderWay)
    );

    let first = uuid::Uuid::now_v7();
    let second = uuid::Uuid::now_v7();
    let until = now() + chrono::Duration::minutes(5);
    let (leased, mut computers) = repo
        .lease_upgrade(first, now(), until)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(leased, created);
    assert_eq!(computers.len(), 1);
    assert!(
        repo.lease_upgrade(second, now(), until)
            .await
            .unwrap()
            .is_none()
    );
    // Its own lease renews.
    assert!(
        repo.lease_upgrade(first, now(), until)
            .await
            .unwrap()
            .is_some()
    );

    // Under way: held, and a macrod connection is noted.
    let row = &mut computers[0];
    row.state = ComputerUpgradeState::Verifying;
    row.old_image = Some(GuestImage::try_new("macro-box/2026-11-19a").unwrap());
    row.phase_started_at = Some(now());
    assert!(
        repo.update_computer_upgrade(first, row, now())
            .await
            .unwrap()
    );
    assert!(repo.held(computer.id).await.unwrap());
    assert_eq!(
        repo.held_on(host.id).await.unwrap(),
        std::collections::HashSet::from([computer.id])
    );
    let later = now() + chrono::Duration::seconds(20);
    changed(&repo, computer.id, Event::MacrodDisconnected, later).await;
    changed(&repo, computer.id, Event::MacrodConnected, later).await;
    let (_, computers) = repo.upgrade(created.id).await.unwrap().unwrap();
    assert_eq!(computers[0].reconnected_at, Some(later));
    assert!(computers[0].reconnected());

    // Finished: released, and the version stays bound to its files.
    let mut done = leased.clone();
    done.state = UpgradeState::Done;
    done.sources = None;
    let mut row = computers[0].clone();
    row.state = ComputerUpgradeState::Upgraded;
    assert!(
        repo.update_computer_upgrade(first, &row, now())
            .await
            .unwrap()
    );
    // Another replica's writes are refused.
    assert!(
        !repo
            .update_upgrade(second, &done, true, now())
            .await
            .unwrap()
    );
    assert!(
        repo.update_upgrade(first, &done, true, now())
            .await
            .unwrap()
    );
    assert!(!repo.held(computer.id).await.unwrap());
    assert!(
        repo.lease_upgrade(second, now(), until)
            .await
            .unwrap()
            .is_none()
    );
    let (stored, _) = repo.upgrade(created.id).await.unwrap().unwrap();
    assert_eq!(stored.state, UpgradeState::Done);
    assert!(stored.sources.is_none());
    assert_eq!(
        start_image_upgrade(&repo, &request(vec![computer.id], 8), now())
            .await
            .unwrap(),
        Err(StartUpgradeError::VersionReused(
            ImageVersion::try_new("macro-box/2026-11-24a").unwrap()
        ))
    );
    assert!(
        start_image_upgrade(&repo, &request(vec![computer.id], 7), now())
            .await
            .unwrap()
            .is_ok()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_upgrade_of_an_unknown_computer_is_refused(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let unknown = ComputerId::new_from_uuid(uuid::Uuid::from_u128(404));
    assert_eq!(
        start_image_upgrade(&repo, &request(vec![unknown], 7), now())
            .await
            .unwrap(),
        Err(StartUpgradeError::UnknownComputer(unknown))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn runtime_update_and_image_replacement_hold_the_computer_exclusively(pool: PgPool) {
    use crate::domain::runtime_update::{RuntimeBundle, RuntimeUpdateOutcome, RuntimeUpdates};

    insert_team(&pool).await;
    let agent = super::agents::insert_agent(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let microvm = host(&repo, "runtime-host", 32, 0, 3).await;
    sqlx::query!(
        "UPDATE hosted_runtime_host SET endpoint = 'https://host.invalid', server_certificate_pem = 'fixture' WHERE id = $1",
        microvm.id.into_inner(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut purchase = standard(1);
    purchase.agent = Some(agent);
    let reservation = reserve(&repo, purchase).await;
    let computer = repo
        .convert_reservation(reservation.id, active(1), now())
        .await
        .unwrap()
        .unwrap();
    changed(&repo, computer.id, Event::InstanceStarted, now()).await;
    changed(&repo, computer.id, Event::MacrodConnected, now()).await;

    let version = "a".repeat(40);
    let bundle = RuntimeBundle {
        digest: "b".repeat(64),
        url: format!(
            "https://fixture.s3.amazonaws.com/agent-runtime-bundles/{version}/runtime.tar.zst?X-Amz-Signature=fixture"
        ),
        version,
    };
    let id = repo
        .request_runtime_update(computer.id, &bundle)
        .await
        .unwrap()
        .unwrap();
    assert!(
        repo.request_runtime_update(computer.id, &bundle)
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.held(computer.id).await.unwrap());
    assert!(
        repo.held_on(microvm.id)
            .await
            .unwrap()
            .contains(&computer.id)
    );

    start_image_upgrade(&repo, &request(vec![computer.id], 7), now())
        .await
        .unwrap()
        .unwrap();
    let image_holder = Uuid::now_v7();
    let (_, mut images) = repo
        .lease_upgrade(image_holder, now(), now() + Duration::minutes(5))
        .await
        .unwrap()
        .unwrap();
    let image = &mut images[0];
    image.state = ComputerUpgradeState::Replacing;
    assert!(
        !repo
            .update_computer_upgrade(image_holder, image, now())
            .await
            .unwrap()
    );

    assert!(
        repo.claim_runtime_update(
            Uuid::now_v7(),
            Duration::minutes(15),
            &[crate::domain::ids::HostId::new(Uuid::now_v7())],
        )
        .await
        .unwrap()
        .is_none()
    );
    let previous = repo
        .claim_runtime_update(Uuid::now_v7(), Duration::zero(), &[microvm.id])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(previous.id, id);
    assert!(!previous.attempted);
    let holder = Uuid::now_v7();
    let claimed = repo
        .claim_runtime_update(holder, Duration::minutes(15), &[microvm.id])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, id);
    assert!(claimed.attempted);
    assert!(
        repo.claim_runtime_update(Uuid::now_v7(), Duration::minutes(15), &[microvm.id])
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        !repo
            .finish_runtime_update(Uuid::now_v7(), id, RuntimeUpdateOutcome::Applied)
            .await
            .unwrap()
    );
    sqlx::query!(
        "UPDATE agent_runtime_update SET deadline_at = now() WHERE id = $1",
        id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut holder = holder;
    assert!(
        !repo
            .defer_runtime_update_settlement(Uuid::now_v7(), id)
            .await
            .unwrap()
    );
    for terminal in [false, false, true] {
        assert_eq!(
            repo.defer_runtime_update_settlement(holder, id)
                .await
                .unwrap(),
            terminal
        );
        if terminal {
            break;
        }
        assert!(repo.held_for_image(computer.id).await.unwrap());
        sqlx::query!(
            "UPDATE agent_runtime_update SET lease_until = now() WHERE id = $1",
            id,
        )
        .execute(&pool)
        .await
        .unwrap();
        holder = Uuid::now_v7();
        repo.claim_runtime_update(holder, Duration::minutes(15), &[microvm.id])
            .await
            .unwrap()
            .unwrap();
    }
    assert_eq!(
        repo.runtime_update_outcome(id).await.unwrap(),
        Some(RuntimeUpdateOutcome::NeedsOperator)
    );
    assert!(repo.held(computer.id).await.unwrap());
    assert!(!repo.held_for_image(computer.id).await.unwrap());
    for event in [Event::PowerOn, Event::PowerOff, Event::ReleaseNow] {
        assert!(matches!(
            repo.apply(computer.id, event, now()).await.unwrap(),
            Some(Applied::Rejected(Rejected::RuntimeUpdateInProgress))
        ));
    }
    assert!(
        repo.request_runtime_update(computer.id, &bundle)
            .await
            .unwrap()
            .is_none()
    );

    assert!(
        repo.update_computer_upgrade(image_holder, image, now())
            .await
            .unwrap()
    );
    assert!(
        repo.request_runtime_update(computer.id, &bundle)
            .await
            .unwrap()
            .is_none()
    );
    image.state = ComputerUpgradeState::Upgraded;
    assert!(
        repo.update_computer_upgrade(image_holder, image, now())
            .await
            .unwrap()
    );
    assert!(!repo.held(computer.id).await.unwrap());
    assert!(
        repo.request_runtime_update(computer.id, &bundle)
            .await
            .unwrap()
            .is_some()
    );
}
