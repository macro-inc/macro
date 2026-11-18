//! How a thread's importance moves while its classified message sits untouched.
//!
//! Nothing reclassifies a thread as it ages, so the read works out where
//! importance stands from what was stored. Each day it covers a fixed share of
//! the distance left to 100 or to 0, so threads keep their order as they move
//! rather than all piling up at the end, though rounding still ties those already
//! close to it.

use chrono::{DateTime, Utc};

use super::models::ImportanceTrend;

const SECONDS_PER_DAY: f64 = 86_400.0;
const MOST_IMPORTANT: u8 = 100;
const LEAST_IMPORTANT: u8 = 0;

/// Where `base` stands at `now` after moving at `rate` (see
/// [`FocusVerdict::importance_rate`](super::models::FocusVerdict::importance_rate))
/// since `since`. A `since` in the future counts as no time at all.
pub fn importance_at(base: u8, rate: i8, since: DateTime<Utc>, now: DateTime<Utc>) -> u8 {
    let base = f64::from(base.min(MOST_IMPORTANT));
    let days = (now - since).as_seconds_f64().max(0.0) / SECONDS_PER_DAY;
    let share_per_day = f64::from(rate.unsigned_abs().min(MOST_IMPORTANT)) / 100.0;
    let distance_left = (1.0 - share_per_day).powf(days);

    let importance = if rate > 0 {
        100.0 - (100.0 - base) * distance_left
    } else {
        base * distance_left
    };

    importance.round() as u8
}

impl ImportanceTrend {
    /// Which way a thread moving at `rate` is heading from `importance`. At the
    /// end it was moving towards, there is nowhere left to go.
    pub fn of(rate: i8, importance: u8) -> Self {
        if rate > 0 && importance < MOST_IMPORTANT {
            Self::Up
        } else if rate < 0 && importance > LEAST_IMPORTANT {
            Self::Down
        } else {
            Self::Flat
        }
    }
}

#[cfg(test)]
mod test;
