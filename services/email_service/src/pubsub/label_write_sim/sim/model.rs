//! The user's intent per message label, how each queued label write ended,
//! and the invariants checked after every step.

use super::super::fake_gmail::{Kind, Logged, Reply};
use super::super::wiring;
use super::super::world::{MESSAGES, TRACKED};
use super::{EntryState, OpStatus, Sim, Step, Violation};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

impl Sim<'_> {
    pub(super) fn initial(message: &str, label: &str) -> bool {
        MESSAGES
            .iter()
            .find(|(id, _, _)| *id == message)
            .is_some_and(|(_, _, labels)| labels.contains(&label))
    }

    /// The user's last effective intent for a cell, or `None` when its latest
    /// write dead-lettered.
    pub(super) fn intent(&self, message: &str, label: &str) -> Option<bool> {
        let entries = &self.cells[&(message.to_string(), label.to_string())];
        let latest = entries
            .iter()
            .filter(|entry| entry.state != EntryState::Rejected)
            .max_by_key(|entry| entry.seq);
        match latest {
            None => Some(Self::initial(message, label)),
            Some(entry) if entry.state == EntryState::DeadLettered => None,
            Some(entry) => Some(entry.value),
        }
    }

    /// The newest non-rejected write on a cell.
    pub(super) fn latest_seq(&self, message: &str, label: &str) -> Option<u64> {
        self.cells[&(message.to_string(), label.to_string())]
            .iter()
            .filter(|entry| entry.state != EntryState::Rejected)
            .map(|entry| entry.seq)
            .max()
    }

    pub(super) fn violate(&mut self, invariant: &'static str, detail: String) {
        self.violations.push(Violation {
            invariant,
            step: self.step_index,
            detail,
        });
    }

    pub(super) fn account_write(
        &mut self,
        lineage: u64,
        log: &[Logged],
        deleted: bool,
        resent: bool,
        applied_before: Option<u64>,
    ) {
        let track = self.ops[&lineage].clone();
        let in_op: Vec<String> = track
            .op
            .messages
            .iter()
            .map(|(_, provider_id)| provider_id.clone())
            .collect();
        let writes: Vec<&Logged> = log
            .iter()
            .filter(|entry| {
                entry.kind == Kind::Write
                    && entry.ids.iter().all(|id| in_op.contains(id))
                    && (if track.value {
                        entry.add.contains(&track.label)
                    } else {
                        entry.remove.contains(&track.label)
                    })
            })
            .collect();
        self.stats.gmail_writes += writes.len() as u64;
        for (index, write) in writes.iter().enumerate() {
            if write.reply != Reply::Ok {
                continue;
            }
            // Only the first write can be the one Gmail applied while later
            // steps ran; any per-message write after it was sent later.
            let cutoff = match index {
                0 => applied_before.unwrap_or(u64::MAX),
                _ => u64::MAX,
            };
            for id in &write.ids {
                let newer = self.cells[&(id.clone(), track.label.clone())]
                    .iter()
                    .filter(|entry| entry.state != EntryState::Rejected && entry.seq <= cutoff)
                    .max_by_key(|entry| entry.seq)
                    .map(|entry| (entry.seq, entry.value, entry.lineage));
                if let Some((latest, value, newer_lineage)) = newer
                    && latest > track.seq
                    && value != track.value
                {
                    // The newer write is still queued and will set Gmail
                    // again; sync keeps its local state meanwhile.
                    if self.ops[&newer_lineage].status == OpStatus::Queued {
                        self.stats.transient_stale_applies += 1;
                        continue;
                    }
                    self.violate(
                        "gmail-applied-stale-write",
                        format!(
                            "write from action {} set {id}/{} = {} at Gmail after newer action {latest}",
                            track.seq, track.label, track.value
                        ),
                    );
                }
            }
        }
        let accepted_now = writes
            .iter()
            .filter(|write| write.reply == Reply::Ok)
            .flat_map(|write| write.ids.iter().cloned());
        self.ops
            .get_mut(&lineage)
            .unwrap()
            .accepted
            .extend(accepted_now);
        if !deleted || resent {
            return;
        }
        let accepted = self.ops[&lineage].accepted.clone();
        let sent_ids: BTreeSet<String> = writes
            .iter()
            .flat_map(|write| write.ids.iter().cloned())
            .collect();
        let outcome = if writes.iter().any(|write| write.reply == Reply::Rejected) {
            OpStatus::Rejected
        } else if writes.iter().any(|write| write.reply == Reply::Ok) {
            OpStatus::Applied
        } else if writes.is_empty() {
            OpStatus::Skipped
        } else {
            self.violate(
                "write-dropped",
                format!(
                    "write from action {} deleted after only retryable Gmail errors",
                    track.seq
                ),
            );
            OpStatus::Skipped
        };
        let superseded = |sim: &Self, id: &String| {
            sim.latest_seq(id, &track.label)
                .is_some_and(|latest| latest > track.seq)
        };
        if outcome == OpStatus::Rejected {
            // A rejection gives the write up on every message Gmail hasn't
            // accepted: the rejected one, those not sent yet and those
            // waiting for a newer write.
            let rejected: Vec<String> = in_op
                .iter()
                .filter(|id| !accepted.contains(*id))
                .cloned()
                .collect();
            self.set_entries(lineage, &rejected, EntryState::Rejected);
        }
        if outcome == OpStatus::Skipped {
            self.stats.skipped_superseded += 1;
        }
        for id in &in_op {
            if sent_ids.contains(id) || accepted.contains(id) || outcome == OpStatus::Rejected {
                continue;
            }
            if !superseded(self, id) {
                self.violate(
                    "write-dropped",
                    format!(
                        "write from action {} finished without sending {id}/{}, and no newer action owns it",
                        track.seq, track.label
                    ),
                );
            }
        }
        self.ops.get_mut(&lineage).unwrap().status = outcome;
    }

    pub async fn check_step(&mut self, step: &str) {
        let db = self.world.db_labels().await;
        let gmail = self.world.gmail_labels();
        let mut lost = BTreeSet::new();
        for (message, _, _) in MESSAGES {
            for label in TRACKED {
                let Some(intent) = self.intent(message, label) else {
                    lost.insert((message.to_string(), label.to_string()));
                    continue;
                };
                let in_db = db[message].contains(label);
                if in_db != intent {
                    let pending = gmail[message].contains(label) != intent;
                    let invariant = if pending {
                        "pending-write-reverted"
                    } else {
                        "db-diverged-from-intent"
                    };
                    self.violate(
                        invariant,
                        format!(
                            "after {step}: {message}/{label} db={in_db} intent={intent} gmail={}",
                            gmail[message].contains(label)
                        ),
                    );
                }
            }
        }
        self.lost_cells.extend(lost);
        for problem in self.world.flag_mismatches().await {
            self.violate("thread-flags-mismatch", format!("after {step}: {problem}"));
        }
        self.check_markers(step).await;
    }

    /// Every live marker belongs to a write still on its way to Gmail.
    pub(super) async fn check_markers(&mut self, step: &str) {
        let ids: Vec<Uuid> = self.world.message_ids.values().copied().collect();
        let provider_by_db: HashMap<Uuid, String> = self
            .world
            .message_ids
            .iter()
            .map(|(provider, db)| (*db, provider.clone()))
            .collect();
        let queued_lineages: BTreeSet<u64> = self
            .queued
            .iter()
            .filter_map(|queued| queued.lineage)
            .collect();
        for marker in wiring::markers(&self.world.db, &ids).await {
            if !marker.live {
                continue;
            }
            let provider_id = provider_by_db[&marker.message_id].clone();
            let owner = self
                .lineage_by_write
                .get(&(marker.write_id, provider_id))
                .copied();
            let in_flight = owner.is_some_and(|lineage| queued_lineages.contains(&lineage));
            if !in_flight {
                let status = owner.map(|lineage| self.ops[&lineage].status);
                if status == Some(OpStatus::DeadLettered) {
                    continue;
                }
                self.violate(
                    "stale-marker",
                    format!(
                        "after {step}: marker {}/{} owned by write {:?} whose op is {status:?}",
                        provider_by_db[&marker.message_id], marker.label, owner
                    ),
                );
            }
        }
    }

    /// Gmail accepts everything, every queue drains, every message gets the
    /// echo sync its Gmail change would trigger, and then Gmail, the database
    /// and the user's last intent must agree.
    pub async fn quiesce(&mut self) {
        self.trace.push(format!("t={} quiesce", self.now));
        self.drain(false).await;
        for message in 0..MESSAGES.len() {
            self.run_step(Step::Sync {
                message,
                reply: Reply::Ok,
            })
            .await;
        }
        self.drain(false).await;
        self.check_step("quiesce").await;
        let db = self.world.db_labels().await;
        let gmail = self.world.gmail_labels();
        for (message, _, _) in MESSAGES {
            for label in TRACKED {
                let Some(intent) = self.intent(message, label) else {
                    continue;
                };
                let at_gmail = gmail[message].contains(label);
                if at_gmail != intent || db[message].contains(label) != at_gmail {
                    self.violate(
                        "no-convergence",
                        format!(
                            "{message}/{label}: intent={intent} gmail={at_gmail} db={}",
                            db[message].contains(label)
                        ),
                    );
                }
            }
        }
        let ids: Vec<Uuid> = self.world.message_ids.values().copied().collect();
        let provider_by_db: HashMap<Uuid, String> = self
            .world
            .message_ids
            .iter()
            .map(|(provider, db)| (*db, provider.clone()))
            .collect();
        for marker in wiring::markers(&self.world.db, &ids).await {
            let provider_id = provider_by_db[&marker.message_id].clone();
            let owner = self
                .lineage_by_write
                .get(&(marker.write_id, provider_id))
                .copied();
            let dead =
                owner.is_some_and(|lineage| self.ops[&lineage].status == OpStatus::DeadLettered);
            if marker.live && !dead {
                self.violate(
                    "marker-left-after-quiesce",
                    format!("{marker:?} owned by {owner:?}"),
                );
            }
        }
        for (lineage, track) in &self.ops {
            if track.status == OpStatus::Queued {
                self.violations.push(Violation {
                    invariant: "write-never-finished",
                    step: self.step_index,
                    detail: format!("lineage {lineage} from action {}", track.seq),
                });
            }
        }
    }
}
