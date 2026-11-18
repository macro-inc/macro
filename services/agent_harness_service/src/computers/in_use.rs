//! [`ComputersInUse`] for relief: a computer is in use while any agent bound
//! to its harness has a session with work under way (a turn not yet ended,
//! or prompts queued). Asked only for quiet guests on a host under memory
//! pressure, so a handful of reads per pass at most.

use std::collections::HashSet;

use agent_session::domain::ports::RuntimeSessionLookup;
use agent_session::outbound::runtime_sessions::PgRuntimeSessions;
use bots::domain::ports::HarnessAssignments;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::{ComputerRepo, ComputersInUse, ComputersInUseFuture};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use sqlx::PgPool;

/// Agent sessions on each computer's harness, from Postgres.
pub struct SessionsInUse {
    computers: PgComputerRepo,
    bots: PgBotsRepo,
    sessions: PgRuntimeSessions,
}

impl SessionsInUse {
    /// Read through `pool`.
    pub fn new(computers: PgComputerRepo, pool: PgPool) -> Self {
        Self {
            computers,
            bots: PgBotsRepo::new(pool.clone()),
            sessions: PgRuntimeSessions(pool),
        }
    }

    async fn in_use_now(
        &self,
        candidates: &[ComputerId],
    ) -> Result<HashSet<ComputerId>, rootcause::Report> {
        let mut in_use = HashSet::new();
        for computer_id in candidates {
            let harness = self
                .computers
                .get(*computer_id)
                .await
                .map_err(rootcause::Report::new)?
                .and_then(|record| record.into_healthy().ok())
                .and_then(|computer| computer.harness_id);
            let Some(harness) = harness else {
                continue;
            };
            let bots = self
                .bots
                .bots_on_harness(harness)
                .await
                .map_err(rootcause::Report::new)?;
            if !self
                .sessions
                .bots_with_live_work(&bots)
                .await
                .map_err(rootcause::Report::new)?
                .is_empty()
            {
                in_use.insert(*computer_id);
            }
        }
        Ok(in_use)
    }
}

impl ComputersInUse for SessionsInUse {
    fn in_use<'a>(&'a self, candidates: &'a [ComputerId]) -> ComputersInUseFuture<'a> {
        Box::pin(self.in_use_now(candidates))
    }
}
