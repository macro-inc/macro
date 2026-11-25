//! The image upgrade pass: advances the unfinished [`ImageUpgrade`] one step
//! per pass (see [`crate::domain::image_upgrade`]). One replica runs it at a
//! time: it holds a lease on the upgrade, renews it before every host call,
//! and every write is fenced on it, so a replica that lost the lease writes
//! nothing. Every step is safe to repeat: a pass that dies halfway leaves the
//! upgrade where the next pass picks it up.

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use tracing::Instrument;

use super::{ComputerOperator, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::image::GuestImage;
use crate::domain::image_upgrade::{
    ComputerUpgrade, ComputerUpgradeState, HostImageError, HostImages, ImageUpgrade, ImageUpgrades,
    NewImageUpgrade, StagedImage, StartUpgradeError, SystemDiskState, UPGRADE_LEASE, UpgradeState,
    is_finished, next_batch, settled_state,
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

/// Whether a replacement is being asked again after a pass died during it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Resumed {
    /// First asked in this pass.
    No,
    /// Asked by a pass that died.
    Yes,
}

/// Another replica holds the upgrade now; this pass stops.
fn lease_lost() -> ComputerError {
    ComputerError::Internal(rootcause::report!(
        "another replica took the image upgrade's lease"
    ))
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
    #[tracing::instrument(name = "computer.image_upgrade.start", skip_all, fields(image = %request.image, computers = request.computers.len()), err)]
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
            if now >= upgrade.deadline_at() {
                // What has already reconnected (or timed out) settles first;
                // only what is still undecided is abandoned.
                if matches!(upgrade.state, UpgradeState::Rolling | UpgradeState::Paused) {
                    self.settle_under_way(&mut upgrade, &mut computers).await?;
                }
                self.stop_at_deadline(&mut upgrade, &mut computers).await?;
            } else {
                match upgrade.state {
                    UpgradeState::Staging => self.stage(&mut upgrade, &mut computers).await?,
                    UpgradeState::Rolling | UpgradeState::Paused => {
                        self.roll(&mut upgrade, &mut computers).await?;
                    }
                    UpgradeState::Done | UpgradeState::Failed => {}
                }
            }
            upgrade.state = settled_state(&upgrade, &computers);
            if upgrade.state == UpgradeState::Paused && upgrade.error.is_none() {
                upgrade.error = Some(paused_reason(&computers));
            }
            let finished = is_finished(&upgrade, &computers);
            tracing::Span::current().record("settled", upgrade.state.as_ref());
            if (upgrade != before || finished)
                && !self
                    .repo
                    .update_upgrade(self.upgrade_holder, &upgrade, finished, self.clock.now())
                    .await
                    .map_err(internal)?
            {
                return Err(lease_lost());
            }
            if finished {
                tracing::info!(upgrade_id = %upgrade.id, state = upgrade.state.as_ref(), "image upgrade finished");
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    /// Past the deadline: a staging fails, waiting computers are skipped,
    /// and one under way is left for an operator (its host never answered
    /// where it stands).
    async fn stop_at_deadline(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        tracing::warn!(upgrade_id = %upgrade.id, "image upgrade ran out of time");
        match upgrade.state {
            UpgradeState::Staging => {
                upgrade.state = UpgradeState::Failed;
                upgrade.error = Some("the image was not staged on every host in time".to_owned());
                upgrade.sources = None;
            }
            UpgradeState::Rolling | UpgradeState::Paused => {
                for computer in computers.iter_mut() {
                    if computer.state == ComputerUpgradeState::Waiting {
                        computer.state = ComputerUpgradeState::Skipped;
                        computer.error = Some("the upgrade ran out of time".to_owned());
                        self.save_computer(computer).await?;
                    } else if computer.state.holds_computer() {
                        computer.state = ComputerUpgradeState::RollbackFailed;
                        computer.error = Some(format!(
                            "{}; the upgrade ran out of time while it was under way",
                            computer
                                .error
                                .as_deref()
                                .unwrap_or("no answer from its host")
                        ));
                        tracing::error!(computer_id = %computer.computer_id, reason = "image upgrade ran out of time with the computer under way", "computer needs an operator");
                        self.save_computer(computer).await?;
                    }
                }
                if upgrade.state == UpgradeState::Rolling
                    && computers
                        .iter()
                        .any(|computer| computer.state.pauses_upgrade())
                {
                    upgrade.state = UpgradeState::Paused;
                }
            }
            UpgradeState::Done | UpgradeState::Failed => {}
        }
        Ok(())
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
            self.renew_lease().await?;
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
                    upgrade.sources = None;
                    return Ok(());
                }
                StagedImage::Failed(reason) => {
                    upgrade.state = UpgradeState::Failed;
                    upgrade.error = Some(format!("staging on host {host} failed: {reason}"));
                    upgrade.sources = None;
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

    /// Settle the computers under way, then start the next one.
    async fn roll(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        self.settle_under_way(upgrade, computers).await?;
        self.start_next(upgrade, computers).await
    }

    /// Move every computer under way on: a replacement cut short is asked
    /// again, a reconnect finishes it, a timeout rolls it back, and a
    /// rollback not yet in place on its host is sent again.
    async fn settle_under_way(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        let now = self.clock.now();
        for computer in computers.iter_mut() {
            match computer.state {
                // A pass died during the replacement: asking again finishes
                // it (the host boots a computer it stopped), or is a no-op
                // once the new disk runs.
                ComputerUpgradeState::Replacing => {
                    let Some(old_image) = computer.old_image.clone() else {
                        computer.state = ComputerUpgradeState::RollbackFailed;
                        computer.error = Some("its previous image was not recorded".to_owned());
                        self.save_computer(computer).await?;
                        continue;
                    };
                    self.replace(upgrade, computer, &old_image, Resumed::Yes)
                        .await?;
                }
                ComputerUpgradeState::Verifying => {
                    if computer.reconnected() {
                        self.repo
                            .record_image(computer.computer_id, &computer.new_image)
                            .await
                            .map_err(internal)?;
                        computer.state = ComputerUpgradeState::Upgraded;
                        tracing::info!(computer_id = %computer.computer_id, old_image = ?computer.old_image.as_ref().map(GuestImage::as_str), new_image = %computer.new_image, "computer upgraded");
                        self.save_computer(computer).await?;
                    } else if computer.timed_out(upgrade.reconnect_timeout, now) {
                        let reason = "macrod did not connect after the boot".to_owned();
                        self.roll_back(computer, reason).await?;
                    }
                }
                ComputerUpgradeState::RollingBack => {
                    if !computer.reconnected()
                        && !computer.timed_out(upgrade.reconnect_timeout, now)
                    {
                        // A rollback cut short (a dead pass, a lost lease, a
                        // call that timed out) is sent again until its host
                        // has the computer running on its old disk.
                        self.ensure_rolled_back(computer).await?;
                        continue;
                    }
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
                | ComputerUpgradeState::RollbackFailed
                | ComputerUpgradeState::Failed => {}
            }
        }
        Ok(())
    }

    /// Start the next waiting computer, unless the upgrade paused.
    async fn start_next(
        &self,
        upgrade: &mut ImageUpgrade,
        computers: &mut [ComputerUpgrade],
    ) -> Result<(), ComputerError> {
        let now = self.clock.now();
        // A failure above pauses the upgrade before another computer starts.
        upgrade.state = settled_state(upgrade, computers);
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
                    computer.old_image = Some(current.image.clone());
                    computer.state = ComputerUpgradeState::Replacing;
                    computer.phase_started_at = Some(self.clock.now());
                    computer.error = None;
                    self.save_computer(computer).await?;
                    self.replace(upgrade, computer, &current.image, Resumed::No)
                        .await?;
                    tracing::info!(upgrade_id = %upgrade.id, computer_id = %computer.computer_id, state = computer.state.as_ref(), "image upgrade started a computer");
                    // One replacement per pass: each can take a shutdown and
                    // a boot.
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
        }
        Ok(())
    }

    /// Whether `computer` may be replaced now: running and awake on its host,
    /// macrod connected and no one using it. Answers its host's view of it.
    async fn ready_to_replace(
        &self,
        upgrade: &ImageUpgrade,
        row: &ComputerUpgrade,
        now: DateTime<Utc>,
    ) -> Result<Result<SystemDiskState, NotNow>, ComputerError> {
        let Some(computer) = self.upgradable(row.computer_id).await? else {
            return Ok(Err(NotNow::Skip(
                "the computer is gone or needs an operator".to_owned(),
            )));
        };
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
        // The host's record, not the row's last write: the image it boots is
        // the one a rollback goes back to.
        let fleet = self.fleet_for(computer.host).await?;
        let disk = fleet.system_disk(computer.id).await.map_err(internal)?;
        if disk.image == row.new_image {
            return Ok(Err(NotNow::Skip("it runs the image already".to_owned())));
        }
        if !disk.running {
            return Ok(Err(NotNow::Skip("its host has it stopped".to_owned())));
        }
        Ok(Ok(disk))
    }

    /// Give the computer its new system disk, then settle it from where its
    /// host says it is: on the new image and running (wait for macrod), on
    /// the new image but down (roll back), or still on `old_image` (it was
    /// never moved: failed).
    async fn replace(
        &self,
        upgrade: &ImageUpgrade,
        computer: &mut ComputerUpgrade,
        old_image: &GuestImage,
        resumed: Resumed,
    ) -> Result<(), ComputerError> {
        let Some(current) = self.upgradable(computer.computer_id).await? else {
            computer.state = ComputerUpgradeState::RollbackFailed;
            computer.error = Some("the computer is gone or needs an operator".to_owned());
            return self.save_computer(computer).await;
        };
        let fleet = self.fleet_for(current.host).await?;
        self.renew_lease().await?;
        let span = tracing::info_span!(
            "computer.image_upgrade.replace",
            computer_id = %computer.computer_id,
            upgrade_id = %upgrade.id,
            old_image = %old_image.as_str(),
            new_image = %computer.new_image,
        );
        let replaced = fleet
            .replace_system_disk(computer.computer_id, &computer.new_image)
            .instrument(span)
            .await;
        let disk = match replaced {
            Ok(disk) => disk,
            Err(error) if error.is_golden_not_ready() => {
                // The host builds the golden; this computer starts again
                // once it is ready.
                computer.state = ComputerUpgradeState::Waiting;
                computer.phase_started_at = None;
                return self.save_computer(computer).await;
            }
            Err(error) if error.is_refused() => {
                computer.state = ComputerUpgradeState::Failed;
                computer.error = Some(format!("its host refused the new image: {error}"));
                tracing::warn!(computer_id = %computer.computer_id, error = ?error, "system disk replacement refused");
                return self.save_computer(computer).await;
            }
            Err(error) => {
                tracing::warn!(computer_id = %computer.computer_id, error = ?error, "system disk replacement failed");
                computer.error = Some(format!("the replacement failed: {error}"));
                // Where did it leave the computer? Waits for the host to end
                // the operation; no answer leaves it under way for the next
                // pass (or the deadline).
                self.renew_lease().await?;
                match fleet.system_disk(computer.computer_id).await {
                    Ok(disk) => disk,
                    Err(lookup) => {
                        tracing::warn!(computer_id = %computer.computer_id, error = ?lookup, "could not read the computer's system disk after a failed replacement");
                        return self.save_computer(computer).await;
                    }
                }
            }
        };
        if disk.image == computer.new_image && disk.running {
            computer.state = ComputerUpgradeState::Verifying;
            match resumed {
                // Only a connection after the boot counts.
                Resumed::No => computer.phase_started_at = Some(self.clock.now()),
                // The boot may have come (and macrod with it) before the
                // pass that asked died: count from when it asked.
                Resumed::Yes => {}
            }
            return self.save_computer(computer).await;
        }
        if disk.image == computer.new_image {
            let reason = computer
                .error
                .clone()
                .unwrap_or_else(|| "the computer did not boot on the new image".to_owned());
            return self.roll_back(computer, reason).await;
        }
        // Still on its own disk: never moved, or put back by its host.
        if !disk.running {
            self.renew_lease().await?;
            if let Err(error) = fleet.start(computer.computer_id).await {
                tracing::error!(computer_id = %computer.computer_id, error = ?error, reason = "could not start a computer left on its own image", "computer needs an operator");
            }
        }
        computer.state = ComputerUpgradeState::Failed;
        if computer.error.is_none() {
            computer.error = Some(format!("its host still boots {}", disk.image.as_str()));
        }
        self.save_computer(computer).await
    }

    /// Put the computer back on its previous system disk and boot it; then
    /// wait for macrod from the moment its host answered.
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
        self.ensure_rolled_back(computer).await
    }

    /// Unless its host has the computer running on its old disk, send the
    /// rollback (back to the old disk, then start). Once sent, macrod counts
    /// from the host's answer; a failed send is tried again next pass until
    /// the reconnect timeout.
    async fn ensure_rolled_back(
        &self,
        computer: &mut ComputerUpgrade,
    ) -> Result<(), ComputerError> {
        let Some(old_image) = computer.old_image.clone() else {
            computer.state = ComputerUpgradeState::RollbackFailed;
            computer.error = Some(format!(
                "{}; its previous image is not recorded",
                computer.error.as_deref().unwrap_or_default()
            ));
            tracing::error!(computer_id = %computer.computer_id, reason = "image upgrade rollback has no previous image", "computer needs an operator");
            return self.save_computer(computer).await;
        };
        let Some(current) = self.upgradable(computer.computer_id).await? else {
            computer.state = ComputerUpgradeState::RollbackFailed;
            computer.error = Some("the computer is gone or needs an operator".to_owned());
            return self.save_computer(computer).await;
        };
        let fleet = self.fleet_for(current.host).await?;
        self.renew_lease().await?;
        match fleet.system_disk(computer.computer_id).await {
            Ok(disk) if disk.image == old_image && disk.running => return Ok(()),
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(computer_id = %computer.computer_id, error = ?error, "could not read the computer's system disk during a rollback");
                return Ok(());
            }
        }
        let sent = async {
            fleet
                .replace_system_disk(computer.computer_id, &old_image)
                .await
                .map_err(|error| error.to_string())?;
            // A failed boot left it stopped: the replacement only swaps.
            self.renew_lease().await.map_err(|error| error.to_string())?;
            fleet
                .start(computer.computer_id)
                .await
                .map_err(|error| error.to_string())
        }
        .instrument(tracing::info_span!("computer.image_upgrade.roll_back", computer_id = %computer.computer_id))
        .await;
        match sent {
            Ok(()) => {
                // Only a connection after the boot on the old disk counts.
                computer.phase_started_at = Some(self.clock.now());
                self.save_computer(computer).await
            }
            Err(error) => {
                tracing::warn!(computer_id = %computer.computer_id, error, "sending a rollback failed; trying again next pass");
                Ok(())
            }
        }
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

    /// Keep the lease for another [`UPGRADE_LEASE`] before a host call;
    /// fails when another replica holds it.
    async fn renew_lease(&self) -> Result<(), ComputerError> {
        let now = self.clock.now();
        self.repo
            .lease_upgrade(self.upgrade_holder, now, now + UPGRADE_LEASE)
            .await
            .map_err(internal)?
            .map(|_| ())
            .ok_or_else(lease_lost)
    }

    async fn save_computer(&self, computer: &ComputerUpgrade) -> Result<(), ComputerError> {
        if self
            .repo
            .update_computer_upgrade(self.upgrade_holder, computer, self.clock.now())
            .await
            .map_err(internal)?
        {
            Ok(())
        } else {
            Err(lease_lost())
        }
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

/// Why an upgrade paused: the computers that failed or rolled back.
fn paused_reason(computers: &[ComputerUpgrade]) -> String {
    let failed: Vec<String> = computers
        .iter()
        .filter(|computer| computer.state.pauses_upgrade())
        .map(|computer| {
            format!(
                "{} {} ({})",
                computer.computer_id,
                computer.state,
                computer.error.as_deref().unwrap_or("no reason recorded")
            )
        })
        .collect();
    format!("paused: {}", failed.join(", "))
}
