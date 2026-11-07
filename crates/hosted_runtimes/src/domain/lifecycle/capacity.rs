use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{
    ComputerState, Context, Effect, HostId, MAX_WAKE_RETRY, Phase, TimerKind, WAKE_RETRY, boot,
};

/// Durable backoff for a wake blocked by host capacity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapacityWait {
    /// Earliest time a periodic capacity check may run.
    pub retry_at: DateTime<Utc>,
    /// Exponent of the next retry delay, capped at five.
    pub backoff_step: u8,
    /// The last room request found no frozen computer to suspend.
    pub room_unavailable: bool,
}

/// Wake a stopped or suspended computer when the host has room; otherwise
/// ask for room and retry. Awake computers need nothing.
pub(super) fn wake(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    context: Context,
) {
    let start = match next.phase {
        Phase::Stopped { .. } => Effect::Start { host },
        Phase::Suspended {
            saved_state: true, ..
        } => Effect::Resume { host },
        Phase::Suspended {
            saved_state: false, ..
        }
        | Phase::Stopping { .. } => {
            next.wake_requested = true;
            return;
        }
        _ => return,
    };

    if context.host_has_room {
        boot(next, effects, host, context.now, Some(start));
    } else {
        next.wake_requested = true;
        make_room(next, effects, host, context.now);
    }
}

pub(super) fn make_room(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    now: DateTime<Utc>,
) {
    let (backoff_step, room_unavailable) = match &next.capacity_wait {
        Some(wait) if now < wait.retry_at => return,
        Some(wait) => (
            wait.backoff_step.saturating_add(1).min(5),
            wait.room_unavailable,
        ),
        None => {
            effects.push(Effect::MakeRoom { host });
            (0, false)
        }
    };
    let delay = (WAKE_RETRY * (1_i32 << backoff_step)).min(MAX_WAKE_RETRY);
    let retry_at = now + delay;
    next.capacity_wait = Some(CapacityWait {
        retry_at,
        backoff_step,
        room_unavailable,
    });
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::WakeRetry,
        at: retry_at,
    });
}
