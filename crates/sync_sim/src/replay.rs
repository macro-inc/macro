//! Exact replay and first-difference diagnostics, without environment or filesystem access.
use crate::*;

impl Outcome {
    /// Re-run this exact configuration and literal script on fresh real cores.
    pub fn replay(&self) -> Self {
        Sim::new(self.config.clone()).run(&self.script)
    }
    /// Re-run and compare observations, raw server port bytes and both final states.
    pub fn check_replay(&self) -> Result<(), Failure> {
        if !self.external_clients.is_empty() {
            return Err(self.replay_failure(
                "external peers require the caller-owned command/report transcript",
            ));
        }
        self.compare_replay(&self.replay())
    }
    /// Seed, complete configuration and debug script for a failed run.
    /// Use `story_source` for a complete compilable literal regression.
    pub fn reproduction(&self) -> String {
        format!(
            "SIM_SEED={}\nconfig={:#?}\nscript={:#?}",
            self.seed, self.config, self.script
        )
    }
    /// Compare actual immutable observations, even when a caller altered cached hashes/bytes.
    pub fn compare_replay(&self, other: &Self) -> Result<(), Failure> {
        if self.seed != other.seed {
            return Err(self.replay_failure("different input seeds"));
        }
        for index in 0..self.events.len().max(other.events.len()) {
            let left = self.events.get(index);
            let right = other.events.get(index);
            if left != right {
                let mut failure = self.replay_failure(format!(
                    "first differing event{index}: left={left:?}, right={right:?}"
                ));
                failure.at = self
                    .events
                    .get(index)
                    .or_else(|| other.events.get(index))
                    .map(|event| event.at);
                return Err(failure);
            }
        }
        for index in 0..self.server_ports.len().max(other.server_ports.len()) {
            let left = self
                .server_ports
                .get(index)
                .map(|port| (port.doc, port.callback, &port.effect));
            let right = other
                .server_ports
                .get(index)
                .map(|port| (port.doc, port.callback, &port.effect));
            if left != right {
                return Err(self.replay_failure(format!(
                    "first differing server port{index}: left={left:?}, right={right:?}"
                )));
            }
        }
        if self.finals != other.finals {
            return Err(self.replay_failure("final state differs"));
        }
        if self.finals_after_quiet != other.finals_after_quiet {
            return Err(self.replay_failure("final state after quiet differs"));
        }
        if self.per_step_failures != other.per_step_failures {
            return Err(self.replay_failure("per-step failures differ"));
        }
        if self.stats != other.stats {
            return Err(self.replay_failure("work counters differ"));
        }
        if self.event_bytes != other.event_bytes {
            return Err(self.replay_failure("canonical event bytes differ"));
        }
        if self.trace_hash != other.trace_hash {
            return Err(self.replay_failure("trace hash differs"));
        }
        Ok(())
    }
    fn replay_failure(&self, detail: impl ToString) -> Failure {
        Failure::new(
            "determinism",
            format!("{}\n{}", detail.to_string(), self.reproduction()),
        )
    }
}
