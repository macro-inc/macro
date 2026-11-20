//! The team's view of its computers' CPU and memory over the last day.

use std::collections::HashMap;

use uuid::Uuid;

use super::{Clock, ComputerError, ComputerService, internal};
use crate::domain::ids::ComputerId;
use crate::domain::ports::{ComputerRepo, UsageHistory};
use crate::domain::usage::{self, ComputerUsage, StoredSample};

impl<Repo, Bill, Time, Attachment, Policy> ComputerService<Repo, Bill, Time, Attachment, Policy>
where
    Repo: ComputerRepo + UsageHistory,
    Time: Clock,
{
    /// Each of the team's computers' usage over the last day, in the order
    /// [`Self::list`] gives them. A computer that never ran has no points.
    #[tracing::instrument(name = "computer.usage.list", skip_all, fields(team_id = %team_id, computers = tracing::field::Empty), err)]
    pub async fn usage(&self, team_id: Uuid) -> Result<Vec<ComputerUsage>, ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        let sized: Vec<(ComputerId, u32)> = computers
            .iter()
            .filter_map(|record| record.healthy())
            .map(|computer| (computer.id, computer.resources.vcpus.get()))
            .collect();
        tracing::Span::current().record("computers", sized.len());
        let ids: Vec<ComputerId> = sized.iter().map(|(id, _)| *id).collect();
        let now = self.clock.now();
        let readings = UsageHistory::usage_since(&self.repo, &ids, now - usage::WINDOW)
            .await
            .map_err(internal)?;

        let mut by_computer: HashMap<ComputerId, Vec<StoredSample>> = HashMap::new();
        for (computer_id, sample) in readings {
            by_computer.entry(computer_id).or_default().push(sample);
        }

        Ok(sized
            .into_iter()
            .map(|(computer_id, vcpus)| {
                let samples = by_computer.remove(&computer_id).unwrap_or_default();
                usage::history(computer_id, vcpus, &samples, now)
            })
            .collect())
    }
}
