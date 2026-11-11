use chrono::{DateTime, Utc};

use super::backoff::{CAPACITY_BACKOFF, Retry};
use super::{ComputerState, Context, Effect, Phase, TimerKind, boot};

/// Start a stopped computer when the host has room; otherwise wait and
/// retry. Awake computers need nothing.
pub(super) fn power_on(next: &mut ComputerState, effects: &mut Vec<Effect>, context: Context) {
    match next.phase {
        Phase::Stopped => {}
        Phase::Stopping => {
            next.power_on_requested = true;
            return;
        }
        Phase::Provisioning { .. }
        | Phase::Booting
        | Phase::Running
        | Phase::Crashed { .. }
        | Phase::Destroying => return,
    }

    if context.host_has_room {
        boot(
            next,
            effects,
            context.now,
            Some(Effect::Start { host: context.host }),
        );
    } else {
        next.power_on_requested = true;
        wait_for_room(next, effects, context.now);
    }
}

/// Schedule the next capacity check with [`CAPACITY_BACKOFF`]. A check
/// already scheduled in the future stands.
pub(super) fn wait_for_room(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    now: DateTime<Utc>,
) {
    let attempt = match &next.capacity_wait {
        Some(wait) if now < wait.next_at => return,
        Some(wait) => wait.attempt.saturating_add(1),
        None => 0,
    };
    let retry = Retry::after(CAPACITY_BACKOFF, attempt, now);
    next.capacity_wait = Some(retry);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::PowerOnRetry,
        at: retry.next_at,
    });
}
