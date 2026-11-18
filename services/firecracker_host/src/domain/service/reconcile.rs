//! Bringing the records and the host back in line after the agent or the
//! host died at any point of an operation.
//!
//! Every operation saves the record after each step, and VMs outlive the
//! agent, so what a crash leaves is one of a few shapes: a record whose
//! process is gone, a process (with its jail) no record points at, a
//! hibernation published but not yet recorded, or a hibernation left behind
//! by a wake. [`settle`] decides one record; startup also removes jails no
//! record holds. While serving, [`HostService::reconcile_pass`] runs the
//! same checks on computers no operation holds.

use std::collections::HashSet;

use firecracker_host_api::{ComputerId, PowerState};
use tracing::Instrument;

use super::{HostError, HostProbe, HostService, internal};
use crate::domain::metrics::Repair;
use crate::domain::model::ComputerRecord;
use crate::domain::ports::{Disks, Goldens, Jail, Machines, Store};

#[cfg(test)]
mod test;

/// When a record is settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Moment {
    /// At agent startup: every live process is adopted.
    Startup,
    /// While serving, under the computer's lock.
    Serving,
}

/// What one reconcile did and could not do.
#[derive(Debug, Default)]
pub struct ReconcileReport {
    /// Repairs made.
    pub repairs: Vec<Repair>,
    /// What is still wrong: settle failures, jails that could not be
    /// removed, jails the agent does not recognize.
    pub unresolved: Vec<String>,
}

impl ReconcileReport {
    fn repaired(&mut self, computer_id: Option<ComputerId>, repairs: &[Repair]) {
        log_repairs(computer_id, repairs);
        self.repairs.extend_from_slice(repairs);
    }

    fn unresolved(&mut self, what: String) {
        tracing::warn!(problem = %what, "reconcile left a problem");
        self.unresolved.push(what);
    }
}

fn log_repairs(computer_id: Option<ComputerId>, repairs: &[Repair]) {
    let computer_id = computer_id.map(|computer_id| computer_id.to_string());
    for repair in repairs {
        if *repair == Repair::ProcessEnded {
            tracing::warn!(
                computer_id = computer_id.as_deref(),
                repair = %repair,
                "firecracker process ended on its own"
            );
        } else {
            tracing::info!(
                computer_id = computer_id.as_deref(),
                repair = %repair,
                "reconciled"
            );
        }
    }
}

/// Bring `record` in line with the host; returns what was repaired. The
/// caller saves the record when it changed and returns a freed slot.
pub async fn settle<M: Machines>(
    record: &mut ComputerRecord,
    machines: &M,
    moment: Moment,
) -> Result<Vec<Repair>, M::Err> {
    let computer_id = record.computer_id;
    let live = record
        .process
        .filter(|process| machines.alive(record, *process));
    let hibernation = machines.has_hibernation(computer_id);
    let mut repairs = Vec::new();
    match (record.state, live) {
        (PowerState::Running | PowerState::Paused, Some(process)) => {
            if record.state == PowerState::Paused && record.hibernating && hibernation {
                // Killed after publishing the snapshot, before ending the VM.
                machines.kill(record, process).await?;
                record.process = None;
                record.state = PowerState::Hibernated;
                repairs.push(Repair::HibernationFinished);
            } else {
                if moment == Moment::Startup {
                    repairs.push(Repair::Adopted);
                }
                if hibernation {
                    // Left by a wake killed before it discarded it; the
                    // guest ran since, so its memory no longer matches.
                    machines.discard_hibernation(computer_id).await?;
                    repairs.push(Repair::StaleHibernationDiscarded);
                }
            }
        }
        (PowerState::Running | PowerState::Paused, None) => {
            if let Some(process) = record.process.take() {
                // Removes the jail of a process that is gone.
                machines.kill(record, process).await?;
            }
            if record.hibernating && hibernation {
                // Killed after publishing, and the VM ended too.
                record.state = PowerState::Hibernated;
                repairs.push(Repair::HibernationFinished);
            } else {
                record.state = PowerState::Stopped;
                repairs.push(match moment {
                    Moment::Startup => Repair::SettledStopped,
                    Moment::Serving => Repair::ProcessEnded,
                });
                if hibernation {
                    machines.discard_hibernation(computer_id).await?;
                    repairs.push(Repair::StaleHibernationDiscarded);
                }
            }
        }
        (PowerState::Hibernated, _) => {
            if let Some(process) = record.process.take() {
                machines.kill(record, process).await?;
            }
            if !hibernation {
                // The snapshot is gone (a host that lost its disk): the
                // computer cold boots from its own disks.
                record.state = PowerState::Stopped;
                repairs.push(Repair::SettledStopped);
            }
        }
        (PowerState::Stopped, _) => {
            if let Some(process) = record.process.take() {
                machines.kill(record, process).await?;
                repairs.push(Repair::SettledStopped);
            }
            if hibernation {
                machines.discard_hibernation(computer_id).await?;
                repairs.push(Repair::StaleHibernationDiscarded);
            }
        }
    }
    // A hibernation in flight holds the computer's lock, so whatever the
    // flag was for has been decided above.
    record.hibernating = false;
    Ok(repairs)
}

/// At startup, before anything is served: settle every record and save
/// the ones that changed, then remove every jail no live process holds
/// (a launch or golden build cut short). Failures are reported, not
/// returned: one bad computer must not keep the agent from serving the rest.
pub async fn at_startup<S: Store, M: Machines>(
    records: &mut [ComputerRecord],
    store: &S,
    machines: &M,
) -> ReconcileReport {
    let mut report = ReconcileReport::default();
    for record in records.iter_mut() {
        let before = record.clone();
        match settle(record, machines, Moment::Startup).await {
            Ok(repairs) => report.repaired(Some(record.computer_id), &repairs),
            Err(error) => {
                *record = before;
                report.unresolved(format!("settling {}: {error}", record.computer_id));
                continue;
            }
        }
        if *record != before
            && let Err(error) = store.save(record).await
        {
            report.unresolved(format!("saving {}: {error}", record.computer_id));
        }
    }

    let held: HashSet<ComputerId> = records
        .iter()
        .filter(|record| record.process.is_some())
        .map(|record| record.computer_id)
        .collect();
    let jails = match machines.jails() {
        Ok(jails) => jails,
        Err(error) => {
            report.unresolved(format!("listing jails: {error}"));
            return report;
        }
    };
    for jail in jails {
        match &jail {
            Jail::Computer(computer_id) if held.contains(computer_id) => {}
            // No build runs before the agent serves.
            Jail::Computer(_) | Jail::Golden => remove_orphan(machines, &jail, &mut report).await,
            Jail::Unrecognized(name) => report.unresolved(format!("unrecognized jail {name}")),
        }
    }
    report
}

async fn remove_orphan<M: Machines>(machines: &M, jail: &Jail, report: &mut ReconcileReport) {
    let computer_id = match jail {
        Jail::Computer(computer_id) => Some(*computer_id),
        Jail::Golden | Jail::Unrecognized(_) => None,
    };
    match machines.remove_jail(jail).await {
        Ok(()) => report.repaired(computer_id, &[Repair::OrphanJailRemoved]),
        Err(error) => report.unresolved(format!("removing jail {jail:?}: {error}")),
    }
}

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Settle every computer no operation holds (a process that ended on
    /// its own), and remove computer jails no record holds. Computers busy
    /// in an operation are left for the next pass.
    pub async fn reconcile_pass(&self) -> ReconcileReport {
        let span = tracing::info_span!(
            "firecracker_host.reconcile",
            repairs = tracing::field::Empty,
            unresolved = tracing::field::Empty,
            busy = tracing::field::Empty,
        );
        let report = async {
            let mut report = ReconcileReport::default();
            let mut busy: i64 = 0;
            let computers: Vec<_> = {
                let computers = self
                    .computers
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                computers
                    .iter()
                    .map(|(computer_id, entry)| (*computer_id, entry.clone()))
                    .collect()
            };
            for (computer_id, entry) in &computers {
                let Ok(mut guard) = entry.try_lock() else {
                    busy += 1;
                    continue;
                };
                let Some(record) = guard.as_mut() else {
                    continue;
                };
                match self.settle_and_save(record).await {
                    // Logged by settle_and_save.
                    Ok(repairs) => report.repairs.extend(repairs),
                    Err(error) => report.unresolved(format!("settling {computer_id}: {error}")),
                }
            }

            match self.machines.jails() {
                Ok(jails) => {
                    for jail in jails {
                        let Jail::Computer(computer_id) = &jail else {
                            if let Jail::Unrecognized(name) = &jail {
                                report.unresolved(format!("unrecognized jail {name}"));
                            }
                            // A golden build runs in its jail now.
                            continue;
                        };
                        let entry = self.entry(*computer_id);
                        let Ok(guard) = entry.try_lock() else {
                            // Launching right now.
                            busy += 1;
                            continue;
                        };
                        let holds_process = guard
                            .as_ref()
                            .is_some_and(|record| record.process.is_some());
                        if !holds_process {
                            remove_orphan(&self.machines, &jail, &mut report).await;
                        }
                        drop(guard);
                        if !holds_process {
                            self.forget_if_absent(*computer_id);
                        }
                    }
                }
                Err(error) => report.unresolved(format!("listing jails: {error}")),
            }

            let current = tracing::Span::current();
            current.record(
                "repairs",
                i64::try_from(report.repairs.len()).unwrap_or(i64::MAX),
            );
            current.record(
                "unresolved",
                i64::try_from(report.unresolved.len()).unwrap_or(i64::MAX),
            );
            current.record("busy", busy);
            report
        }
        .instrument(span)
        .await;
        self.metrics.reconciled(&report);
        self.reconcile_clean.store(
            report.unresolved.is_empty(),
            std::sync::atomic::Ordering::Relaxed,
        );
        report
    }

    /// [`settle`] while serving: saves a changed record and returns a slot
    /// the process held.
    pub(super) async fn settle_and_save(
        &self,
        record: &mut ComputerRecord,
    ) -> Result<Vec<Repair>, HostError> {
        let before = record.clone();
        let repairs = settle(record, &self.machines, Moment::Serving)
            .await
            .map_err(internal)?;
        log_repairs(Some(record.computer_id), &repairs);
        if *record == before {
            return Ok(repairs);
        }
        if let (Some(process), None) = (before.process, record.process) {
            self.slot_pool().give_back(process.slot);
        }
        self.save(record).await?;
        Ok(repairs)
    }

    /// Restored guests whose `macro-restore` had not succeeded when the
    /// agent stopped: run it now instead of waiting for a repeated create.
    /// Each runs in its own task; dropping the handles leaves them running.
    pub fn resume_pending_restores(
        self: &std::sync::Arc<Self>,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        let pending: Vec<ComputerId> = self
            .running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|record| record.guest_restore_pending)
            .map(|record| record.computer_id)
            .collect();
        let mut handles = Vec::new();
        for computer_id in pending {
            let this = std::sync::Arc::clone(self);
            let span =
                tracing::info_span!("firecracker_host.restore_resume", computer_id = %computer_id);
            handles.push(self.tasks.spawn(
                async move {
                    let entry = this.entry(computer_id);
                    let mut guard = entry.lock().await;
                    let Some(record) = guard.as_mut() else {
                        return;
                    };
                    match this.finish_restore(record).await {
                        Ok(()) => {
                            log_repairs(Some(computer_id), &[Repair::RestoreResumed]);
                            this.metrics.repaired(&[Repair::RestoreResumed]);
                        }
                        Err(error) => {
                            tracing::warn!(computer_id = %computer_id, error = %error, "macro-restore after a restart failed; a repeated create retries it");
                        }
                    }
                }
                .instrument(span),
            ));
        }
        handles
    }

    /// Drop the map entry of a computer without a record, unless an
    /// operation holds it.
    fn forget_if_absent(&self, computer_id: ComputerId) {
        let mut computers = self
            .computers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(entry) = computers.get(&computer_id)
            && entry.try_lock().is_ok_and(|guard| guard.is_none())
        {
            computers.remove(&computer_id);
        }
    }
}
