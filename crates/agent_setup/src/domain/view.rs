//! Reading the import ledger the way setup talks about it: one person's rows
//! for one source, counted, titled and referenced.

#[cfg(test)]
mod test;

use import::domain::models::{ImportEntity, ImportRun, ImportSource, ImportState, ImportStatus};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use super::models::{Candidate, CandidateGroup};

/// Hex characters of a candidate id used as its ref. Collisions inside one
/// person's handful of candidates are vanishingly unlikely; `resolve_ref`
/// still refuses an ambiguous one.
pub const REF_LEN: usize = 8;

/// The longest failure reason passed on, so a raw upstream error never
/// floods a result.
const MAX_REASON_LEN: usize = 200;

/// One source's run and the person's own rows.
#[derive(Debug, Clone)]
pub struct SourceView<'a> {
    /// The source.
    pub source: ImportSource,
    /// Its run, if one ever started.
    pub run: Option<&'a ImportRun>,
    /// The person's own rows (teammates' imports are not this setup's).
    pub rows: Vec<&'a ImportEntity>,
}

/// Row counts for a source.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    /// Staged, never failed: waiting for the plan.
    pub candidates: u32,
    /// Being copied in.
    pub importing: u32,
    /// In Macro.
    pub imported: u32,
    /// Staged after a failed import.
    pub failed: u32,
}

impl<'a> SourceView<'a> {
    /// The view of `source` in `state` for `user`.
    pub fn of(
        state: &'a ImportState,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Self {
        Self {
            source,
            run: state.runs.iter().find(|run| run.source == source),
            rows: state
                .entities
                .iter()
                .filter(|row| row.source == source && row.user_id.as_str() == user.as_ref())
                .collect(),
        }
    }

    /// Row counts.
    pub fn counts(&self) -> Counts {
        let mut counts = Counts::default();
        for row in &self.rows {
            match row.status {
                ImportStatus::Staged if row.last_error.is_some() => counts.failed += 1,
                ImportStatus::Staged => counts.candidates += 1,
                ImportStatus::Importing => counts.importing += 1,
                ImportStatus::Imported => counts.imported += 1,
                ImportStatus::Discarded => {}
            }
        }
        counts
    }

    /// Rows that can still be brought in: staged, including failed ones.
    pub fn staged(&self) -> impl Iterator<Item = &&'a ImportEntity> {
        self.rows
            .iter()
            .filter(|row| row.status == ImportStatus::Staged)
    }

    /// The candidates waiting for the plan, as the agent sees them.
    pub fn candidates(&self) -> Vec<Candidate> {
        let mut candidates: Vec<Candidate> = self
            .staged()
            .map(|row| Candidate {
                reference: reference(row),
                title: title(row),
                detail: detail(row),
            })
            .collect();
        candidates.sort_by(|a, b| a.title.cmp(&b.title));
        candidates
    }

    /// Candidates by area, for sources that have areas.
    pub fn groups(&self) -> Vec<CandidateGroup> {
        let mut groups: Vec<CandidateGroup> = Vec::new();
        for row in self.staged() {
            let Some(label) = area(row) else { continue };
            match groups.iter_mut().find(|group| group.label == label) {
                Some(group) => group.count += 1,
                None => groups.push(CandidateGroup { label, count: 1 }),
            }
        }
        groups.sort_by(|a, b| b.count.cmp(&a.count).then(a.label.cmp(&b.label)));
        groups
    }
}

/// A row's short reference.
pub fn reference(row: &ImportEntity) -> String {
    row.id.simple().to_string()[..REF_LEN].to_owned()
}

fn text<'v>(metadata: &'v Value, key: &str) -> Option<&'v str> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// A row's title as a person would recognize it.
pub fn title(row: &ImportEntity) -> String {
    let metadata = &row.metadata;
    match row.source {
        ImportSource::Linear => match (text(metadata, "identifier"), text(metadata, "title")) {
            (Some(identifier), Some(title)) => format!("{identifier} {title}"),
            (None, Some(title)) => title.to_owned(),
            (Some(identifier), None) => identifier.to_owned(),
            (None, None) => "Untitled issue".to_owned(),
        },
        ImportSource::Notion => text(metadata, "title")
            .unwrap_or("Untitled page")
            .to_owned(),
        ImportSource::Slack => text(metadata, "name")
            .map(|name| format!("#{}", name.trim_start_matches('#')))
            .unwrap_or_else(|| "Unnamed channel".to_owned()),
    }
}

/// The area a row belongs to: a Linear team key, or nothing.
fn area(row: &ImportEntity) -> Option<String> {
    match row.source {
        ImportSource::Linear => text(&row.metadata, "identifier")
            .and_then(|identifier| identifier.split_once('-'))
            .map(|(team, _)| team.to_owned()),
        ImportSource::Notion | ImportSource::Slack => None,
    }
}

/// A short, content-free description of a row.
fn detail(row: &ImportEntity) -> Option<String> {
    let metadata = &row.metadata;
    let mut parts: Vec<String> = Vec::new();
    match row.source {
        ImportSource::Linear => {
            parts.extend(area(row));
            parts.extend(text(metadata, "status").map(str::to_owned));
            parts.extend(text(metadata, "assignee").map(str::to_owned));
        }
        ImportSource::Slack => {
            if let Some(members) = metadata.get("member_count").and_then(Value::as_u64) {
                parts.push(format!("{members} members"));
            }
            if metadata.get("archived").and_then(Value::as_bool) == Some(true) {
                parts.push("archived".to_owned());
            }
        }
        ImportSource::Notion => {}
    }
    if let Some(error) = &row.last_error {
        parts.push(format!("failed before: {}", reason(error)));
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

/// A failure reason, trimmed for an agent.
pub fn reason(error: &str) -> String {
    let error = error.trim();
    if error.chars().count() <= MAX_REASON_LEN {
        return error.to_owned();
    }
    let cut: String = error.chars().take(MAX_REASON_LEN).collect();
    format!("{cut}…")
}

/// The run's error, if it failed.
pub fn run_error(run: Option<&ImportRun>) -> Option<String> {
    run.and_then(|run| run.error.as_deref()).map(reason)
}
