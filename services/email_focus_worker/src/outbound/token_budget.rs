//! The worker's TypeSafe budget: backfills and sweeps wait on it, so they stay
//! inside TypeSafe's rate limits, and live mail never does.
//!
//! TypeSafe allows the account 100,000 tokens and 80 requests a second, and
//! the agent services share them. The budget refills at [`TOKENS_PER_SECOND`],
//! holding at most half a second's worth, or one call's when a call costs
//! more, so a burst after a quiet spell stays inside both limits.
//! Every Jev call the worker makes, live or not, is taken out of it at what
//! TypeSafe says it cost, and at least [`TOKENS_PER_REQUEST`], so the request
//! limit holds too. A background call waits until the budget holds what a call
//! has cost lately and sets that aside while it runs; a live call never waits,
//! so a burst of new mail makes the backfill wait instead.
//!
//! When TypeSafe says to slow down (a rate limit, overload, timeout or server
//! error after Jev's own retries; Jev can't tell a connection failure apart,
//! so that slows it too) the rate halves, at most once per [`COOL_DOWN`] and
//! down to [`MIN_TOKENS_PER_SECOND`], and climbs back by a tenth of the full
//! rate each [`COOL_DOWN`] without a push back. A failed background call keeps
//! what it set aside, so it can't hand the next call its share at once.

use std::{
    sync::{Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use tokio::{sync::Notify, time::Instant};

#[cfg(test)]
mod test;

/// The rate the worker's Jev calls may spend at, of TypeSafe's 100,000 tokens
/// a second; the rest is the agent services'.
pub const TOKENS_PER_SECOND: f64 = 60_000.0;
/// The lowest rate a slow-down leaves.
pub const MIN_TOKENS_PER_SECOND: f64 = 6_000.0;
/// The least a call costs: TypeSafe's 100,000 tokens over its 80 requests, so
/// calls on short threads keep inside the request limit as well.
pub const TOKENS_PER_REQUEST: f64 = 1_250.0;
/// How long a slow-down holds before the rate climbs, and each climb after.
/// Long enough that the calls already out when TypeSafe pushed back, each
/// retried by Jev for up to ~16 s, count as one push.
pub const COOL_DOWN: Duration = Duration::from_secs(30);
/// What a call is taken to cost before any has been counted: more than the
/// ~8,500 tokens of a typical Focus call, so the first calls out together
/// can't overrun the budget before any has reported its cost.
const FIRST_ESTIMATE: f64 = 20_000.0;
/// How far a cheaper call moves the estimate of what a call costs down; a
/// dearer one raises it to its own cost at once, so a run of long threads
/// can't take more than the budget while the estimate catches up.
const ESTIMATE_WEIGHT: f64 = 0.2;
/// The share of the full rate each cool-down without a push gives back.
const CLIMB: f64 = 0.1;
/// The shortest a background call waits for the budget to refill: a wait
/// that rounds to nothing would wake with nothing refilled, and spin.
const MIN_WAIT: Duration = Duration::from_millis(1);
/// How many seconds' worth the budget holds on hand: half a second's, so the
/// calls let through at once after a quiet spell, with the refill over the
/// next second, stay under TypeSafe's 100,000 tokens and 80 requests.
const ON_HAND_SECONDS: f64 = 0.5;

/// How fast the budget fills; [`Rates::default`] is production's.
#[derive(Debug, Clone, Copy)]
pub struct Rates {
    /// Tokens a second while TypeSafe isn't pushing back.
    pub full: f64,
    /// The lowest a slow-down takes the rate.
    pub min: f64,
    /// The least one call costs.
    pub per_request: f64,
    /// How long a slow-down holds, and each climb after.
    pub cool_down: Duration,
}

impl Default for Rates {
    fn default() -> Self {
        Self {
            full: TOKENS_PER_SECOND,
            min: MIN_TOKENS_PER_SECOND,
            per_request: TOKENS_PER_REQUEST,
            cool_down: COOL_DOWN,
        }
    }
}

struct State {
    /// Tokens on hand; below zero once live calls spent ahead of the refill.
    balance: f64,
    refilled_at: Instant,
    /// Tokens a second now.
    rate: f64,
    /// When the rate last fell or climbed.
    changed_at: Instant,
    /// When TypeSafe last pushed back.
    slowed_at: Option<Instant>,
    /// What a call has cost lately.
    estimate: f64,
}

impl State {
    /// Bring the rate and the balance up to `now`, each climb in between
    /// counting from when it came rather than back to the last refill.
    fn refill(&mut self, rates: &Rates, now: Instant) {
        while self.rate < rates.full {
            let climbs_at = self.changed_at + rates.cool_down;
            if climbs_at > now {
                break;
            }
            self.fill_until(climbs_at);
            self.rate = (self.rate + CLIMB * rates.full).min(rates.full);
            self.changed_at = climbs_at;
        }
        self.fill_until(now);
    }

    /// Add what the current rate gives from the last refill until `until`.
    fn fill_until(&mut self, until: Instant) {
        let elapsed = until
            .saturating_duration_since(self.refilled_at)
            .as_secs_f64();
        // At most half a second's worth on hand, so an idle worker can't
        // burst, or one call's worth when a call costs more than that: a
        // slowed-down budget must still let a long thread through.
        let cap = (self.rate * ON_HAND_SECONDS).max(self.estimate);
        self.balance = (self.balance + elapsed * self.rate).min(cap);
        self.refilled_at = self.refilled_at.max(until);
    }
}

/// What a background call set aside, given back when the call ends; what the
/// call really cost is taken out as TypeSafe reports it.
pub struct Reservation<'a> {
    budget: &'a TokenBudget,
    amount: f64,
}

impl Reservation<'_> {
    /// The call failed, so what it cost is unknown: leave what it set aside
    /// spent instead of giving it back.
    pub fn keep(mut self) {
        self.amount = 0.0;
    }
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        self.budget.state().balance += self.amount;
        self.budget.returned.notify_waiters();
    }
}

/// The worker's Jev budget, shared by every call.
pub struct TokenBudget {
    rates: Rates,
    state: Mutex<State>,
    /// Woken when a reservation is given back.
    returned: Notify,
}

impl TokenBudget {
    pub fn new(rates: Rates) -> Self {
        let now = Instant::now();
        Self {
            rates,
            state: Mutex::new(State {
                balance: rates.full * ON_HAND_SECONDS,
                refilled_at: now,
                rate: rates.full,
                changed_at: now,
                slowed_at: None,
                estimate: FIRST_ESTIMATE,
            }),
            returned: Notify::new(),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Take out what a call cost, as TypeSafe reported it.
    pub fn spend(&self, tokens: u64) {
        #[expect(
            clippy::cast_precision_loss,
            reason = "token counts are far below 2^52"
        )]
        let cost = (tokens as f64).max(self.rates.per_request);
        let mut state = self.state();
        state.refill(&self.rates, Instant::now());
        state.balance -= cost;
        state.estimate = if cost > state.estimate {
            cost
        } else {
            state.estimate + ESTIMATE_WEIGHT * (cost - state.estimate)
        };
    }

    /// Take out `requests` that reported no usage: each still counts against
    /// the request limit.
    pub fn spend_requests(&self, requests: u8) {
        let mut state = self.state();
        state.refill(&self.rates, Instant::now());
        state.balance -= f64::from(requests) * self.rates.per_request;
    }

    /// Wait until the budget holds what a call has cost lately, and set that
    /// aside until the reservation is dropped. Answers how long it waited.
    pub async fn reserve(&self) -> (Reservation<'_>, Duration) {
        let started = Instant::now();
        loop {
            let returned = self.returned.notified();
            tokio::pin!(returned);
            let wait = {
                let mut state = self.state();
                state.refill(&self.rates, Instant::now());
                let amount = state.estimate;
                if state.balance >= amount {
                    state.balance -= amount;
                    let reservation = Reservation {
                        budget: self,
                        amount,
                    };
                    return (reservation, started.elapsed());
                }
                // Registered while the state is held, so a reservation given
                // back from here on wakes this one.
                returned.as_mut().enable();
                Duration::from_secs_f64((amount - state.balance) / state.rate).max(MIN_WAIT)
            };
            tokio::select! {
                () = tokio::time::sleep(wait) => {}
                () = &mut returned => {}
            }
        }
    }

    /// TypeSafe pushed back: halve the rate, unless it already fell within the
    /// last cool-down, and let nothing else through until the balance refills.
    /// Either way the rate climbs no sooner than a cool-down from now.
    /// Answers whether the rate fell.
    pub fn slow_down(&self) -> bool {
        let now = Instant::now();
        let mut state = self.state();
        state.refill(&self.rates, now);
        state.changed_at = now;
        if state
            .slowed_at
            .is_some_and(|at| now.duration_since(at) < self.rates.cool_down)
        {
            return false;
        }
        state.rate = (state.rate / 2.0).max(self.rates.min);
        state.slowed_at = Some(now);
        state.balance = state.balance.min(0.0);
        true
    }

    /// Tokens a second now.
    pub fn rate(&self) -> f64 {
        let mut state = self.state();
        state.refill(&self.rates, Instant::now());
        state.rate
    }
}
