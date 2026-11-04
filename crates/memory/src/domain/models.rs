//! Persisted memory components and calendar periods.
use super::ports::{MemoryError, Result};
use chrono::{Datelike, Duration, NaiveDate};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumString};

/// Fixed calendar granularity, always in UTC, with Monday-start weeks.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    JsonSchema,
    AsRefStr,
    Display,
    EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Granularity {
    Day,
    Week,
    Month,
    Summary,
}

/// A privacy-reviewed activity report; period_end is inclusive.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub granularity: Granularity,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub content: String,
}

/// A private explicit memory document and its optimistic concurrency token.
#[derive(Debug, Clone, Default, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExplicitMemory {
    pub content: String,
    pub revision: i64,
}

/// An edit to one one-based line. A revision is required to prevent replay
/// or concurrent edits from inserting twice or deleting a different line.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum MemoryEdit {
    Insert { line: usize, content: String },
    Replace { line: usize, content: String },
    Delete { line: usize },
}

impl MemoryEdit {
    /// Apply an edit without truncation or silently accepting an invalid line.
    pub fn apply(&self, memory: &str) -> Result<String> {
        let mut lines: Vec<_> = memory.lines().map(str::to_owned).collect();
        let (line, content, insert) = match self {
            Self::Insert { line, content } => (*line, Some(content), true),
            Self::Replace { line, content } => (*line, Some(content), false),
            Self::Delete { line } => (*line, None, false),
        };
        let index = line.checked_sub(1).ok_or(MemoryError::InvalidLine)?;
        if index > lines.len() || (!insert && index == lines.len()) {
            return Err(MemoryError::InvalidLine);
        }
        if let Some(content) = content {
            if content.trim().is_empty() || content.contains(['\n', '\r']) {
                return Err(MemoryError::InvalidContent);
            }
            if insert {
                lines.insert(index, content.clone());
            } else {
                lines[index] = content.clone();
            }
        } else {
            lines.remove(index);
        }
        let result = lines.join("\n");
        if result.len() > 32_000 {
            return Err(MemoryError::InvalidContent);
        }
        Ok(result)
    }
}

/// Start of a calendar period containing date.
pub fn period_start(date: NaiveDate, granularity: Granularity) -> NaiveDate {
    match granularity {
        Granularity::Day | Granularity::Summary => date,
        Granularity::Week => {
            date - Duration::days(i64::from(date.weekday().num_days_from_monday()))
        }
        Granularity::Month => date - Duration::days(i64::from(date.day0())),
    }
}

/// Select whole weeks inside the month, and daily rows for partial weeks.
/// This never feeds activity from a neighbouring month or counts a day twice.
pub fn monthly_sources(rows: &[Activity], date: NaiveDate) -> Vec<Activity> {
    let start = period_start(date, Granularity::Month);
    let weeks: Vec<_> = rows
        .iter()
        .filter(|r| {
            r.granularity == Granularity::Week
                && r.period_start >= start
                && r.period_end <= date
                && r.period_end - r.period_start == Duration::days(6)
        })
        .cloned()
        .collect();
    let days = rows.iter().filter(|r| {
        r.granularity == Granularity::Day
            && r.period_start >= start
            && r.period_end <= date
            && !weeks
                .iter()
                .any(|w| r.period_start >= w.period_start && r.period_end <= w.period_end)
    });
    let mut sources = weeks.clone();
    sources.extend(days.cloned());
    sources.sort_by_key(|r| r.period_start);
    sources
}

#[cfg(test)]
mod test;
