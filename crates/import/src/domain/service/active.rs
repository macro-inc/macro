//! Which newly imported items surface on Home: the ones the user is
//! actively working on, judged inside Home's own two-week window.
//!
//! Neither Notion nor Linear exposes "last viewed", so only edits and
//! workflow state count.

use chrono::{DateTime, Duration, Utc};

use crate::domain::models::{
    ImportEntity, ImportSource, ImportStatus, LinearIssueMeta, LinearStateType, NotionDocMeta,
};

#[cfg(test)]
mod test;

/// Home lists items changed within this window.
const ACTIVE_WINDOW: Duration = Duration::days(14);
/// At most this many items per import run (a run imports one source).
const MAX_PER_RUN: usize = 10;

/// An imported item to surface on Home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveImport {
    /// The source system.
    pub source: ImportSource,
    /// The Macro entity it became (a document or task id).
    pub entity_id: String,
    /// Its name.
    pub name: String,
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|time| time.to_utc())
}

/// When the item last changed, if it counts as active work.
fn active_since(row: &ImportEntity, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let recent = |time: Option<DateTime<Utc>>| time.filter(|time| now - *time <= ACTIVE_WINDOW);
    match row.source {
        ImportSource::Notion => {
            let meta: NotionDocMeta = serde_json::from_value(row.metadata.clone()).ok()?;
            let edited = parse_time(meta.last_edited_time.as_deref());
            match meta.edited_by_user {
                // The connection belongs to a person: only their own edits.
                Some(true) => recent(edited),
                Some(false) => None,
                // The connection's owner is not a person: any recent edit.
                None => recent(edited),
            }
        }
        ImportSource::Linear => {
            let meta: LinearIssueMeta = serde_json::from_value(row.metadata.clone()).ok()?;
            let updated = parse_time(meta.updated_at.as_deref());
            if meta.state_type == Some(LinearStateType::Started) {
                // In progress counts however long ago it last changed.
                Some(updated.unwrap_or(now))
            } else {
                recent(updated)
            }
        }
        ImportSource::Slack => None,
    }
}

/// The items of one import run to surface on Home: rows the run itself
/// imported that are active work, most recent first, at most ten.
pub(crate) fn select_active_imports(
    rows: &[ImportEntity],
    now: DateTime<Utc>,
) -> Vec<ActiveImport> {
    let mut candidates: Vec<(DateTime<Utc>, &ImportEntity)> = rows
        .iter()
        .filter(|row| row.status == ImportStatus::Imported && row.entity_id.is_some())
        .filter_map(|row| Some((active_since(row, now)?, row)))
        .collect();
    candidates.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.foreign_id.cmp(&b.1.foreign_id))
    });
    candidates
        .into_iter()
        .take(MAX_PER_RUN)
        .map(|(_, row)| ActiveImport {
            source: row.source,
            entity_id: row.entity_id.clone().expect("filtered on entity_id"),
            name: item_name(row),
        })
        .collect()
}

fn item_name(row: &ImportEntity) -> String {
    match row.source {
        ImportSource::Notion => serde_json::from_value::<NotionDocMeta>(row.metadata.clone())
            .map(|meta| super::notion::document_name(&meta.title, meta.icon_emoji.as_deref()))
            .unwrap_or_else(|_| "Untitled".to_string()),
        _ => crate::domain::models::metadata_label(row.source, &row.metadata),
    }
}
