use firecracker_host_api::{Action, GuestImage, PowerState};

use super::super::test::{FakeMachines, FakeStore, Host, computer_id, create_request, host_with};
use crate::domain::model::{PreviousSystemDisk, SystemDisk};
use crate::domain::ports::{BootSource, GoldenAvailability};
use crate::domain::service::HostError;

/// The image `create_request` creates from.
const CREATED: &str = "macro-box/2026-11-17";
const NEXT: &str = "macro-box/2026-11-24a";

fn image(name: &str) -> GuestImage {
    GuestImage::try_new(name).unwrap()
}

async fn running_host() -> Host {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host
}

fn launches(host: &Host) -> Vec<BootSource> {
    host.machines
        .launches
        .lock()
        .unwrap()
        .iter()
        .map(|(source, _)| *source)
        .collect()
}

fn files(host: &Host) -> Vec<u32> {
    host.disks.1.lock().unwrap()[&computer_id()]
        .iter()
        .map(|disk| disk.0)
        .collect()
}

#[tokio::test]
async fn a_running_computer_cold_boots_a_clone_of_the_new_golden_and_keeps_its_old_disk() {
    let host = running_host().await;

    let computer = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();

    assert_eq!(computer.state, PowerState::Running);
    assert_eq!(computer.image, image(NEXT));
    assert_eq!(computer.previous_image, Some(image(CREATED)));
    // Restored from the golden at create, then a cold boot: never the new
    // golden's memory over this computer's `/home`.
    assert_eq!(launches(&host), [BootSource::Golden, BootSource::ColdBoot]);
    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.system_disk, SystemDisk(1));
    assert_eq!(
        record.previous_system_disk,
        Some(PreviousSystemDisk {
            disk: SystemDisk(0),
            image: image(CREATED),
        })
    );
    // Identity, enrollment and pairing are the create's.
    assert!(record.created_by(&create_request(1, true)));
    assert!(record.enrollment.is_some());
    assert_eq!(files(&host), [0, 1]);
}

#[tokio::test]
async fn repeating_it_once_the_image_is_in_place_changes_nothing() {
    let host = running_host().await;
    let first = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();

    let again = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();

    assert_eq!(again.image, first.image);
    assert_eq!(again.previous_image, first.previous_image);
    assert_eq!(launches(&host).len(), 2);
}

#[tokio::test]
async fn going_back_to_the_previous_image_boots_the_previous_disk_itself() {
    let host = running_host().await;
    host.service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();

    let computer = host
        .service
        .replace_system_disk(computer_id(), image(CREATED))
        .await
        .unwrap();

    assert_eq!(computer.state, PowerState::Running);
    assert_eq!(computer.image, image(CREATED));
    assert_eq!(computer.previous_image, Some(image(NEXT)));
    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.system_disk, SystemDisk(0));
    // Nothing cloned for the way back, and the failed disk is kept.
    assert_eq!(
        host.disks
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|operation| operation.starts_with("clone"))
            .count(),
        1
    );
    assert_eq!(files(&host), [0, 1]);
    assert_eq!(
        launches(&host),
        [
            BootSource::Golden,
            BootSource::ColdBoot,
            BootSource::ColdBoot
        ]
    );
}

#[tokio::test]
async fn a_third_image_drops_the_oldest_disk() {
    let host = running_host().await;
    for name in [NEXT, "macro-box/2026-11-25a"] {
        host.service
            .replace_system_disk(computer_id(), image(name))
            .await
            .unwrap();
    }

    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.system_disk, SystemDisk(2));
    assert_eq!(
        record.previous_system_disk.map(|previous| previous.image),
        Some(image(NEXT))
    );
    assert_eq!(files(&host), [1, 2]);
}

#[tokio::test]
async fn a_stopped_computer_stays_stopped_and_its_next_start_cold_boots_the_new_disk() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    // Never booted: its first start would have restored the golden.
    host.service
        .create(computer_id(), create_request(1, false))
        .await
        .unwrap();

    let computer = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();
    assert_eq!(computer.state, PowerState::Stopped);
    assert!(launches(&host).is_empty());

    host.service
        .power(computer_id(), Action::Start)
        .await
        .unwrap();
    assert_eq!(launches(&host), [BootSource::ColdBoot]);
}

#[tokio::test]
async fn a_hibernated_computer_is_refused_and_left_as_it_is() {
    let host = running_host().await;
    host.service
        .power(computer_id(), Action::Hibernate)
        .await
        .unwrap();

    let refused = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap_err();

    assert!(matches!(refused, HostError::Hibernated(_)));
    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.state, PowerState::Hibernated);
    assert_eq!(record.image, image(CREATED));
}

#[tokio::test]
async fn without_the_new_golden_nothing_is_stopped() {
    let host = running_host().await;
    *host.goldens.0.lock().unwrap() = GoldenAvailability::Absent;

    let refused = host
        .service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap_err();

    assert!(matches!(refused, HostError::GoldenNotReady(_)));
    assert_eq!(host.goldens.1.lock().unwrap()[0].image, image(NEXT));
    assert_eq!(launches(&host).len(), 1);
    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.state, PowerState::Running);
}

#[tokio::test]
async fn a_failed_clone_boots_the_old_disk_again() {
    let host = running_host().await;

    let failed = host
        .service
        .replace_system_disk(computer_id(), image("unclonable"))
        .await
        .unwrap_err();

    assert!(matches!(failed, HostError::Internal(_)));
    let record = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(record.state, PowerState::Running);
    assert_eq!(record.image, image(CREATED));
    assert_eq!(record.system_disk, SystemDisk(0));
    assert_eq!(launches(&host), [BootSource::Golden, BootSource::ColdBoot]);
}

#[tokio::test]
async fn a_failed_save_dropping_the_previous_disk_keeps_it_in_the_record() {
    let host = running_host().await;
    host.service
        .replace_system_disk(computer_id(), image(NEXT))
        .await
        .unwrap();
    let stopped = host
        .service
        .power(computer_id(), Action::Stop)
        .await
        .unwrap();
    assert_eq!(stopped.state, PowerState::Stopped);

    // The save that drops the previous disk fails.
    *host.store.1.lock().unwrap() = 1;
    host.service
        .replace_system_disk(computer_id(), image("macro-box/2026-11-25a"))
        .await
        .unwrap_err();

    let computer = host.service.get(computer_id()).await.unwrap();
    assert_eq!(computer.previous_image, Some(image(CREATED)));
    assert_eq!(files(&host), [0, 1]);
}
