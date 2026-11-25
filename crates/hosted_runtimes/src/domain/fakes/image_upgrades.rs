//! [`ImageUpgrades`] for [`FakeRepo`]: upgrades in memory; a macrod
//! connection applied to a computer under way is noted, as the Postgres
//! applier does.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{FakeError, FakeRepo};
use crate::domain::ids::ComputerId;
use crate::domain::image_upgrade::{
    ComputerUpgrade, ComputerUpgradeState, ImageFiles, ImageUpgrade, ImageUpgrades,
    NewImageUpgrade, StartUpgradeError, UpgradeId, UpgradeState,
};

/// One stored upgrade: the upgrade, its computers, and whether it finished.
#[derive(Debug, Clone)]
pub struct StoredUpgrade {
    /// The upgrade.
    pub upgrade: ImageUpgrade,
    /// Its computers.
    pub computers: Vec<ComputerUpgrade>,
    /// Whether the pass finished it.
    pub finished: bool,
}

impl FakeRepo {
    /// Note a macrod connection on the computer's upgrade row under way.
    pub(super) fn note_upgrade_reconnect(&self, computer_id: ComputerId, now: DateTime<Utc>) {
        for stored in self.image_upgrades.lock().unwrap().iter_mut() {
            for computer in &mut stored.computers {
                if computer.computer_id == computer_id && computer.state.holds_computer() {
                    computer.reconnected_at = Some(now);
                }
            }
        }
    }

    /// Whether an upgrade has the computer under way.
    pub(super) fn upgrade_holds(&self, computer_id: ComputerId) -> bool {
        self.image_upgrades.lock().unwrap().iter().any(|stored| {
            stored.computers.iter().any(|computer| {
                computer.computer_id == computer_id && computer.state.holds_computer()
            })
        })
    }
}

impl ImageUpgrades for FakeRepo {
    type Err = FakeError;

    async fn create_upgrade(
        &self,
        upgrade: &NewImageUpgrade,
        files: &ImageFiles,
        now: DateTime<Utc>,
    ) -> Result<Result<ImageUpgrade, StartUpgradeError>, FakeError> {
        let mut upgrades = self.image_upgrades.lock().unwrap();
        if upgrades.iter().any(|stored| !stored.finished) {
            return Ok(Err(StartUpgradeError::AnotherUnderWay));
        }
        if upgrades
            .iter()
            .any(|stored| stored.upgrade.image == upgrade.image && stored.upgrade.files != *files)
        {
            return Ok(Err(StartUpgradeError::VersionReused(upgrade.image.clone())));
        }
        let computers = self.computers.lock().unwrap();
        if let Some(unknown) = upgrade
            .computers
            .iter()
            .find(|computer_id| !computers.contains_key(computer_id))
        {
            return Ok(Err(StartUpgradeError::UnknownComputer(*unknown)));
        }
        let created = ImageUpgrade {
            id: UpgradeId::generate(),
            image: upgrade.image.clone(),
            files: files.clone(),
            sources: Some(upgrade.sources.clone()),
            batch_size: upgrade.batch_size,
            idle_deadline_at: now + upgrade.idle_wait,
            reconnect_timeout: upgrade.reconnect_timeout,
            state: UpgradeState::Staging,
            error: None,
            created_by: upgrade.created_by.clone(),
            created_at: now,
        };
        let rows = upgrade
            .computers
            .iter()
            .enumerate()
            .map(|(position, computer_id)| ComputerUpgrade {
                upgrade_id: created.id,
                computer_id: *computer_id,
                position: u16::try_from(position).unwrap(),
                state: ComputerUpgradeState::Waiting,
                old_image: None,
                new_image: upgrade.image.image().clone(),
                phase_started_at: None,
                reconnected_at: None,
                error: None,
            })
            .collect();
        upgrades.push(StoredUpgrade {
            upgrade: created.clone(),
            computers: rows,
            finished: false,
        });
        Ok(Ok(created))
    }

    async fn lease_upgrade(
        &self,
        _holder: Uuid,
        _now: DateTime<Utc>,
        _until: DateTime<Utc>,
    ) -> Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, FakeError> {
        Ok(self
            .image_upgrades
            .lock()
            .unwrap()
            .iter()
            .find(|stored| !stored.finished)
            .map(|stored| (stored.upgrade.clone(), stored.computers.clone())))
    }

    async fn upgrade(
        &self,
        id: UpgradeId,
    ) -> Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, FakeError> {
        Ok(self
            .image_upgrades
            .lock()
            .unwrap()
            .iter()
            .find(|stored| stored.upgrade.id == id)
            .map(|stored| (stored.upgrade.clone(), stored.computers.clone())))
    }

    async fn update_upgrade(
        &self,
        _holder: Uuid,
        upgrade: &ImageUpgrade,
        finished: bool,
        _now: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        for stored in self.image_upgrades.lock().unwrap().iter_mut() {
            if stored.upgrade.id == upgrade.id {
                stored.upgrade = upgrade.clone();
                stored.finished = finished;
            }
        }
        Ok(true)
    }

    async fn update_computer_upgrade(
        &self,
        _holder: Uuid,
        computer: &ComputerUpgrade,
        _now: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        for stored in self.image_upgrades.lock().unwrap().iter_mut() {
            for row in &mut stored.computers {
                if row.upgrade_id == computer.upgrade_id && row.computer_id == computer.computer_id
                {
                    // The store keeps its own reconnection time.
                    let reconnected_at = row.reconnected_at;
                    *row = computer.clone();
                    row.reconnected_at = reconnected_at;
                }
            }
        }
        Ok(true)
    }
}
