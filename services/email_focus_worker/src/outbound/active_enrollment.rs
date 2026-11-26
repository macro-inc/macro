//! Focus works only for people who are around. Someone in the rollout who
//! has not used Macro within the window (the activity crate's check: a
//! signed-in client of theirs open, or a change they made themselves) counts
//! as out of it, so the inboxes their tab shows get no classification, no
//! backfill and no sweep. The look for inboxes joining the rollout finds
//! theirs again once they are back, and fills it.

use std::{
    collections::HashMap,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use activity::UserActivity;
use chrono::Utc;
use email::domain::focus::FocusEnrollment;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tokio::time::Instant;
use tracing::field::Empty;

#[cfg(test)]
mod test;

/// The rollout `E`, narrowed to people active within a window by `A`.
///
/// The flag is read first, so nobody outside the rollout is looked up. An
/// answer about activity is kept for `remember_for`: every classification and
/// each minute's look ask about the same people, and someone who comes back
/// waits at most that long, plus a look, for their inbox to fill.
pub struct ActiveEnrollment<E, A> {
    rollout: E,
    activity: A,
    within: chrono::Duration,
    remember_for: Duration,
    answers: Mutex<Answers>,
}

#[derive(Default)]
struct Answers {
    by_user: HashMap<MacroUserIdStr<'static>, Answer>,
    /// When expired answers are next dropped, so the map holds only people
    /// asked about lately.
    next_prune: Option<Instant>,
}

#[derive(Clone, Copy)]
struct Answer {
    active: bool,
    at: Instant,
}

impl<E, A> ActiveEnrollment<E, A> {
    /// Enroll the people `rollout` enrolls who `activity` finds active within
    /// `within`, remembering each answer for `remember_for`.
    pub fn new(rollout: E, activity: A, within: chrono::Duration, remember_for: Duration) -> Self {
        Self {
            rollout,
            activity,
            within,
            remember_for,
            answers: Mutex::default(),
        }
    }

    fn remembered(&self, user: &MacroUserIdStr<'static>, now: Instant) -> Option<bool> {
        let answers = self.answers.lock().unwrap_or_else(PoisonError::into_inner);
        answers
            .by_user
            .get(user)
            .filter(|answer| now.duration_since(answer.at) < self.remember_for)
            .map(|answer| answer.active)
    }

    fn remember(&self, user: &MacroUserIdStr<'static>, active: bool, now: Instant) {
        let mut answers = self.answers.lock().unwrap_or_else(PoisonError::into_inner);
        if answers.next_prune.is_none_or(|at| now >= at) {
            let remember_for = self.remember_for;
            answers
                .by_user
                .retain(|_, answer| now.duration_since(answer.at) < remember_for);
            answers.next_prune = Some(now + remember_for);
        }
        answers
            .by_user
            .insert(user.clone(), Answer { active, at: now });
    }
}

impl<E, A> ActiveEnrollment<E, A>
where
    A: UserActivity + Send + Sync,
{
    #[tracing::instrument(
        name = "email_focus.activity",
        skip_all,
        fields(active = Empty, remembered = Empty),
        err
    )]
    async fn is_active(&self, user: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        let span = tracing::Span::current();
        let now = Instant::now();
        if let Some(active) = self.remembered(user, now) {
            span.record("remembered", true);
            span.record("active", active);
            return Ok(active);
        }
        let active = self
            .activity
            .is_active(user, Utc::now() - self.within)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic())?;
        self.remember(user, active, now);
        span.record("remembered", false);
        span.record("active", active);
        Ok(active)
    }
}

impl<E, A> FocusEnrollment for ActiveEnrollment<E, A>
where
    E: FocusEnrollment,
    A: UserActivity + Send + Sync + 'static,
{
    /// In the rollout and active. Either read failing leaves the answer
    /// unknown, never "not enrolled", and an unknown answer is not kept.
    async fn is_enrolled(&self, user: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        if !self.rollout.is_enrolled(user).await? {
            return Ok(false);
        }
        self.is_active(user).await
    }
}
