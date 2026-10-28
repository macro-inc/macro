//! Forwards a bound conversation to the teams join-announcement service.

#[cfg(test)]
mod test;

use slack_integration::domain::{
    models::ImportError,
    ports::{JoinAnnouncement, JoinAnnouncer, PortResult},
};
use teams::domain::join_announcement::{AnnounceJoin, JoinAnnouncementService};
use uuid::Uuid;

/// Forwards a bound conversation when the deployment kill switch is on.
#[derive(Clone)]
pub struct WorkerJoinAnnouncer<S> {
    service: S,
    enabled: bool,
}

impl<S> WorkerJoinAnnouncer<S> {
    /// `enabled` is the kill switch. Off drops the announcement before the service runs.
    pub fn new(service: S, enabled: bool) -> Self {
        Self { service, enabled }
    }
}

impl<S: JoinAnnouncementService> JoinAnnouncer for WorkerJoinAnnouncer<S> {
    async fn announce(&self, announcement: JoinAnnouncement) -> PortResult<()> {
        if !self.enabled {
            return Ok(());
        }
        let team_id = Uuid::from(announcement.team_id);
        let report = self
            .service
            .announce_join(AnnounceJoin {
                team_id,
                joined: announcement.joined,
                joined_name: announcement.joined_name,
                candidates: announcement.members,
            })
            .await
            .map_err(|error| error.context(ImportError::Internal))?;
        if report.claimed > 0 {
            tracing::info!(
                operation = "join_announcement",
                %team_id,
                ?report,
                "colleague join emails enqueued"
            );
        }
        Ok(())
    }
}
