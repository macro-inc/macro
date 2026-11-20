//! [`ComputersInUse`] for relief: a computer is in use while someone watches
//! or drives its screen, or any agent bound to its harness has a session
//! with work under way (a turn not yet ended, or prompts queued). Asked only
//! for quiet guests on a host under memory pressure, so a handful of reads
//! per pass at most.

use std::collections::HashSet;

use agent_session::domain::ports::RuntimeSessionLookup;
use agent_session::outbound::runtime_sessions::PgRuntimeSessions;
use bots::domain::ports::HarnessAssignments;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use computer_screen::domain::ports::ScreenRepo as _;
use computer_screen::domain::service::SESSION_FRESH_FOR;
use computer_screen::outbound::pg::PgScreenRepo;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::ports::{ComputerRepo, ComputersInUse, ComputersInUseFuture};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use sqlx::PgPool;

/// Screens and agent sessions on each computer, from Postgres.
pub struct SessionsInUse {
    computers: PgComputerRepo,
    bots: PgBotsRepo,
    sessions: PgRuntimeSessions,
    screens: PgScreenRepo,
}

impl SessionsInUse {
    /// Read through `pool`.
    pub fn new(computers: PgComputerRepo, pool: PgPool) -> Self {
        Self {
            computers,
            bots: PgBotsRepo::new(pool.clone()),
            screens: PgScreenRepo::new(pool.clone()),
            sessions: PgRuntimeSessions(pool),
        }
    }

    async fn in_use_now(
        &self,
        candidates: &[ComputerId],
    ) -> Result<HashSet<ComputerId>, rootcause::Report> {
        let mut in_use: HashSet<ComputerId> = self
            .screens
            .computers_in_use(candidates, SESSION_FRESH_FOR)
            .await
            .map_err(rootcause::Report::new)?
            .into_iter()
            .collect();
        for computer_id in candidates {
            if in_use.contains(computer_id) {
                continue;
            }
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
