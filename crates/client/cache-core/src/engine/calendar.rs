//! Local calendar range reads and commits.

use super::{Engine, EngineError, WriteResult, effective_records, layer_keys};
use crate::calendar::{
    CalendarCommit, CalendarRangeRequest, CalendarRangeResult, CalendarRangeRow,
    CalendarRangeStorage, OCCURRENCE_TYPENAME, compose_calendar_rows, coverage_gaps,
    project_calendar_range,
};
use crate::revision::Revisioned;
use crate::value::EntityKey;
use std::collections::{BTreeSet, HashMap};

impl<S: CalendarRangeStorage> Engine<S> {
    /// Answers a viewport from cached occurrences.
    ///
    /// Authoritative rows come from the storage range index. Occurrences
    /// touched by an active optimistic layer are projected from their composed
    /// records and replace their authoritative rows, so an optimistic move,
    /// delete, or create is visible before the mutation settles.
    pub async fn calendar_range(
        &mut self,
        request: &CalendarRangeRequest,
    ) -> Result<Revisioned<CalendarRangeResult>, EngineError<S::Error>> {
        request.validate()?;
        self.hydrate_optimistic().await?;
        let snapshot = self
            .storage
            .query_calendar_ranges(request)
            .await
            .map_err(EngineError::Storage)?;
        let overlay = self.optimistic_calendar_overlay().await?;
        let (occurrence_keys, overlaid) = compose_calendar_rows(request, snapshot.rows, &overlay);
        let uncertain_event_keys = self
            .optimistic
            .iter()
            .flat_map(|layer| layer.uncertain_calendar_event_keys.iter().cloned())
            .filter(|key| {
                request
                    .event_key
                    .as_ref()
                    .is_none_or(|event_key| event_key == key)
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let gaps = request
            .spans()
            .into_iter()
            .flat_map(|span| coverage_gaps(&snapshot.coverage, span))
            .collect();
        Ok(self.revisioned(CalendarRangeResult {
            occurrence_keys,
            gaps,
            freshness: snapshot.sync.freshness,
            optimistic: overlaid || !uncertain_event_keys.is_empty(),
            uncertain_event_keys,
            watermark: snapshot.sync.watermark,
        }))
    }

    async fn optimistic_calendar_overlay(
        &mut self,
    ) -> Result<HashMap<EntityKey<'static>, Option<CalendarRangeRow>>, EngineError<S::Error>> {
        let keys = layer_keys(&self.optimistic)
            .into_iter()
            .filter(|key| key.typename() == Some(OCCURRENCE_TYPENAME))
            .collect::<BTreeSet<_>>();
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let bases = self.load_bases(&keys).await?;
        Ok(effective_records(&bases, &self.optimistic, &keys)
            .into_iter()
            .map(|(key, record)| {
                let row = record.and_then(|record| project_calendar_range(&key, &record));
                (key, row)
            })
            .collect())
    }

    /// Atomically applies coverage, occurrence-set replacements, deletions,
    /// and sync state. Records the commit deletes are evicted and reported as
    /// changed so dependent operations re-execute.
    pub async fn calendar_commit(
        &mut self,
        commit: &CalendarCommit,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        commit.validate()?;
        self.ensure_revision_can_advance()?;
        let outcome = self
            .storage
            .calendar_commit(commit)
            .await
            .map_err(EngineError::Storage)?;
        let changed = outcome.deleted_keys.into_iter().collect::<BTreeSet<_>>();
        for key in &changed {
            self.hot.pop(key);
        }
        let affected_ops = self.deps.ops_for_keys(changed.iter());
        let revision = self.advance_revision()?;
        Ok(WriteResult {
            identity_errors: Vec::new(),
            revision,
            revision_advanced: true,
            search_changed_buckets: Some(BTreeSet::new()),
            changed,
            affected_ops,
            reset: false,
            revalidations: Vec::new(),
            mutation_uuid: None,
        })
    }
}
