//! The host's timer wheel: machine [`Effect::ScheduleTimer`] requests go in,
//! due [`TimerToken`]s come out, in deadline order.
//!
//! Cancellation is the machine's job, not ours — a machine forgets tokens it
//! no longer cares about and ignores their firings — so the wheel never
//! removes an armed timer early.
//!
//! [`Effect::ScheduleTimer`]: sync_machine::model::Effect::ScheduleTimer

#[cfg(test)]
mod test;

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::time::Duration;
use sync_machine::model::TimerToken;
use tokio::time::Instant;

/// See the module docs.
pub(crate) struct TimerWheel {
    deadlines: BinaryHeap<Reverse<(Instant, TimerToken)>>,
}

impl TimerWheel {
    /// An empty wheel.
    pub(crate) fn new() -> Self {
        Self {
            deadlines: BinaryHeap::new(),
        }
    }

    /// Arm `token` to fire after `after_ms`.
    pub(crate) fn arm(&mut self, token: TimerToken, after_ms: u64) {
        self.deadlines.push(Reverse((
            Instant::now() + Duration::from_millis(after_ms),
            token,
        )));
    }

    /// Wait for the earliest armed timer to come due and return its token.
    /// Pends forever while nothing is armed, so it sits naturally in a
    /// `select!` alongside the input channel. Cancellation-safe: the timer is
    /// only popped once it has actually fired.
    pub(crate) async fn fired(&mut self) -> TimerToken {
        let Some(Reverse((deadline, _))) = self.deadlines.peek().copied() else {
            return std::future::pending().await;
        };
        tokio::time::sleep_until(deadline).await;
        let Reverse((_, token)) = self.deadlines.pop().expect("peeked above");
        token
    }
}
