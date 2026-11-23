//! Releasing every computer of a team that is being deleted.

use uuid::Uuid;

use super::{Clock, ComputerError, internal};
use crate::domain::lifecycle::{Event, Rejected};
use crate::domain::models::ComputerRecord;
use crate::domain::ports::{Applied, ComputerRepo};

/// Releases a team's computers and drops its purchases before the team is
/// deleted. Needs only the repository, so team deletion can be wired before
/// the billing-backed [`super::ComputerService`].
pub struct TeamComputerRelease<Repo, Time> {
    repo: Repo,
    clock: Time,
}

impl<Repo: ComputerRepo, Time: Clock> TeamComputerRelease<Repo, Time> {
    /// Compose the repository and clock.
    pub fn new(repo: Repo, clock: Time) -> Self {
        Self { repo, clock }
    }

    /// Delete the team's reservations, then release every live computer
    /// through the normal effects (billing item removal, destroy with the
    /// data volume, harness revocation). A charge still in flight for a
    /// deleted reservation never becomes a computer; cancelling the
    /// subscription, which team deletion does next, settles its receipt. Safe to repeat: released
    /// computers are skipped. A quarantined computer stops the deletion,
    /// since it cannot be released safely.
    #[tracing::instrument(skip(self), err)]
    pub async fn release_team(&self, team_id: Uuid) -> Result<(), ComputerError> {
        release_team(&self.repo, &self.clock, team_id).await
    }
}

pub(crate) async fn release_team<Repo: ComputerRepo, Time: Clock>(
    repo: &Repo,
    clock: &Time,
    team_id: Uuid,
) -> Result<(), ComputerError> {
    // Reservations first: one that converts meanwhile is a computer by the
    // time computers are listed, and one deleted here can no longer convert.
    for reservation in repo.team_reservations(team_id).await.map_err(internal)? {
        repo.delete_reservation(reservation.id)
            .await
            .map_err(internal)?;
    }
    for record in repo.list_for_team(team_id).await.map_err(internal)? {
        let computer = match record {
            ComputerRecord::Healthy(computer) => computer,
            ComputerRecord::NeedsAttention { .. } => return Err(ComputerError::NeedsAttention),
        };
        match repo
            .apply(computer.id, Event::ReleaseNow, clock.now())
            .await
            .map_err(internal)?
        {
            None | Some(Applied::Changed(_)) | Some(Applied::Rejected(Rejected::Released)) => {}
            Some(Applied::Rejected(rejected)) => return Err(rejected.into()),
        }
    }
    Ok(())
}
