//! Compose persisted context; only explicit edits and scheduled jobs can write it.
use super::{models::*, ports::*};
use chrono::{Duration, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use tracing::Instrument;

pub struct MemoryServiceImpl<R> {
    repo: R,
    generator: Arc<dyn MemoryGenerator>,
    teams: Arc<dyn MemoryTeams>,
}

impl<R> MemoryServiceImpl<R> {
    pub fn new(repo: R, generator: Arc<dyn MemoryGenerator>, teams: Arc<dyn MemoryTeams>) -> Self {
        Self {
            repo,
            generator,
            teams,
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
}

impl<R: ComposedMemoryRepo> MemoryServiceImpl<R> {
    /// Private memory is always read as the authenticated caller.
    #[tracing::instrument(skip_all, err)]
    pub async fn explicit(&self, user: &MacroUserIdStr<'_>) -> Result<ExplicitMemory> {
        self.repo.enroll(user).await?;
        self.repo.explicit(user).await
    }

    /// Only this user-invoked operation writes explicit memory. Generation never does.
    #[tracing::instrument(skip_all, err)]
    pub async fn update_memory(
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
            self.generator.judge(user.clone(), &content).await?;
        }
        self.repo.save_explicit(&user, revision, &content).await
    }

    /// Professional activity is visible only to its owner and current teammates.
    #[tracing::instrument(skip_all, err)]
    pub async fn get_user_activity(
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

    /// Await the complete daily generation and its atomic commit. Retries of a
    /// completed day are no-ops; concurrent jobs cannot overwrite newer output.
    #[tracing::instrument(skip_all, fields(date = %date), err)]
    pub async fn refresh(&self, user: MacroUserIdStr<'static>, date: NaiveDate) -> Result<()> {
        if date >= Utc::now().date_naive() {
            return Err(MemoryError::InvalidDate);
        }
        let week = period_start(date, Granularity::Week);
        let month = period_start(date, Granularity::Month);
        let snapshot = self.repo.snapshot(&user, week.min(month)).await?;
        if snapshot.through_date.is_some_and(|last| last >= date) {
            return Ok(());
        }
        let expected_date = snapshot
            .through_date
            .and_then(|last| last.succ_opt())
            .or(snapshot.first_date);
        if expected_date.is_some_and(|next| next != date) {
            return Err(MemoryError::InvalidDate);
        }
        let research = format!(include_str!("service/prompts/daily.md"), date = date);
        let daily = self.generator.research(user.clone(), &research).await?;
        self.generator.judge(user.clone(), &daily).await?;
        let daily = Activity {
            granularity: Granularity::Day,
            period_start: date,
            period_end: date,
            content: daily,
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
            .report(user.clone(), Granularity::Week, week, date, &week_sources)
            .await?;
        sources.retain(|r| !(r.granularity == Granularity::Week && r.period_start == week));
        sources.push(weekly.clone());
        let monthly = self
            .report(
                user.clone(),
                Granularity::Month,
                month,
                date,
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
                user.clone(),
                Granularity::Summary,
                previous.map_or(date, |r| r.period_start),
                date,
                &summary_sources,
            )
            .await?;
        let profile_prompt = include_str!("service/prompts/profile.md");
        let profile = self
            .generator
            .research(user.clone(), profile_prompt)
            .await?;
        self.generator.judge(user.clone(), &profile).await?;
        let teams: Vec<_> = self
            .teams
            .members(&user)
            .await?
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        self.repo
            .save_generation(
                &user,
                snapshot.revision,
                date,
                &profile,
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

    /// Process a bounded batch. A failed user retains its expiring lease while
    /// other users continue; cancellation never marks an unfinished day complete.
    #[tracing::instrument(skip_all, err)]
    pub async fn refresh_pending(&self) -> Result<()> {
        let yesterday = Utc::now().date_naive() - Duration::days(1);
        for _ in 0..25 {
            let Some(claim) = self.repo.claim_refresh(yesterday).await? else {
                break;
            };
            let span = tracing::info_span!("memory.refresh_claim", lease_token = %claim.token, date = %claim.date);
            async {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(1200),
                    self.refresh(claim.user.clone(), claim.date),
                )
                .await
                {
                    Ok(Ok(())) => self.repo.release_refresh(&claim).await?,
                    Ok(Err(error)) => {
                        tracing::warn!(error = ?error, "memory refresh failed; lease will expire")
                    }
                    Err(_) => tracing::warn!("memory refresh timed out; lease will expire"),
                }
                Ok::<(), MemoryError>(())
            }
            .instrument(span)
            .await?;
        }
        Ok(())
    }

    async fn report(
        &self,
        user: MacroUserIdStr<'static>,
        granularity: Granularity,
        start: NaiveDate,
        end: NaiveDate,
        sources: &[Activity],
    ) -> Result<Activity> {
        let instructions = format!(
            include_str!("service/prompts/rollup.md"),
            granularity = granularity,
            start = start,
            end = end
        );
        let content = self
            .generator
            .summarize(user.clone(), &instructions, &render_activity(sources))
            .await?;
        self.generator.judge(user, &content).await?;
        Ok(Activity {
            granularity,
            period_start: start,
            period_end: end,
            content,
        })
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
