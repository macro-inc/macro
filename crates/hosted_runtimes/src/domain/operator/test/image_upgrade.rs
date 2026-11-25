//! A whole image upgrade through the operator's upgrade pass, with a fake
//! host whose system disk replacement answers at once.

use std::str::FromStr;

use super::host_scope::{TwoHosts, two_host_operator};
use super::*;
use crate::domain::image_upgrade::{
    ComputerUpgradeState, HostImageError, HostImages, ImageFile, ImageFileName, ImageSource,
    ImageVersion, NewImageUpgrade, Sha256, SourceUrl, StagedImage, StartUpgradeError,
    SystemDiskState, UpgradeState,
};
use crate::domain::lifecycle::Phase;
use crate::domain::moves::ComputerMoves;
use crate::domain::ports::ComputersInUseFuture;

const NEW_IMAGE: &str = "macro-box/2026-11-24a";

impl HostImageError for FakeFleetError {
    fn is_golden_not_ready(&self) -> bool {
        matches!(self, Self::GoldenNotReady)
    }

    fn is_refused(&self) -> bool {
        matches!(self, Self::Rejected)
    }
}

impl FakeFleet {
    fn disk_of(&self, computer_id: ComputerId) -> (String, Option<String>, bool) {
        self.system_disks
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_insert_with(|| (BASE_IMAGE.to_owned(), None, true))
            .clone()
    }

    fn state_of_disk(&self, computer_id: ComputerId) -> SystemDiskState {
        let (image, previous, running) = self.disk_of(computer_id);
        SystemDiskState {
            image: GuestImage::try_new(&image).unwrap(),
            previous_image: previous.map(|image| GuestImage::try_new(&image).unwrap()),
            running,
        }
    }

    fn listed(&self, list: &Mutex<Vec<String>>, image: &GuestImage) -> bool {
        list.lock().unwrap().contains(&image.as_str().to_owned())
    }
}

/// Like the host agent: the current image is a no-op, the previous one
/// swaps back, a new one needs its golden; a disk that does not boot leaves
/// the computer stopped on it.
impl HostImages for FakeFleet {
    type Err = FakeFleetError;

    async fn stage_image(
        &self,
        image: &ImageVersion,
        sources: &[ImageSource],
    ) -> Result<StagedImage, FakeFleetError> {
        assert_eq!(sources.len(), 3);
        self.calls.lock().unwrap().push(format!("stage {image}"));
        Ok(StagedImage::Staging)
    }

    async fn staged_image(&self, _image: &ImageVersion) -> Result<StagedImage, FakeFleetError> {
        let mut staged = self.staged.lock().unwrap();
        Ok(if staged.len() > 1 {
            staged.remove(0)
        } else {
            staged.first().cloned().unwrap_or(StagedImage::Staging)
        })
    }

    async fn replace_system_disk(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> Result<SystemDiskState, FakeFleetError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("replace {computer_id} {}", image.as_str()));
        let (current, previous, running) = self.disk_of(computer_id);
        if current == image.as_str() {
            return Ok(self.state_of_disk(computer_id));
        }
        let going_back = previous.as_deref() == Some(image.as_str());
        if !going_back {
            if self.listed(&self.refused_images, image) {
                return Err(FakeFleetError::Rejected);
            }
            if self.listed(&self.building_images, image) {
                return Err(FakeFleetError::GoldenNotReady);
            }
        }
        if self.listed(&self.put_back_images, image) {
            self.system_disks
                .lock()
                .unwrap()
                .insert(computer_id, (current, previous, false));
            return Err(FakeFleetError::Unavailable);
        }
        let boots = !self.listed(&self.broken_images, image);
        self.system_disks.lock().unwrap().insert(
            computer_id,
            (image.as_str().to_owned(), Some(current), running && boots),
        );
        if running && !boots {
            return Err(FakeFleetError::Unavailable);
        }
        Ok(self.state_of_disk(computer_id))
    }

    async fn system_disk(&self, computer_id: ComputerId) -> Result<SystemDiskState, FakeFleetError> {
        Ok(self.state_of_disk(computer_id))
    }
}

/// Computers in use: the ones listed.
struct InUse(Mutex<Vec<ComputerId>>);

impl crate::domain::ports::ComputersInUse for InUse {
    fn in_use<'a>(&'a self, candidates: &'a [ComputerId]) -> ComputersInUseFuture<'a> {
        let busy: std::collections::HashSet<ComputerId> = candidates
            .iter()
            .filter(|id| self.0.lock().unwrap().contains(id))
            .copied()
            .collect();
        Box::pin(async move { Ok(busy) })
    }
}

type Operator = ComputerOperator<FakeRepo, TwoHosts, FakeHarnesses, FixedClock, FakeSetupNotices>;

fn file(name: ImageFileName) -> ImageFile {
    ImageFile {
        name,
        sha256: Sha256::try_new(&"b".repeat(64)).unwrap(),
        bytes: 7,
    }
}

fn files() -> Vec<ImageFile> {
    vec![
        file(ImageFileName::Vmlinux),
        file(ImageFileName::RootfsExt4),
        file(ImageFileName::BootArgs),
    ]
}

fn request(computers: Vec<ComputerId>, batch_size: u8) -> NewImageUpgrade {
    NewImageUpgrade {
        image: ImageVersion::try_new(NEW_IMAGE).unwrap(),
        sources: files()
            .into_iter()
            .map(|file| ImageSource {
                url: SourceUrl::try_new(&format!("https://bucket/{}.zst", file.name)).unwrap(),
                file,
            })
            .collect(),
        computers,
        batch_size,
        idle_wait: Duration::minutes(30),
        reconnect_timeout: Duration::minutes(10),
        created_by: "https://github.com/macro-inc/macro/actions/runs/1".to_owned(),
    }
}

/// A running computer with macrod connected on the home host, on the old
/// image.
async fn running(operator: &Operator, n: u128) -> ComputerId {
    let id = ComputerId::new_from_uuid(Uuid::from_u128(n));
    operator
        .repo
        .reserve(
            NewReservation {
                id,
                team_id: TEAM,
                purchase_key: crate::domain::models::PurchaseKey::try_new(format!("buy-{n}"))
                    .unwrap(),
                name: ComputerName::try_new("Ada").unwrap(),
                size: ComputerSize::Standard,
                resources: crate::domain::size::ComputerResources {
                    vcpus: crate::domain::size::Vcpus::new(4),
                    memory_gib: crate::domain::size::MemoryGib::new(8),
                    disk_gib: crate::domain::size::DiskGib::new(100),
                },
                catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                    "standard@2026-11".to_owned(),
                )
                .unwrap(),
                funding: crate::domain::models::Funding::Stripe {
                    price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                },
                created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                extra_items: vec![],
                provision_traceparent: None,
                agent: None,
            },
            now(),
            now() + Duration::minutes(15),
        )
        .await
        .unwrap();
    operator
        .repo
        .convert_reservation(
            id,
            crate::domain::lifecycle::Billing::Active {
                subscription_item: format!("si_{n}").parse().unwrap(),
            },
            now(),
        )
        .await
        .unwrap()
        .unwrap();
    let mut computers = operator.repo.computers.lock().unwrap();
    let computer = computers.get_mut(&id).unwrap();
    computer.state.phase = Phase::Running;
    computer.state.macrod_connected = true;
    computer.image = Some(GuestImage::try_new(BASE_IMAGE).unwrap());
    id
}

async fn upgrade_operator(in_use: Vec<ComputerId>) -> Operator {
    two_host_operator()
        .await
        .with_computers_in_use(std::sync::Arc::new(InUse(Mutex::new(in_use))))
}

/// The home host holds the image's files from now on.
fn staged_everywhere(operator: &Operator) {
    *operator.fleet.home.staged.lock().unwrap() = vec![StagedImage::Ready(Some(files()))];
}

/// Stage the image (the first pass asks the host, the second sees it
/// staged), then run the first rolling pass.
async fn stage_and_roll(operator: &Operator) {
    staged_everywhere(operator);
    for _ in 0..2 {
        operator.advance_image_upgrade().await.unwrap();
    }
    assert_eq!(upgrade_state(operator).0, UpgradeState::Rolling);
    operator.advance_image_upgrade().await.unwrap();
}

fn state_of(operator: &Operator, id: ComputerId) -> ComputerUpgradeState {
    operator.repo.image_upgrades.lock().unwrap()[0]
        .computers
        .iter()
        .find(|computer| computer.computer_id == id)
        .unwrap()
        .state
}

fn upgrade_state(operator: &Operator) -> (UpgradeState, bool) {
    let stored = &operator.repo.image_upgrades.lock().unwrap()[0];
    (stored.upgrade.state, stored.finished)
}

fn image_of(operator: &Operator, id: ComputerId) -> String {
    operator.repo.computers.lock().unwrap()[&id]
        .image
        .as_ref()
        .unwrap()
        .as_str()
        .to_owned()
}

/// Move every computer under way past its reconnect timeout.
fn time_out(operator: &Operator) {
    for computer in &mut operator.repo.image_upgrades.lock().unwrap()[0].computers {
        if computer.state.holds_computer() {
            computer.phase_started_at = Some(now() - Duration::minutes(11));
        }
    }
}

#[tokio::test]
async fn a_staged_image_reaches_an_idle_computer_which_counts_once_macrod_connects() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();

    // Staging: the host is asked once, then polled until it holds the files.
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(operator.fleet.home.logged(&format!("stage {NEW_IMAGE}")), 1);
    assert_eq!(upgrade_state(&operator).0, UpgradeState::Staging);
    assert_eq!(operator.fleet.home.logged("replace"), 0);
    staged_everywhere(&operator);
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(upgrade_state(&operator).0, UpgradeState::Rolling);
    assert!(
        operator.repo.image_upgrades.lock().unwrap()[0]
            .upgrade
            .sources
            .is_none()
    );

    // Rolling: the computer gets its new disk and waits for macrod, held.
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(
        operator
            .fleet
            .home
            .logged(&format!("replace {id} {NEW_IMAGE}")),
        1
    );
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Verifying);
    assert!(operator.repo.held(id).await.unwrap());
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Verifying);

    operator
        .repo
        .apply(id, Event::MacrodConnected, now())
        .await
        .unwrap();
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Upgraded);
    assert_eq!(image_of(&operator, id), NEW_IMAGE);
    assert_eq!(upgrade_state(&operator), (UpgradeState::Done, true));
    assert!(!operator.repo.held(id).await.unwrap());
    let row = operator.repo.image_upgrades.lock().unwrap()[0].computers[0].clone();
    assert_eq!(row.old_image.unwrap().as_str(), BASE_IMAGE);
}

#[tokio::test]
async fn no_macrod_after_the_boot_rolls_that_computer_back_and_pauses_the_upgrade() {
    let operator = upgrade_operator(vec![]).await;
    let first = running(&operator, 1).await;
    let second = running(&operator, 2).await;
    operator
        .start_image_upgrade(&request(vec![first, second], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;
    assert_eq!(state_of(&operator, first), ComputerUpgradeState::Verifying);

    time_out(&operator);
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(
        state_of(&operator, first),
        ComputerUpgradeState::RollingBack
    );
    assert_eq!(
        operator
            .fleet
            .home
            .logged(&format!("replace {first} {BASE_IMAGE}")),
        1
    );
    assert_eq!(operator.fleet.home.logged(&format!("start {first}")), 1);
    assert_eq!(upgrade_state(&operator), (UpgradeState::Paused, false));

    operator
        .repo
        .apply(first, Event::MacrodConnected, now())
        .await
        .unwrap();
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, first), ComputerUpgradeState::RolledBack);
    assert_eq!(image_of(&operator, first), BASE_IMAGE);
    // No further batch: the second computer was never touched.
    assert_eq!(state_of(&operator, second), ComputerUpgradeState::Waiting);
    assert_eq!(operator.fleet.home.logged(&format!("replace {second}")), 0);
    let (state, finished) = upgrade_state(&operator);
    assert_eq!((state, finished), (UpgradeState::Paused, true));
    assert!(
        operator.repo.image_upgrades.lock().unwrap()[0]
            .upgrade
            .error
            .as_deref()
            .unwrap()
            .contains("macrod did not connect")
    );
}

#[tokio::test]
async fn a_failed_boot_rolls_back_at_once() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .fleet
        .home
        .broken_images
        .lock()
        .unwrap()
        .push(NEW_IMAGE.to_owned());
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;

    assert_eq!(state_of(&operator, id), ComputerUpgradeState::RollingBack);
    assert_eq!(
        operator
            .fleet
            .home
            .logged(&format!("replace {id} {BASE_IMAGE}")),
        1
    );
    assert_eq!(upgrade_state(&operator).0, UpgradeState::Paused);
}

#[tokio::test]
async fn a_computer_in_use_waits_and_is_skipped_at_the_deadline_never_forced() {
    let busy_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let operator = upgrade_operator(vec![busy_id]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Waiting);

    operator.repo.image_upgrades.lock().unwrap()[0]
        .upgrade
        .idle_deadline_at = now();
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Skipped);
    assert_eq!(operator.fleet.home.logged("replace"), 0);
    assert_eq!(upgrade_state(&operator), (UpgradeState::Done, true));
}

#[tokio::test]
async fn a_golden_still_building_leaves_the_computer_waiting() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .fleet
        .home
        .building_images
        .lock()
        .unwrap()
        .push(NEW_IMAGE.to_owned());
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Waiting);

    operator.fleet.home.building_images.lock().unwrap().clear();
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Verifying);
}

#[tokio::test]
async fn a_host_holding_other_files_fails_the_upgrade_before_any_computer() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    let mut other = files();
    other[0].bytes = 8;
    *operator.fleet.home.staged.lock().unwrap() = vec![StagedImage::Conflict(other)];
    operator.advance_image_upgrade().await.unwrap();
    operator.advance_image_upgrade().await.unwrap();

    assert_eq!(upgrade_state(&operator), (UpgradeState::Failed, true));
    assert_eq!(operator.fleet.home.logged("replace"), 0);
}

#[tokio::test]
async fn one_upgrade_at_a_time_and_versions_are_immutable() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        operator
            .start_image_upgrade(&request(vec![id], 1))
            .await
            .unwrap(),
        Err(StartUpgradeError::AnotherUnderWay)
    );
    operator.repo.image_upgrades.lock().unwrap()[0].finished = true;
    let mut reused = request(vec![id], 1);
    reused.sources[0].file.bytes = 99;
    assert_eq!(
        operator.start_image_upgrade(&reused).await.unwrap(),
        Err(StartUpgradeError::VersionReused(
            ImageVersion::try_new(NEW_IMAGE).unwrap()
        ))
    );
    let unknown = ComputerId::new_from_uuid(Uuid::from_u128(77));
    assert_eq!(
        operator
            .start_image_upgrade(&request(vec![unknown], 1))
            .await
            .unwrap(),
        Err(StartUpgradeError::UnknownComputer(unknown))
    );
}

#[tokio::test]
async fn a_refusal_before_the_computer_was_touched_fails_it_without_a_rollback() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .fleet
        .home
        .refused_images
        .lock()
        .unwrap()
        .push(NEW_IMAGE.to_owned());
    operator
        .start_image_upgrade(&request(vec![id, running(&operator, 2).await], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;

    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Failed);
    // Nothing to roll back and no reconnect to wait for.
    assert_eq!(operator.fleet.home.logged(&format!("replace {id} {BASE_IMAGE}")), 0);
    assert_eq!(operator.fleet.home.logged(&format!("start {id}")), 0);
    let (state, finished) = upgrade_state(&operator);
    assert_eq!((state, finished), (UpgradeState::Paused, true));
}

#[tokio::test]
async fn a_failed_replacement_that_left_the_computer_on_its_own_disk_starts_it_and_fails() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .fleet
        .home
        .put_back_images
        .lock()
        .unwrap()
        .push(NEW_IMAGE.to_owned());
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;

    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Failed);
    assert_eq!(operator.fleet.home.logged(&format!("start {id}")), 1);
    assert!(operator.fleet.home.state_of_disk(id).running);
    assert_eq!(upgrade_state(&operator), (UpgradeState::Paused, true));
}

#[tokio::test]
async fn a_replacement_cut_short_is_asked_again_and_verified_from_the_boot() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;
    // As if the pass died before it saved Verifying.
    {
        let mut upgrades = operator.repo.image_upgrades.lock().unwrap();
        upgrades[0].computers[0].state = ComputerUpgradeState::Replacing;
    }
    operator.advance_image_upgrade().await.unwrap();
    assert_eq!(state_of(&operator, id), ComputerUpgradeState::Verifying);
    assert_eq!(
        operator
            .fleet
            .home
            .logged(&format!("replace {id} {NEW_IMAGE}")),
        2
    );
}

#[tokio::test]
async fn past_its_deadline_an_upgrade_skips_what_waits_and_leaves_what_is_under_way() {
    let operator = upgrade_operator(vec![]).await;
    let first = running(&operator, 1).await;
    let second = running(&operator, 2).await;
    operator
        .start_image_upgrade(&request(vec![first, second], 1))
        .await
        .unwrap()
        .unwrap();
    stage_and_roll(&operator).await;
    assert_eq!(state_of(&operator, first), ComputerUpgradeState::Verifying);
    operator.repo.image_upgrades.lock().unwrap()[0]
        .upgrade
        .idle_deadline_at = now() - crate::domain::image_upgrade::UPGRADE_GRACE;

    operator.advance_image_upgrade().await.unwrap();

    assert_eq!(state_of(&operator, first), ComputerUpgradeState::RollbackFailed);
    assert_eq!(state_of(&operator, second), ComputerUpgradeState::Skipped);
    assert_eq!(upgrade_state(&operator), (UpgradeState::Paused, true));
}

#[tokio::test]
async fn staging_that_never_finishes_fails_at_the_deadline() {
    let operator = upgrade_operator(vec![]).await;
    let id = running(&operator, 1).await;
    operator
        .start_image_upgrade(&request(vec![id], 1))
        .await
        .unwrap()
        .unwrap();
    operator.advance_image_upgrade().await.unwrap();
    operator.repo.image_upgrades.lock().unwrap()[0]
        .upgrade
        .idle_deadline_at = now() - crate::domain::image_upgrade::UPGRADE_GRACE;

    operator.advance_image_upgrade().await.unwrap();

    assert_eq!(upgrade_state(&operator), (UpgradeState::Failed, true));
    assert_eq!(operator.fleet.home.logged("replace"), 0);
}
