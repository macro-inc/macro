//! The image upgrade pass: advances the unfinished [`ImageUpgrade`] one step
//! per pass (see [`crate::domain::image_upgrade`]). One replica runs it at a
//! time (a lease on the upgrade row). Every step is safe to repeat: a pass
//! that dies halfway leaves the upgrade where the next pass picks it up.

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use tracing::Instrument;

use super::{ComputerOperator, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::image_upgrade::{
    ComputerUpgrade, ComputerUpgradeState, HostImageError, HostImages, ImageUpgrade, ImageUpgrades,
    NewImageUpgrade, StagedImage, StartUpgradeError, UPGRADE_LEASE, UpgradeState, is_finished,
    next_batch, settled_state,
};
use crate::domain::lifecycle::Phase;
use crate::domain::models::Computer;
use crate::domain::ports::{ComputerRepo, Fleet, Fleets, Harnesses, SetupNotices};
use crate::domain::service::{Clock, ComputerError};

/// Why a waiting computer does not start now.
enum NotNow {
    /// Someone uses it, or macrod is away: ask again next pass.
    Busy,
    /// It will never start in this upgrade.
    Skip(String),
}

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo
        + ComputerAgents
        + crate::domain::ports::OvercommitRepo
        + crate::domain::moves::ComputerMoves
        + ImageUpgrades,
    Machines: Fleets,
    Machines::Fleet: HostImages,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// Record an operator's image upgrade; the upgrade pass carries it out.
    #[tracing::instrument(name = "computer.image_upgrade.start", skip_all, fields(image = %request.image, computers = request.computers.len(), upgrade_id = tracing::field::Empty), err)]
    pub async fn start_image_upgrade(
        &self,
        request: &NewImageUpgrade,
    ) -> Result<Result<ImageUpgrade, StartUpgradeError>, ComputerError> {
        start_image_upgrade(&self.repo, request, self.clock.now())
            .await
            .map_err(internal)
    }

    /// Advance the unfinished image upgrade, if any, one step.
    pub async fn advance_image_upgrade(&self) -> Result<(), ComputerError> {
        let now = self.clock.now();
        let Some((mut upgrade, mut computers)) = self
            .repo
            .lease_upgrade(self.upgrade_holder, now, now + UPGRADE_LEASE)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let span = tracing::info_span!(
            "computer.image_upgrade.pass",
            upgrade_id = %upgrade.id,
            image = %upgrade.image,
            state = upgrade.state.as_ref(),
            settled = tracing::field::Empty,
        );
        async {
            let before = upgrade.clone();
            match upgrade.state {
                UpgradeState::Staging => self.stage(&mut upgrade, &mut computers).await?,
                UpgradeState::Rolling | UpgradeState::Paused => {
                    self.roll(&mut upgrade, &mut computers).await?;
                }
                UpgradeState::Done | UpgradeState::Failed => {}
            }
            upgrade.state = settled_state(&upgrade, &computers);
            if upgrade.state == UpgradeState::Paused && upgrade.error.is_none() {
                upgrade.error = Some(rolled_back_reason(&computers));
            }
            let finished = is_finished(&upgrade, &computers);
            tracing::Span::current().record("settled", upgrade.state.as_ref());
            if upgrade != before || finished {
                self.repo
                    .update_upgrade(&upgrade, finished, self.clock.now())
                    .await
                    .map_err(internal)?;
            }
            if finished {
                tracing::info!(upgrade_id = %upgrade.id, state = upgrade.state.as_ref(), "image upgrade finished");
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    /// Put the image on every host of the upgrade's computers; once each
    /// holds exactly its files, start rolling.
    async fn stage(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        let mut hosts = BTreeSet::new();
        for computer in computers.iter_mut() {
            match self.upgradable(computer.computer_id).await? {
                Some(found) => {
                    hosts.insert(found.host.into_inner());
                }
                None if computer.state == ComputerUpgradeState::Waiting => {
                    computer.state = ComputerUpgradeState::Skipped;
                    computer.error = Some("the computer is gone or needs an operator".to_owned());
                    self.save_computer(computer).await?;
                }
                None => {}
            }
        }
        let Some(sources) = upgrade.sources.clone() else {
            upgrade.state = UpgradeState::Failed;
            upgrade.error = Some("the upgrade has no image sources left to stage".to_owned());
            return Ok(());
        };
        let mut all_ready = true;
        for host in hosts {
            let host = HostId::new(host);
            let fleet = self.fleet_for(host).await?;
            let first_ask = self
                .staging_requested
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert((upgrade.id, host));
            let staged = if first_ask {
                // Restarts a staging that failed before this upgrade, and
                // has the host check an image put there by hand.
                fleet.stage_image(&upgrade.image, &sources).await
            } else {
                fleet.staged_image(&upgrade.image).await
            }
            .map_err(internal)?;
            match staged {
                StagedImage::Ready(Some(files)) if upgrade.files.held_by(&files) => {}
                StagedImage::Ready(Some(_)) | StagedImage::Conflict(_) => {
                    upgrade.state = UpgradeState::Failed;
                    upgrade.error = Some(format!(
                        "host {host} holds {} with other files; image versions are immutable",
                        upgrade.image
                    ));
                    return Ok(());
                }
                StagedImage::Failed(reason) => {
                    upgrade.state = UpgradeState::Failed;
                    upgrade.error = Some(format!("staging on host {host} failed: {reason}"));
                    return Ok(());
                }
                StagedImage::Staging => all_ready = false,
                StagedImage::Absent | StagedImage::Ready(None) => {
                    all_ready = false;
                    fleet
                        .stage_image(&upgrade.image, &sources)
                        .await
                        .map_err(internal)?;
                }
            }
        }
        if all_ready {
            tracing::info!(upgrade_id = %upgrade.id, image = %upgrade.image, "image staged on every host");
            upgrade.state = UpgradeState::Rolling;
            // Presigned: no use once staged, and a credential until expiry.
            upgrade.sources = None;
        }
        Ok(())
    }

    /// Settle the computers under way, then start the next ones.
    async fn roll(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        let now = self.clock.now();
        for computer in computers.iter_mut() {
            match computer.state {
                // A pass died during the replacement: asking again is a
                // no-op once the new disk is in place.
                ComputerUpgradeState::Replacing => self.replace(upgrade, computer).await?,
                ComputerUpgradeState::Verifying => {
                    if computer.reconnected() {
                        self.repo
                            .record_image(computer.computer_id, &computer.new_image)
                            .await
                            .map_err(internal)?;
                        computer.state = ComputerUpgradeState::Upgraded;
                        tracing::info!(computer_id = %computer.computer_id, old_image = ?computer.old_image.as_ref().map(|image| image.as_str()), new_image = %computer.new_image, "computer upgraded");
                        self.save_computer(computer).await?;
                    } else if computer.timed_out(upgrade.reconnect_timeout, now) {
                        let reason = "macrod did not connect after the boot".to_owned();
                        self.roll_back(computer, reason).await?;
                    }
                }
                ComputerUpgradeState::RollingBack => {
                    if computer.reconnected() {
                        if let Some(old_image) = &computer.old_image {
                            self.repo
                                .record_image(computer.computer_id, old_image)
                                .await
                                .map_err(internal)?;
                        }
                        computer.state = ComputerUpgradeState::RolledBack;
                        self.save_computer(computer).await?;
                    } else if computer.timed_out(upgrade.reconnect_timeout, now) {
                        computer.state = ComputerUpgradeState::RollbackFailed;
                        computer.error = Some(format!(
                            "{}; macrod did not connect after the rollback either",
                            computer.error.as_deref().unwrap_or("upgrade failed")
                        ));
                        tracing::error!(computer_id = %computer.computer_id, reason = "image upgrade rollback did not bring macrod back", "computer needs an operator");
                        self.save_computer(computer).await?;
                    }
                }
                ComputerUpgradeState::Waiting
                | ComputerUpgradeState::Upgraded
                | ComputerUpgradeState::Skipped
                | ComputerUpgradeState::RolledBack
                | ComputerUpgradeState::RollbackFailed => {}
            }
        }
        // A rollback above pauses the upgrade before another computer starts.
        upgrade.state = settled_state(upgrade, computers);
        let mut started = 0;
        let batch = next_batch(upgrade, computers);
        for computer_id in batch.to_start {
            let Some(computer) = computers
                .iter_mut()
                .find(|computer| computer.computer_id == computer_id)
            else {
                continue;
            };
            match self.ready_to_replace(upgrade, computer, now).await? {
                Ok(current) => {
                    computer.old_image = current.image.clone();
                    computer.state = ComputerUpgradeState::Replacing;
                    computer.phase_started_at = Some(self.clock.now());
                    computer.error = None;
                    self.save_computer(computer).await?;
                    self.replace(upgrade, computer).await?;
                    started += 1;
                    // One replacement per pass: each can take a shutdown and
                    // a boot, and the pass must end well inside its lease.
                    break;
                }
                Err(NotNow::Busy) => {}
                Err(NotNow::Skip(reason)) => {
                    tracing::info!(computer_id = %computer.computer_id, reason, "computer skipped by the image upgrade");
                    computer.state = ComputerUpgradeState::Skipped;
                    computer.error = Some(reason);
                    self.save_computer(computer).await?;
                }
            }
            // One rollback stops the batch.
            if computer.state.pauses_upgrade() {
                break;
            }
        }
        if started > 0 {
            tracing::info!(upgrade_id = %upgrade.id, started, "image upgrade started computers");
        }
        Ok(())
    }

    /// Whether `computer` may be replaced now: running, awake, macrod
    /// connected and no one using it.
    async fn ready_to_replace(
        &self,
        upgrade: &ImageUpgrade,
        row: &ComputerUpgrade,
        now: DateTime<Utc>,
    ) -> Result<Result<Computer, NotNow>, ComputerError> {
        let Some(computer) = self.upgradable(row.computer_id).await? else {
            return Ok(Err(NotNow::Skip(
                "the computer is gone or needs an operator".to_owned(),
            )));
        };
        if computer.image.as_ref() == Some(&row.new_image) {
            return Ok(Err(NotNow::Skip("it runs the image already".to_owned())));
        }
        if !matches!(computer.state.phase, Phase::Running) {
            return Ok(Err(NotNow::Skip(format!(
                "it is {:?}, not running",
                computer.state.phase
            ))));
        }
        if computer.hibernated_at.is_some() {
            return Ok(Err(NotNow::Skip("it is hibernated".to_owned())));
        }
        let busy = !computer.state.macrod_connected
            || self
                .relief
                .in_use
                .in_use(&[computer.id])
                .await
                .map_err(ComputerError::Internal)?
                .contains(&computer.id);
        if busy {
            return Ok(Err(if now >= upgrade.idle_deadline_at {
                NotNow::Skip("in use until the idle deadline".to_owned())
            } else {
                NotNow::Busy
            }));
        }
        Ok(Ok(computer))
    }

    /// Give the computer its new system disk; a failed boot rolls it back.
    async fn replace(
        &self,
        upgrade: &ImageUpgrade,
        computer: &mut ComputerUpgrade,
    ) -> Result<(), ComputerError> {
        let Some(current) = self.upgradable(computer.computer_id).await? else {
            return self
                .roll_back(computer, "the computer needs an operator".to_owned())
                .await;
        };
        let fleet = self.fleet_for(current.host).await?;
        let span = tracing::info_span!(
            "computer.image_upgrade.replace",
            computer_id = %computer.computer_id,
            upgrade_id = %upgrade.id,
            old_image = computer.old_image.as_ref().map(|image| image.as_str().to_owned()),
            new_image = %computer.new_image,
        );
        let replaced = fleet
            .replace_system_disk(computer.computer_id, &computer.new_image)
            .instrument(span)
            .await;
        match replaced {
            Ok(image) if image == computer.new_image => {
                computer.state = ComputerUpgradeState::Verifying;
                self.save_computer(computer).await
            }
            Ok(image) => {
                let reason = format!("the host boots {} instead", image.as_str());
                self.roll_back(computer, reason).await
            }
            Err(error) if error.is_golden_not_ready() => {
                // The host builds the golden; this computer starts again
                // once it is ready.
                computer.state = ComputerUpgradeState::Waiting;
                computer.phase_started_at = None;
                self.save_computer(computer).await
            }
            Err(error) => {
                tracing::warn!(computer_id = %computer.computer_id, error = ?error, "system disk replacement failed");
                self.roll_back(
                    computer,
                    format!("the boot on the new image failed: {error}"),
                )
                .await
            }
        }
    }

    /// Put the computer back on its previous system disk and boot it.
    async fn roll_back(
        &self,
        computer: &mut ComputerUpgrade,
        reason: String,
    ) -> Result<(), ComputerError> {
        tracing::warn!(computer_id = %computer.computer_id, reason, "rolling a computer back to its previous image");
        computer.state = ComputerUpgradeState::RollingBack;
        computer.phase_started_at = Some(self.clock.now());
        computer.error = Some(reason);
        self.save_computer(computer).await?;
        let rolled_back = async {
            let Some(old_image) = computer.old_image.clone() else {
                return Err("its previous image is not recorded".to_owned());
            };
            let Some(current) = self
                .upgradable(computer.computer_id)
                .await
                .map_err(|error| error.to_string())?
            else {
                return Err("the computer is gone or needs an operator".to_owned());
            };
            let fleet = self
                .fleet_for(current.host)
                .await
                .map_err(|error| error.to_string())?;
            fleet
                .replace_system_disk(computer.computer_id, &old_image)
                .await
                .map_err(|error| error.to_string())?;
            // A failed boot left it stopped: the replacement only swaps.
            fleet
                .start(computer.computer_id)
                .await
                .map_err(|error| error.to_string())
        }
        .instrument(tracing::info_span!("computer.image_upgrade.roll_back", computer_id = %computer.computer_id))
        .await;
        if let Err(error) = rolled_back {
            computer.state = ComputerUpgradeState::RollbackFailed;
            computer.error = Some(format!(
                "{}; the rollback failed: {error}",
                computer.error.as_deref().unwrap_or_default()
            ));
            tracing::error!(computer_id = %computer.computer_id, reason = "image upgrade rollback failed", "computer needs an operator");
            self.save_computer(computer).await?;
        }
        Ok(())
    }

    /// The computer, if it exists and is healthy.
    async fn upgradable(&self, computer_id: ComputerId) -> Result<Option<Computer>, ComputerError> {
        Ok(self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .and_then(|record| record.healthy().cloned()))
    }

    async fn save_computer(&self, computer: &ComputerUpgrade) -> Result<(), ComputerError> {
        self.repo
            .update_computer_upgrade(computer, self.clock.now())
            .await
            .map_err(internal)
    }
}

/// Validate `request` and record it.
pub async fn start_image_upgrade<Repo: ImageUpgrades>(
    repo: &Repo,
    request: &NewImageUpgrade,
    now: DateTime<Utc>,
) -> Result<Result<ImageUpgrade, StartUpgradeError>, Repo::Err> {
    let files = match request.validate() {
        Ok(files) => files,
        Err(error) => return Ok(Err(error)),
    };
    repo.create_upgrade(request, &files, now).await
}

/// Why an upgrade paused: the computers that rolled back.
fn rolled_back_reason(computers: &[ComputerUpgrade]) -> String {
    let rolled_back: Vec<String> = computers
        .iter()
        .filter(|computer| computer.state.pauses_upgrade())
        .map(|computer| {
            format!(
                "{} ({})",
                computer.computer_id,
                computer.error.as_deref().unwrap_or("rolled back")
            )
        })
        .collect();
    format!("paused after a rollback: {}", rolled_back.join(", "))
}
