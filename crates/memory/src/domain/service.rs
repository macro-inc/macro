//! Compose persisted context; only explicit edits and scheduled jobs can write it.
use super::{models::*, ports::*};
use chrono::{Duration, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use tracing::Instrument;

pub struct MemoryServiceImpl<R> {
    repo: R,
    generator: Arc<dyn MemoryGenerator>,
    judge: Arc<dyn MemoryJudge>,
    teams: Arc<dyn MemoryTeams>,
    activity: Arc<dyn MemoryActivity>,
}

impl<R> MemoryServiceImpl<R> {
    pub fn new(
        repo: R,
        generator: Arc<dyn MemoryGenerator>,
        judge: Arc<dyn MemoryJudge>,
        teams: Arc<dyn MemoryTeams>,
        activity: Arc<dyn MemoryActivity>,
    ) -> Self {
        Self {
            repo,
            generator,
            judge,
            teams,
            activity,
        }
    }
}

impl<R: ComposedMemoryRepo> MemoryService for MemoryServiceImpl<R> {
    #[tracing::instrument(skip_all, err)]
    async fn get_memory(&self, user: MacroUserIdStr<'static>) -> Result<Option<Memory>> {
        // Retain the deployed method contract, but reads no longer spawn generation.
        self.repo.enroll(&user).await?;
        let selected = self.repo.latest_activity(&user).await?;
        let explicit = self.repo.explicit(&user).await?;
        let teams = self.teams.members(&user).await?;
        let mut users: Vec<_> = teams.into_iter().flat_map(|(_, members)| members).collect();
        users.push(user.as_ref().to_owned());
        users.sort();
        users.dedup();
        let profiles = self.repo.profiles(&users).await?;
        if explicit.content.is_empty() && selected.is_empty() && profiles.is_empty() {
            return Ok(None);
        }
        let activity = render_activity(&selected);
        let explicit = format!(
            "# Private explicit memory (revision {}; user corrections take precedence over generated context)\n{}",
            explicit.revision,
            numbered(&explicit.content)
        );
        let profiles: Vec<_> = profiles
            .iter()
            .map(|(user, profile)| format!("## {user}\n{profile}"))
            .collect();
        let team = format!("# Current team profiles\n{}", profiles.join("\n"));
        Ok(Some(prompt::compose(&[&activity, &explicit, &team])))
    }

    /// Private memory is always read as the authenticated caller.
    #[tracing::instrument(skip_all, err)]
    async fn explicit(&self, user: &MacroUserIdStr<'_>) -> Result<ExplicitMemory> {
        self.repo.enroll(user).await?;
        self.repo.explicit(user).await
    }

    /// Only this user-invoked operation writes explicit memory. Generation never does.
    #[tracing::instrument(skip_all, err)]
    async fn update_memory(
        &self,
        user: MacroUserIdStr<'static>,
        revision: i64,
        edit: &MemoryEdit,
    ) -> Result<ExplicitMemory> {
        let current = self.repo.explicit(&user).await?;
        if current.revision != revision {
            return Err(MemoryError::Conflict);
        }
        let content = edit.apply(&current.content)?;
        // Deletion must remain possible even if older content fails today's judge.
        if !matches!(edit, MemoryEdit::Delete { .. }) {
            self.judge
                .review(user.clone(), MemoryKind::Explicit, &content)
                .await?;
        }
        self.repo.save_explicit(&user, revision, &content).await
    }

    /// Professional activity is visible only to its owner and current teammates.
    #[tracing::instrument(skip_all, err)]
    async fn get_user_activity(
        &self,
        caller: MacroUserIdStr<'static>,
        user: MacroUserIdStr<'static>,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<Activity>> {
        if end < start || end - start > Duration::days(366) {
            return Err(MemoryError::InvalidDate);
        }
        if caller != user
            && !self
                .teams
                .members(&caller)
                .await?
                .iter()
                .any(|(_, members)| members.iter().any(|id| id == user.as_ref()))
        {
            return Err(MemoryError::Forbidden);
        }
        self.repo.activity(&user, start, end).await
    }
}

/// Claims of one day before it is given up: what passed review is committed and
/// the user moves on, so a day that keeps failing never blocks the days after it.
pub const MAX_REFRESH_ATTEMPTS: u8 = 3;
/// Bounds one user's model work, inside the 25-minute claim lease.
const REFRESH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1200);
/// Bounds passing a day, which can run after a full refresh in the same lease.
const PASS_TIMEOUT:std::time::Duration = std::time::Duration::from_secs(240);
/// A day is generated only this long after it ends, so activity still on its way
/// into the activity log is counted before the day is judged inactive.
const ACTIVITY_SETTLE: Duration = Duration::hours(1);
/// A user who has not used Macro themselves for this long is away: each day that
/// comes due commits without a report, even when their agents worked that day.
/// Skipped days are not caught up when they come back.
pub const AWAY_AFTER: Duration = Duration::days(14);

/// Wait before the next claim of a day after a failed attempt: 1, 2, 4, 8, then
/// 16 hours, so transient provider errors clear without rerunning every lease.
pub fn retry_delay(attempt: u8) -> Duration {
    Duration::hours(1 << attempt.saturating_sub(1).min(4))
}

/// What one claim did with its day, recorded on the claim span.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum ClaimOutcome {
    /// The day committed, whether generated, skipped as inactive, or already done.
    Committed,
    /// Attempts ran out; the reviewed pieces committed and the day was passed.
    GaveUp,
    /// The user is away; the day was passed without a report.
    Away,
    /// The attempt failed; the day is claimed again after `retry_delay`.
    Retry,
}

impl<R: ComposedMemoryRepo> MemoryServiceImpl<R> {
    /// Await the complete daily generation and its atomic commit. Retries of a
    /// completed day are no-ops; concurrent jobs cannot overwrite newer output.
    /// Pieces that passed review in an earlier attempt are reused, and a day
    /// without activity commits without any model call.
    #[tracing::instrument(
        skip_all,
        fields(date = %date, kept = tracing::field::Empty, inactive = tracing::field::Empty),
        err
    )]
    pub async fn refresh(&self, user: MacroUserIdStr<'static>, date: NaiveDate) -> Result<()> {
        let Some(snapshot) = self.pending(&user, date).await? else {
            return Ok(());
        };
        let staged = self.staged(&user, date).await?;
        if staged.is_empty() {
            let acted = self.activity.acted_on(&user, date).await?;
            tracing::Span::current().record("inactive", !acted);
            if !acted {
                return self
                    .repo
                    .save_generation(&user, snapshot.revision, date, None, &[], &[])
                    .await;
            }
        }
        let week = period_start(date, Granularity::Week);
        let month = period_start(date, Granularity::Month);
        let daily = match staged.activity(Granularity::Day) {
            Some(kept) => kept.clone(),
            None => {
                let research = format!(include_str!("service/prompts/daily.md"), date = date);
                let content = self.generator.research(user.clone(), &research).await?;
                self.judge
                    .review(user.clone(), MemoryKind::Activity, &content)
                    .await?;
                let daily = Activity {
                    granularity: Granularity::Day,
                    period_start: date,
                    period_end: date,
                    content,
                };
                self.repo
                    .stage(&user, date, &Piece::Activity(daily.clone()))
                    .await?;
                daily
            }
        };
        let mut sources = snapshot.activity.clone();
        sources.push(daily.clone());
        let week_sources: Vec<_> = sources
            .iter()
            .filter(|r| {
                r.granularity == Granularity::Day && r.period_start >= week && r.period_end <= date
            })
            .cloned()
            .collect();
        let weekly = self
            .report(&user, date, &staged, Granularity::Week, week, &week_sources)
            .await?;
        sources.retain(|r| !(r.granularity == Granularity::Week && r.period_start == week));
        sources.push(weekly.clone());
        let monthly = self
            .report(
                &user,
                date,
                &staged,
                Granularity::Month,
                month,
                &monthly_sources(&sources, date),
            )
            .await?;
        let previous = snapshot
            .activity
            .iter()
            .find(|r| r.granularity == Granularity::Summary);
        let mut summary_sources = previous.cloned().into_iter().collect::<Vec<_>>();
        summary_sources.push(daily.clone());
        let summary = self
            .report(
                &user,
                date,
                &staged,
                Granularity::Summary,
                previous.map_or(date, |r| r.period_start),
                &summary_sources,
            )
            .await?;
        let profile = match staged.profile {
            Some(kept) => kept,
            None => {
                let profile_prompt = include_str!("service/prompts/profile.md");
                let profile = self
                    .generator
                    .research(user.clone(), profile_prompt)
                    .await?;
                self.judge
                    .review(user.clone(), MemoryKind::Profile, &profile)
                    .await?;
                self.repo
                    .stage(&user, date, &Piece::Profile(profile.clone()))
                    .await?;
                profile
            }
        };
        let teams = self.team_ids(&user).await?;
        self.repo
            .save_generation(
                &user,
                snapshot.revision,
                date,
                Some(&profile),
                &[daily, weekly, monthly, summary],
                &teams,
            )
            .await
    }

    /// Await sequential catch-up for one user through the requested completed day.
    #[tracing::instrument(skip_all, fields(through = %through), err)]
    pub async fn refresh_through(
        &self,
        user: MacroUserIdStr<'static>,
        through: NaiveDate,
    ) -> Result<()> {
        self.repo.enroll(&user).await?;
        let snapshot = self.repo.snapshot(&user, through).await?;
        let mut next = snapshot
            .through_date
            .and_then(|date| date.succ_opt())
            .or(snapshot.first_date)
            .unwrap_or(through);
        while next <= through {
            self.refresh(user.clone(), next).await?;
            next = next.succ_opt().ok_or(MemoryError::InvalidDate)?;
        }
        Ok(())
    }

    /// Process a bounded batch. A failed day is claimed again after a growing
    /// delay and given up after `MAX_REFRESH_ATTEMPTS` claims; other users
    /// continue. A day of a user who is away ([`AWAY_AFTER`]) is passed
    /// without a report. Cancellation never marks an unfinished day complete.
    /// `paused` is asked before every claim, so a kill switch stops the batch
    /// after the user in progress.
    #[tracing::instrument(skip_all, err)]
    pub async fn refresh_pending<P, F>(&self, mut paused: P) -> Result<()>
    where
        P: FnMut() -> F,
        F: Future<Output = bool>,
    {
        let yesterday = (Utc::now() - ACTIVITY_SETTLE).date_naive() - Duration::days(1);
        for _ in 0..25 {
            if paused().await {
                break;
            }
            let Some(claim) = self.repo.claim_refresh(yesterday).await? else {
                break;
            };
            let span = tracing::info_span!(
                "memory.refresh_claim",
                lease_token = %claim.token,
                date = %claim.date,
                attempt = claim.attempt,
                outcome = tracing::field::Empty,
            );
            async {
                let outcome = self.attempt(&claim).await;
                tracing::Span::current().record("outcome", outcome.as_ref());
                match outcome {
                    ClaimOutcome::Committed | ClaimOutcome::GaveUp | ClaimOutcome::Away => {
                        self.repo.release_refresh(&claim).await
                    }
                    ClaimOutcome::Retry => {
                        self.repo
                            .retry_refresh(&claim, retry_delay(claim.attempt))
                            .await
                    }
                }
            }
            .instrument(span)
            .await?;
        }
        Ok(())
    }

    async fn attempt(&self, claim: &RefreshClaim) -> ClaimOutcome {
        if !self.around(&claim.user).await {
            return self.pass(claim, ClaimOutcome::Away).await;
        }
        if claim.attempt <= MAX_REFRESH_ATTEMPTS {
            match tokio::time::timeout(
                REFRESH_TIMEOUT,
                self.refresh(claim.user.clone(), claim.date),
            )
            .await
            {
                Ok(Ok(())) => return ClaimOutcome::Committed,
                Ok(Err(error)) => tracing::warn!(error = ?error, "memory refresh failed"),
                Err(_) => tracing::warn!("memory refresh timed out"),
            }
            if claim.attempt < MAX_REFRESH_ATTEMPTS {
                return ClaimOutcome::Retry;
            }
        }
        self.pass(claim, ClaimOutcome::GaveUp).await
    }

    /// Whether the user used Macro within [`AWAY_AFTER`]. A failed read counts
    /// as around, so generation runs as it did before the check; the day's own
    /// activity check still applies.
    async fn around(&self, user: &MacroUserIdStr<'static>) -> bool {
        self.activity
            .used_since(user, Utc::now() - AWAY_AFTER)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not read whether the user is away; generating");
            })
            .unwrap_or(true)
    }

    /// Move past the claimed day, committing what passed review, and report
    /// `outcome`; a failure keeps the day for a later claim.
    async fn pass(&self, claim: &RefreshClaim, outcome: ClaimOutcome) -> ClaimOutcome {
        match tokio::time::timeout(
            PASS_TIMEOUT,
            self.commit_kept(claim.user.clone(), claim.date),
        )
        .await
        {
            Ok(Ok(())) => outcome,
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "memory refresh could not pass the day");
                ClaimOutcome::Retry
            }
            Err(_) => {
                tracing::warn!("memory refresh timed out passing the day");
                ClaimOutcome::Retry
            }
        }
    }

    /// Commit whatever pieces of `date` passed review and move past the day.
    #[tracing::instrument(skip_all, fields(date = %date, kept = tracing::field::Empty), err)]
    async fn commit_kept(&self, user: MacroUserIdStr<'static>, date: NaiveDate) -> Result<()> {
        let Some(snapshot) = self.pending(&user, date).await? else {
            return Ok(());
        };
        let staged = self.staged(&user, date).await?;
        let teams = if staged.activity.is_empty() {
            Vec::new()
        } else {
            self.team_ids(&user).await?
        };
        self.repo
            .save_generation(
                &user,
                snapshot.revision,
                date,
                staged.profile.as_deref(),
                &staged.activity,
                &teams,
            )
            .await
    }

    /// The snapshot to build `date` on, or `None` when the day is already done.
    async fn pending(
        &self,
        user: &MacroUserIdStr<'static>,
        date: NaiveDate,
    ) -> Result<Option<MemorySnapshot>> {
        if date >= Utc::now().date_naive() {
            return Err(MemoryError::InvalidDate);
        }
        let week = period_start(date, Granularity::Week);
        let month = period_start(date, Granularity::Month);
        let snapshot = self.repo.snapshot(user, week.min(month)).await?;
        if snapshot.through_date.is_some_and(|last| last >= date) {
            return Ok(None);
        }
        let expected_date = snapshot
            .through_date
            .and_then(|last| last.succ_opt())
            .or(snapshot.first_date);
        if expected_date.is_some_and(|next| next != date) {
            return Err(MemoryError::InvalidDate);
        }
        Ok(Some(snapshot))
    }

    /// Staged pieces of `date`, counted on the current span's `kept` field.
    async fn staged(
        &self,
        user: &MacroUserIdStr<'static>,
        date: NaiveDate,
    ) -> Result<StagedPieces> {
        let staged = self.repo.staged(user, date).await?;
        tracing::Span::current().record(
            "kept",
            staged.activity.len() + usize::from(staged.profile.is_some()),
        );
        Ok(staged)
    }

    async fn team_ids(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<macro_uuid::Uuid>> {
        Ok(self
            .teams
            .members(user)
            .await?
            .into_iter()
            .map(|(id, _)| id)
            .collect())
    }

    /// A rollup, reused from `staged` when an earlier attempt already passed it.
    async fn report(
        &self,
        user: &MacroUserIdStr<'static>,
        date: NaiveDate,
        staged: &StagedPieces,
        granularity: Granularity,
        start: NaiveDate,
        sources: &[Activity],
    ) -> Result<Activity> {
        if let Some(kept) = staged.activity(granularity) {
            return Ok(kept.clone());
        }
        let instructions = format!(
            include_str!("service/prompts/rollup.md"),
            granularity = granularity,
            start = start,
            end = date
        );
        let content = self
            .generator
            .summarize(user.clone(), &instructions, &render_activity(sources))
            .await?;
        self.judge
            .review(user.clone(), MemoryKind::Activity, &content)
            .await?;
        let report = Activity {
            granularity,
            period_start: start,
            period_end: date,
            content,
        };
        self.repo
            .stage(user, date, &Piece::Activity(report.clone()))
            .await?;
        Ok(report)
    }
}

fn numbered(content: &str) -> String {
    content
        .lines()
        .enumerate()
        .map(|(i, line)| format!("{}: {line}", i + 1))
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_activity(rows: &[Activity]) -> String {
    let sections: Vec<_> = rows
        .iter()
        .map(|r| {
            format!(
                "## {} ({} — {})\n{}",
                r.granularity, r.period_start, r.period_end, r.content
            )
        })
        .collect();
    let refs: Vec<&dyn std::fmt::Display> = sections
        .iter()
        .map(|s| s as &dyn std::fmt::Display)
        .collect();
    prompt::compose(&refs)
}

#[cfg(test)]
mod test;
