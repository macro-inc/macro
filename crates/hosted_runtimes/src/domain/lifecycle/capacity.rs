use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{
    ComputerState, Context, Effect, HostId, MAX_WAKE_RETRY, Phase, TimerKind, WAKE_RETRY, boot,
};

/// Durable backoff for a start blocked by host capacity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapacityWait {
    /// Earliest time a periodic capacity check may run.
    pub retry_at: DateTime<Utc>,
    /// Exponent of the next retry delay, capped at five.
    pub backoff_step: u8,
}

/// Start a stopped computer when the host has room; otherwise wait and
/// retry. Awake computers need nothing.
pub(super) fn wake(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    context: Context,
) {
    match next.phase {
        Phase::Stopped { .. } => {}
        Phase::Stopping { .. } => {
            next.wake_requested = true;
            return;
        }
        _ => return,
    }

    if context.host_has_room {
        boot(
            next,
            effects,
            host,
            context.now,
            Some(Effect::Start { host }),
        );
    } else {
        next.wake_requested = true;
        wait_for_room(next, effects, context.now);
    }
}

/// Schedule the next capacity check, backing off from [`WAKE_RETRY`] up to
/// [`MAX_WAKE_RETRY`]. A check already scheduled in the future stands.
pub(super) fn wait_for_room(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    now: DateTime<Utc>,
) {
    let backoff_step = match &next.capacity_wait {
        Some(wait) if now < wait.retry_at => return,
        Some(wait) => wait.backoff_step.saturating_add(1).min(5),
        None => 0,
    };
    let delay = (WAKE_RETRY * (1_i32 << backoff_step)).min(MAX_WAKE_RETRY);
    let retry_at = now + delay;
    next.capacity_wait = Some(CapacityWait {
        retry_at,
        backoff_step,
    });
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::WakeRetry,
        at: retry_at,
    });
}
