//! Retry delays: exponential from a fast first step to a cap, each one
//! jittered so computers that boot together do not retry in lockstep.

use std::time::Duration;

#[cfg(test)]
mod test;

/// Delays that start at `first` and double up to `cap`.
#[derive(Debug, Clone)]
pub struct RetryDelays {
    first: Duration,
    cap: Duration,
    next: Duration,
}

impl RetryDelays {
    /// Start at `first` and double each step up to `cap`.
    pub const fn new(first: Duration, cap: Duration) -> Self {
        Self {
            first,
            cap,
            next: first,
        }
    }

    /// The same delay every time.
    pub const fn every(delay: Duration) -> Self {
        Self::new(delay, delay)
    }

    /// Start over from the first delay.
    pub fn reset(&mut self) {
        self.next = self.first;
    }

    /// The next delay before jitter.
    fn next_unjittered(&mut self) -> Duration {
        let delay = self.next;
        self.next = (self.next * 2).min(self.cap);
        delay
    }

    /// The next delay, jittered by up to a quarter either way.
    pub fn next_delay(&mut self) -> Duration {
        jitter(self.next_unjittered(), rand::random())
    }
}

/// Spread `delay` over three quarters to five quarters of itself; `unit` is
/// uniform in `[0, 1)`.
fn jitter(delay: Duration, unit: f64) -> Duration {
    delay.mul_f64(0.75 + unit / 2.0)
}
