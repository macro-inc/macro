//! Offline proof over the provider rehearsal's in-memory journal.

use std::collections::HashMap;

use ai_usage::financial::UsageEvidence;
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{AiFeature, JobKey, Journal, run_id};

mod test;

/// Synthetic current authorization facts supplied by the fixture.
enum Viewer {
    Human { owned_team: Option<Uuid> },
    Program,
}

#[derive(Debug, PartialEq, Eq)]
enum ReadError {
    Denied,
    InvalidWindow,
    Unavailable,
    InconsistentJournal,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Coverage {
    /// Subtotal from complete reports, including an explicitly measured zero.
    reported_tokens: Option<u128>,
    pending: usize,
    missing: usize,
}

impl Coverage {
    fn record(&mut self, evidence: Option<UsageEvidence>) {
        match evidence {
            None => self.pending += 1,
            Some(UsageEvidence::Missing(_)) => self.missing += 1,
            Some(UsageEvidence::Reported(usage)) => {
                let tokens = [
                    usage.input(),
                    usage.output(),
                    usage.cache_read(),
                    usage.cache_write(),
                    usage.reasoning(),
                ];
                *self.reported_tokens.get_or_insert(0) +=
                    tokens.into_iter().map(u128::from).sum::<u128>();
            }
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Report {
    team: Coverage,
    agents: HashMap<MacroUserIdStr<'static>, Coverage>,
}

fn read_day<'a>(
    viewer: Viewer,
    team_id: Uuid,
    day: NaiveDate,
    zone: Tz,
    read: impl FnOnce(Uuid) -> Option<(&'a [JobKey], &'a Journal)>,
) -> Result<Report, ReadError> {
    if !matches!(viewer, Viewer::Human { owned_team: Some(team) } if team == team_id) {
        return Err(ReadError::Denied);
    }

    let midnight = |day: NaiveDate| -> Result<DateTime<Utc>, ReadError> {
        zone.from_local_datetime(&day.and_time(NaiveTime::MIN))
            .single()
            .map(|time| time.with_timezone(&Utc))
            .ok_or(ReadError::InvalidWindow)
    };
    let start = midnight(day)?;
    let end = midnight(day.succ_opt().ok_or(ReadError::InvalidWindow)?)?;
    let (jobs, journal) = read(team_id).ok_or(ReadError::Unavailable)?;
    let team_runs: HashMap<_, _> = jobs
        .iter()
        .filter(|job| job.scope.team_id == team_id)
        .map(|job| (run_id(job), job))
        .collect();

    let begins = journal.begins.lock().expect("observation begins");
    let finals = journal.finals.lock().expect("observation finals");
    let mut report = Report::default();

    // One journal row per invocation. The logical run can contain several attempts.
    for (id, attempt) in begins.iter() {
        if !(start..end).contains(&attempt.occurred_at)
            || attempt.feature != AiFeature::AgentSession
        {
            continue;
        }
        let Some(job) = team_runs.get(&attempt.run_id) else {
            continue;
        };
        if attempt.entity != Some(job.id) || attempt.user != job.scope.user_id {
            continue;
        }

        let finalization = finals.get(id);
        if attempt.invocation_id != *id
            || finalization.is_some_and(|value| value.invocation_id != *id)
        {
            return Err(ReadError::InconsistentJournal);
        }

        let evidence = finalization.map(|value| value.usage);
        report.team.record(evidence);
        report
            .agents
            .entry(attempt.user.clone())
            .or_default()
            .record(evidence);
    }

    Ok(report)
}
