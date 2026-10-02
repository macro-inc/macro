//! When to hand the user's comments to the agent.
//!
//! Comments are released once the user has been idle for [`QUIET_PERIOD_MS`]
//! with no comment draft open, so writing three comments in a row wakes the
//! agent once. Nothing is dropped; it just waits for the pause.

use crate::model::Millis;

/// How long the user must be idle before a batch is released.
pub const QUIET_PERIOD_MS: Millis = 1500;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FeedbackGate {
    last_activity: Option<Millis>,
    drafting: bool,
}

impl FeedbackGate {
    /// The user did something (commented, typed, opened a draft).
    pub fn touch(&mut self, now: Millis) {
        self.last_activity = Some(now);
    }

    pub fn set_drafting(&mut self, drafting: bool, now: Millis) {
        self.drafting = drafting;
        self.touch(now);
    }

    /// Whether the user has a comment draft open.
    pub fn drafting(&self) -> bool {
        self.drafting
    }

    /// Whether pending feedback may go out now.
    pub fn ready(&self, now: Millis) -> bool {
        !self.drafting && self.settled(now)
    }

    fn settled(&self, now: Millis) -> bool {
        self.last_activity.is_none_or(|t| now.saturating_sub(t) >= QUIET_PERIOD_MS)
    }

    /// How long to wait before `ready` could turn true (ignoring drafts).
    pub fn wait_ms(&self, now: Millis) -> Millis {
        match self.last_activity {
            Some(t) => (t + QUIET_PERIOD_MS).saturating_sub(now),
            None => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_for_a_pause() {
        let mut g = FeedbackGate::default();
        assert!(g.ready(0));
        g.touch(1000);
        assert!(!g.ready(2000));
        assert_eq!(g.wait_ms(2000), 500);
        assert!(g.ready(2500));
    }

    #[test]
    fn open_drafts_hold_feedback() {
        let mut g = FeedbackGate::default();
        g.set_drafting(true, 0);
        assert!(!g.ready(10_000));
        g.set_drafting(false, 10_000);
        assert!(g.ready(11_500));
    }
}
