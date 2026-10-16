//! In-memory calendar range projection used by engine tests.

use super::InMemoryStorage;
use crate::calendar::{
    CALENDAR_TYPENAME, CalendarCommit, CalendarCommitOutcome, CalendarRangeRequest,
    CalendarRangeSnapshot, CalendarRangeStorage, EVENT_TYPENAME, OCCURRENCE_TYPENAME, merge_spans,
    next_sync_state,
};
use crate::value::{CacheValue, EntityKey};
use std::collections::BTreeSet;

impl CalendarRangeStorage for InMemoryStorage {
    async fn query_calendar_ranges(
        &self,
        request: &CalendarRangeRequest,
    ) -> Result<CalendarRangeSnapshot, Self::Error> {
        let spans = request.spans();
        Ok(CalendarRangeSnapshot {
            rows: self
                .calendar_ranges
                .values()
                .filter(|row| request.includes(row))
                .cloned()
                .collect(),
            coverage: self
                .calendar_coverage
                .iter()
                .filter(|covered| {
                    spans.iter().any(|span| {
                        covered.kind == span.kind
                            && covered.start <= span.end
                            && covered.end >= span.start
                    })
                })
                .copied()
                .collect(),
            sync: self.calendar_sync.clone(),
        })
    }

    async fn calendar_commit(
        &mut self,
        commit: &CalendarCommit,
    ) -> Result<CalendarCommitOutcome, Self::Error> {
        let mut deleted = BTreeSet::new();
        if commit.reset {
            deleted.extend(
                self.records
                    .keys()
                    .filter(|key| {
                        matches!(key.typename(), Some(OCCURRENCE_TYPENAME | EVENT_TYPENAME))
                    })
                    .cloned(),
            );
            self.calendar_coverage.clear();
        }
        for event in &commit.replaced_events {
            let current = event.occurrence_keys.iter().collect::<BTreeSet<_>>();
            deleted.extend(
                self.calendar_ranges
                    .values()
                    .filter(|row| {
                        row.event_key == event.event_key && !current.contains(&row.record_key)
                    })
                    .map(|row| row.record_key.clone()),
            );
        }
        for event_key in &commit.deleted_event_keys {
            deleted.insert(event_key.clone());
            deleted.extend(
                self.calendar_ranges
                    .values()
                    .filter(|row| row.event_key == *event_key)
                    .map(|row| row.record_key.clone()),
            );
        }
        deleted.extend(commit.deleted_calendar_keys.iter().cloned());
        if !commit.removed_link_ids.is_empty() {
            let removed = commit
                .removed_link_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            deleted.extend(
                self.calendar_ranges
                    .values()
                    .filter(|row| removed.contains(row.link_id.as_str()))
                    .map(|row| row.record_key.clone()),
            );
            deleted.extend(
                self.records
                    .iter()
                    .filter(|(key, record)| {
                        matches!(key.typename(), Some(EVENT_TYPENAME | CALENDAR_TYPENAME))
                            && matches!(
                                record.fields.get("linkId"),
                                Some(CacheValue::String(link_id)) if removed.contains(link_id.as_str())
                            )
                    })
                    .map(|(key, _)| key.clone()),
            );
        }
        let deleted_keys = deleted
            .into_iter()
            .filter(|key| self.records.contains_key(key))
            .collect::<Vec<EntityKey<'static>>>();
        for key in &deleted_keys {
            self.remove_record(key);
        }
        self.calendar_coverage = merge_spans(
            self.calendar_coverage
                .iter()
                .chain(&commit.coverage)
                .copied(),
        );
        self.calendar_sync = next_sync_state(&self.calendar_sync, commit);
        Ok(CalendarCommitOutcome { deleted_keys })
    }
}
