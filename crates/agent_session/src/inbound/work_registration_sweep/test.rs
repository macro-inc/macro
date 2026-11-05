use std::sync::Mutex;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::error::Result;
use crate::domain::model::AgentSessionId;
use crate::domain::work_registration::{
    WorkRegistration, WorkRegistrationChanges, WorkRegistrationSweepReport,
};

/// Hands out one scripted count per sweep, then empty sweeps.
struct ScriptedSweeps {
    ended: Mutex<Vec<u32>>,
    sweeps: Mutex<Vec<tokio::time::Instant>>,
}

impl WorkRegistrations for ScriptedSweeps {
    async fn register(
        &self,
        _access: &EntityAccessReceipt<EditAccessLevel>,
        _account: &MacroUserIdStr<'static>,
    ) -> Result<WorkRegistration> {
        Err(crate::domain::error::AgentSessionError::Forbidden)
    }

    async fn unregister(
        &self,
        _account: &MacroUserIdStr<'static>,
        _session: AgentSessionId,
    ) -> Result<()> {
        Ok(())
    }

    async fn visible_registrations(
        &self,
        _viewer: &MacroUserIdStr<'static>,
        _accounts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<WorkRegistration>> {
        Ok(Vec::new())
    }

    async fn changes(
        &self,
        _viewer: &MacroUserIdStr<'static>,
        _accounts: &[MacroUserIdStr<'static>],
        _sessions: &[AgentSessionId],
        _ended_after: DateTime<Utc>,
    ) -> Result<WorkRegistrationChanges> {
        Ok(WorkRegistrationChanges::default())
    }

    async fn pull_request_changed(&self, _github_key: &str) -> Result<()> {
        Ok(())
    }

    async fn sweep(&self) -> Result<WorkRegistrationSweepReport> {
        self.sweeps
            .lock()
            .unwrap()
            .push(tokio::time::Instant::now());
        let mut ended = self.ended.lock().unwrap();
        let idle = if ended.is_empty() { 0 } else { ended.remove(0) };
        Ok(WorkRegistrationSweepReport {
            idle,
            ..WorkRegistrationSweepReport::default()
        })
    }
}

#[tokio::test(start_paused = true)]
async fn a_full_batch_sweeps_again_at_once_and_a_short_one_waits_for_the_interval() {
    let sweeps = ScriptedSweeps {
        ended: Mutex::new(vec![SWEEP_BATCH, 1]),
        sweeps: Mutex::new(Vec::new()),
    };
    let initial_delay = Duration::from_secs(60);
    let interval = Duration::from_secs(300);
    let started = tokio::time::Instant::now();

    run_work_registration_sweep(
        &sweeps,
        initial_delay,
        interval,
        tokio::time::sleep(initial_delay + interval + Duration::from_secs(1)),
    )
    .await;

    assert_eq!(
        *sweeps.sweeps.lock().unwrap(),
        vec![
            started + initial_delay,
            started + initial_delay,
            started + initial_delay + interval,
        ]
    );
}
