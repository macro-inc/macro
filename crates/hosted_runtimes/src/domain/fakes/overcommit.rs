//! [`OvercommitRepo`] over [`FakeRepo`]'s computers: hosts' settings and
//! reports, hibernation marks and wake requests, admitted with the same pure
//! [`overcommit::admit`] the Postgres adapter runs.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};

use super::{FakeError, FakeRepo};
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::overcommit::{
    self, AwakeAllocation, HostOvercommit, MemoryReport, Refusal, WakeAdmission,
};
use crate::domain::ports::OvercommitRepo;

/// Overcommit state the fake keeps beside its computers.
#[derive(Default)]
pub struct FakeOvercommit {
    /// Each host's settings, hardware and latest report.
    pub hosts: Mutex<HashMap<HostId, HostOvercommit>>,
    /// When each hibernated computer was hibernated.
    pub hibernated: Mutex<HashMap<ComputerId, DateTime<Utc>>>,
    /// When each wake was first asked for.
    pub wakes: Mutex<HashMap<ComputerId, DateTime<Utc>>>,
    /// When each host last admitted a wake.
    pub last_admitted: Mutex<HashMap<HostId, DateTime<Utc>>>,
}

impl FakeRepo {
    /// Whether `computer_id` may wake: like the Postgres adapter's admission.
    fn wake_refusal(&self, computer_id: ComputerId, now: DateTime<Utc>) -> Option<Refusal> {
        let computers = self.computers.lock().unwrap();
        let computer = computers.get(&computer_id)?;
        let hosts = self.overcommit.hosts.lock().unwrap();
        let Some(capacity) = hosts.get(&computer.host).and_then(|host| host.capacity) else {
            return Some(Refusal::UnknownHardware);
        };
        let state = hosts.get(&computer.host)?;
        let report = state.report.map(|report| {
            report.with_pending_starts(state.pending_starts, &capacity.policy.live_memory)
        });
        let hibernated = self.overcommit.hibernated.lock().unwrap();
        let awake = computers
            .values()
            .filter(|other| {
                other.host == computer.host
                    && other.id != computer_id
                    && other.state.is_awake()
                    && !hibernated.contains_key(&other.id)
            })
            .fold(AwakeAllocation::default(), |held, other| {
                held.with(other.resources)
            });
        overcommit::admit(&capacity, awake, computer.resources, report, now).err()
    }
}

impl OvercommitRepo for FakeRepo {
    type Err = FakeError;

    async fn host_overcommit(&self, host: HostId) -> Result<Option<HostOvercommit>, FakeError> {
        Ok(self.overcommit.hosts.lock().unwrap().get(&host).cloned())
    }

    async fn record_memory_report(
        &self,
        host: HostId,
        report: MemoryReport,
    ) -> Result<(), FakeError> {
        if let Some(state) = self.overcommit.hosts.lock().unwrap().get_mut(&host)
            && state
                .report
                .is_none_or(|old| old.reported_at <= report.reported_at)
        {
            state.report = Some(report);
            // Like the Postgres adapter: only a report measured after the
            // last admitted start clears the pending ones.
            if self
                .overcommit
                .last_admitted
                .lock()
                .unwrap()
                .get(&host)
                .is_none_or(|at| *at <= report.reported_at)
            {
                state.pending_starts = 0;
            }
        }
        Ok(())
    }

    async fn sync_hibernated(
        &self,
        host: HostId,
        hibernated: &[ComputerId],
        at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let computers = self.computers.lock().unwrap();
        let mut marks = self.overcommit.hibernated.lock().unwrap();
        let mut wakes = self.overcommit.wakes.lock().unwrap();
        for computer in computers.values().filter(|computer| computer.host == host) {
            if hibernated.contains(&computer.id) {
                marks.entry(computer.id).or_insert(at);
            } else {
                marks.remove(&computer.id);
                wakes.remove(&computer.id);
            }
        }
        Ok(())
    }

    async fn mark_hibernated(
        &self,
        computer_id: ComputerId,
        at: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.overcommit
            .hibernated
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_insert(at);
        Ok(())
    }

    async fn request_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        if !self
            .overcommit
            .hibernated
            .lock()
            .unwrap()
            .contains_key(&computer_id)
        {
            return Ok(false);
        }
        self.overcommit
            .wakes
            .lock()
            .unwrap()
            .entry(computer_id)
            .or_insert(now);
        Ok(true)
    }

    async fn wakes_requested(&self, host: HostId) -> Result<Vec<ComputerId>, FakeError> {
        let computers = self.computers.lock().unwrap();
        let hibernated = self.overcommit.hibernated.lock().unwrap();
        let mut wakes: Vec<(DateTime<Utc>, ComputerId)> = self
            .overcommit
            .wakes
            .lock()
            .unwrap()
            .iter()
            .filter(|(id, _)| {
                hibernated.contains_key(id)
                    && computers
                        .get(id)
                        .is_some_and(|computer| computer.host == host)
            })
            .map(|(id, at)| (*at, *id))
            .collect();
        wakes.sort_by_key(|(at, _)| *at);
        Ok(wakes.into_iter().map(|(_, id)| id).collect())
    }

    async fn admit_wake(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<WakeAdmission, FakeError> {
        if !self
            .overcommit
            .hibernated
            .lock()
            .unwrap()
            .contains_key(&computer_id)
        {
            return Ok(WakeAdmission::NotHibernated);
        }
        if let Some(refusal) = self.wake_refusal(computer_id, now) {
            return Ok(WakeAdmission::Refused(refusal));
        }
        self.overcommit
            .hibernated
            .lock()
            .unwrap()
            .remove(&computer_id);
        self.overcommit.wakes.lock().unwrap().remove(&computer_id);
        if let Some(host) = self
            .computers
            .lock()
            .unwrap()
            .get(&computer_id)
            .map(|computer| computer.host)
            && let Some(state) = self.overcommit.hosts.lock().unwrap().get_mut(&host)
        {
            state.pending_starts += 1;
            self.overcommit
                .last_admitted
                .lock()
                .unwrap()
                .insert(host, now);
        }
        Ok(WakeAdmission::Admitted)
    }
}
