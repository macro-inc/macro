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
