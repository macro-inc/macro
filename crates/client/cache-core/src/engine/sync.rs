//! Applying streamed sync frames: each applied frame is at most one engine
//! write, so hosts can queue every frame behind foreground reads.

use super::{Engine, EngineError, HydrationWriteResult, IdentityState, WriteResult, live_query};
use crate::calendar::{CalendarCommit, CalendarRangeStorage, CalendarWatermarkUpdate};
use crate::deps::OpId;
use crate::document::{Document, DocumentError, Operation, OperationKind};
use crate::normalize::RecordUpdates;
use crate::predicate::{PredicateIndexStorage, ProjectionMutation};
use crate::revision::Revisioned;
use crate::search::{collect_search_changes, snapshot_search_fields};
use crate::store::{Storage, SyncStorage};
use crate::sync::{
    LaneProgress, StoredSyncLane, SyncEndReason, SyncFrame, SyncLaneDoneReason, SyncLaneKind,
    SyncLanePlan, SyncLaneRow, SyncLaneState, SyncPageResponse, SyncRun, SyncStreamError,
    item_keys, lowest_watermark, page_items, page_watermark,
};
use crate::value::EntityKey;
use maybe_send::MaybeSend;
use serde_json::{Map, Value as Json};
use std::collections::{BTreeSet, HashMap};
use std::convert::Infallible;
use thiserror::Error;

/// Stale members deleted per storage transaction, bounding each write.
const DELETE_CHUNK: usize = 1_000;

/// Inputs of one page write, for host projection composition.
#[derive(Clone, Copy, Debug)]
pub struct SyncPageWrite<'a> {
    /// Lane query.
    pub query: &'a str,
    /// Lane operation name.
    pub operation_name: Option<&'a str>,
    /// Variables the server executed for this page.
    pub variables: &'a Map<String, Json>,
    /// Page `data`.
    pub data: &'a Json,
    /// `data.user.id`, the write's session identity.
    pub identity: Option<&'a str>,
    /// The lane's operation, parsed once per run.
    pub operation: &'a Operation,
    /// The page normalized once (`normalize` of the lane query, variables and
    /// data), for hosts whose projections read the normalized records.
    pub updates: &'a RecordUpdates,
}

/// What a sync run needs from its host's composition edge: the same
/// projection composition the host uses for ordinary hydration and server
/// deletions, and clocks. The engine itself stays I/O-free.
pub trait SyncHooks<S: Storage> {
    /// Projection composition failure.
    type Error: std::error::Error + 'static;

    /// Projection mutations written atomically with a hydrated page.
    fn page_projections(
        &self,
        engine: &mut Engine<S>,
        page: SyncPageWrite<'_>,
    ) -> impl Future<Output = Result<Vec<ProjectionMutation>, Self::Error>> + MaybeSend;

    /// Projection mutations for records a membership lane deletes, as for a
    /// server cache deletion.
    fn deletion_projections(
        &self,
        engine: &mut Engine<S>,
        keys: &[EntityKey<'static>],
    ) -> impl Future<Output = Result<Vec<ProjectionMutation>, Self::Error>> + MaybeSend;

    /// Monotonic milliseconds, for write timing.
    fn monotonic_ms(&self) -> f64;

    /// Unix milliseconds, for `completedAt`.
    fn wall_clock_ms(&self) -> i64;
}

/// Failure while applying a frame.
#[derive(Debug, Error)]
pub enum SyncWriteError<E: std::error::Error + 'static, H: std::error::Error + 'static> {
    /// The stream or saved state breaks the contract, or a lane failed.
    #[error(transparent)]
    Stream(#[from] SyncStreamError),
    /// The cache write failed.
    #[error("{0}")]
    Engine(#[source] EngineError<E>),
    /// The host's projection composition failed.
    #[error("{0}")]
    Hooks(#[source] H),
}

/// What one applied frame changed, for host fan-out.
#[derive(Debug)]
pub enum SyncApplied {
    /// A page was written through background hydration; publish like a hydrate.
    Hydrated {
        /// Lane id.
        lane: String,
        /// The hydration write.
        result: HydrationWriteResult,
    },
    /// A membership lane deleted records the server no longer lists; publish
    /// like a server cache deletion.
    Deleted {
        /// Lane id.
        lane: String,
        /// Deleted record keys.
        keys: Vec<EntityKey<'static>>,
        /// Revision after the last deletion and the operations that read the keys.
        affected: Revisioned<BTreeSet<OpId>>,
    },
    /// A calendar lane committed its window; publish like a calendar commit.
    CalendarCommitted {
        /// Lane id.
        lane: String,
        /// The commit's write result.
        result: WriteResult,
    },
    /// The frame changed no cached records (sync state only, or nothing).
    Recorded,
}

/// One decoded page frame.
struct SyncPageFrame {
    variables: Map<String, Json>,
    response: SyncPageResponse,
    next_variables: Option<Map<String, Json>>,
}

/// How [`Engine::sync_write_page`] handled a page.
enum SyncPageWritten<F> {
    /// Written with its lane state in one transaction.
    Written(HydrationWriteResult),
    /// An identity change or pending optimistic layers: the general network
    /// write must compose it. Nothing was written.
    NeedsNetworkWrite {
        projections: Vec<ProjectionMutation>,
        advance: F,
    },
}

impl<S: SyncStorage> Engine<S> {
    /// Saved state of every lane that has run against this database.
    pub async fn sync_lane_states(
        &self,
    ) -> Result<Vec<SyncLaneState>, SyncWriteError<S::Error, Infallible>> {
        self.storage
            .load_sync_lanes()
            .await
            .map_err(|error| SyncWriteError::Engine(EngineError::Storage(error)))?
            .iter()
            .map(|row| Ok(StoredSyncLane::decode(row)?.state))
            .collect()
    }
}

impl<S> Engine<S>
where
    S: SyncStorage + CalendarRangeStorage + PredicateIndexStorage,
{
    /// Applies the oldest decoded frame of `run`; `None` when none is pending.
    ///
    /// Hydrate and calendar pages are one hydration write each, followed by
    /// the lane's saved state (and, for hydrate lanes, its new members).
    /// Membership pages only collect keys. `laneDone` completes the lane;
    /// a completed membership listing deletes unlisted members of its scopes,
    /// and a calendar lane commits its coverage with the lowest watermark.
    pub async fn sync_apply_next<H: SyncHooks<S>>(
        &mut self,
        run: &mut SyncRun,
        hooks: &H,
    ) -> Result<Option<SyncApplied>, SyncWriteError<S::Error, H::Error>> {
        let Some(frame) = run.pending.pop_front() else {
            return Ok(None);
        };
        if run.end.is_some() {
            return Err(stream("frame after the end frame"));
        }
        let applied = match frame {
            SyncFrame::Page {
                lane,
                variables,
                response,
                next_variables,
                ..
            } => {
                let page = SyncPageFrame {
                    variables,
                    response,
                    next_variables,
                };
                self.sync_page(run, hooks, &lane, page).await?
            }
            SyncFrame::LaneDone { lane, reason, .. } => {
                self.sync_lane_done(run, hooks, &lane, reason).await?
            }
            SyncFrame::LaneError { lane, message } => {
                sync_lane_error::<S::Error, H::Error>(run, &lane, message)?
            }
            SyncFrame::End { reason } => {
                run.end = Some(reason);
                if reason == SyncEndReason::Error {
                    return Err(stream("stream ended with an error"));
                }
                SyncApplied::Recorded
            }
        };
        Ok(Some(applied))
    }

    async fn sync_page<H: SyncHooks<S>>(
        &mut self,
        run: &mut SyncRun,
        hooks: &H,
        lane_id: &str,
        frame: SyncPageFrame,
    ) -> Result<SyncApplied, SyncWriteError<S::Error, H::Error>> {
        let SyncPageFrame {
            variables,
            response,
            next_variables,
        } = frame;
        let lane = run.lane(lane_id)?.clone();
        let progress = lane_progress(run, lane_id);
        if progress.done {
            return Err(stream(format!(
                "lane `{lane_id}` sent a page after laneDone"
            )));
        }
        if progress.error.is_some() {
            return Err(stream(format!(
                "lane `{lane_id}` sent a page after it failed"
            )));
        }
        if response
            .errors
            .as_ref()
            .is_some_and(|errors| !errors.is_empty())
        {
            return Ok(refuse_page(run, lane_id, "returned GraphQL errors"));
        }
        let Some(data) = response.data else {
            return Ok(refuse_page(run, lane_id, "has no data"));
        };
        let Some(items) = page_items(&data, lane.paging) else {
            return Ok(refuse_page(run, lane_id, "lacks its paging fields"));
        };
        let item_count = items.len() as u64;
        // Calendar lanes record no members, so only they may omit item ids.
        let keys = match lane.kind {
            SyncLaneKind::Calendar { .. } => Vec::new(),
            _ => item_keys(items)?,
        };

        if matches!(lane.kind, SyncLaneKind::Membership { .. }) {
            let progress = lane_progress(run, lane_id);
            progress.pages += 1;
            progress.items += item_count;
            progress.listed.extend(keys);
            return Ok(SyncApplied::Recorded);
        }

        let watermark = match lane.kind {
            SyncLaneKind::Calendar { .. } => page_watermark(&data)?,
            _ => Vec::new(),
        };
        let started = hooks.monotonic_ms();
        let identity = data
            .get("user")
            .and_then(|user| user.get("id"))
            .and_then(Json::as_str)
            .map(str::to_owned);
        let operation = lane_operation::<S::Error, H::Error>(run, &lane)?;
        let updates = crate::normalize::normalize(&self.schema, &operation, &variables, &data)
            .map_err(engine_error)?;
        let page = SyncPageWrite {
            query: &lane.query,
            operation_name: lane.operation_name.as_deref(),
            variables: &variables,
            data: &data,
            identity: identity.as_deref(),
            operation: &operation,
            updates: &updates,
        };
        let projections = hooks
            .page_projections(self, page)
            .await
            .map_err(SyncWriteError::Hooks)?;
        // The lane's saved state after this page.
        let advance = |mut stored: StoredSyncLane| {
            stored.state.pages += 1;
            stored.state.items += item_count;
            // The server sends `null` whenever no further page of the lane follows
            // in this stream (done, capped, or failed). Only `laneDone` clears the
            // resume point, so an interrupted pass resumes from its last good page.
            if next_variables.is_some() {
                stored.state.next_variables = next_variables.clone();
            }
            let members = match lane.kind {
                SyncLaneKind::Hydrate => keys.clone(),
                _ => {
                    stored.pending_watermark = lowest_watermark([
                        stored.pending_watermark.as_slice(),
                        watermark.as_slice(),
                    ]);
                    Vec::new()
                }
            };
            (stored.encode(), members)
        };
        let result = match self
            .sync_write_page(identity.as_deref(), updates, projections, &lane, advance)
            .await?
        {
            SyncPageWritten::Written(result) => result,
            SyncPageWritten::NeedsNetworkWrite {
                projections,
                advance,
            } => {
                // An identity change or pending optimistic layers: the general
                // network write handles both, then the lane state follows.
                let result = self
                    .hydrate_query_with_projections(
                        &lane.query,
                        lane.operation_name.as_deref(),
                        &variables,
                        &data,
                        identity.as_deref(),
                        projections,
                    )
                    .await
                    .map_err(SyncWriteError::Engine)?;
                let (row, members) = advance(self.stored_lane::<H::Error>(&lane).await?);
                self.storage
                    .save_sync_lane(row, members)
                    .await
                    .map_err(storage_error)?;
                result
            }
        };

        let progress = lane_progress(run, lane_id);
        progress.pages += 1;
        progress.items += item_count;
        progress.write_ms += hooks.monotonic_ms() - started;
        Ok(SyncApplied::Hydrated {
            lane: lane.id,
            result,
        })
    }

    async fn sync_lane_done<H: SyncHooks<S>>(
        &mut self,
        run: &mut SyncRun,
        hooks: &H,
        lane_id: &str,
        reason: SyncLaneDoneReason,
    ) -> Result<SyncApplied, SyncWriteError<S::Error, H::Error>> {
        let lane = run.lane(lane_id)?.clone();
        let progress = lane_progress(run, lane_id);
        if progress.done {
            return Err(stream(format!("lane `{lane_id}` finished twice")));
        }
        if progress.error.is_some() {
            return Err(stream(format!(
                "lane `{lane_id}` sent laneDone after it failed"
            )));
        }
        let started = hooks.monotonic_ms();
        let mut stored = self.stored_lane::<H::Error>(&lane).await?;
        let applied = match &lane.kind {
            SyncLaneKind::Hydrate => SyncApplied::Recorded,
            SyncLaneKind::Membership { scopes } => {
                // Membership lanes run whole every time and save no resume point.
                let progress = lane_progress(run, lane_id);
                stored.state.pages = progress.pages;
                stored.state.items = progress.items;
                let listed = std::mem::take(&mut progress.listed);
                if reason == SyncLaneDoneReason::Complete {
                    self.delete_unlisted(hooks, &lane.id, scopes, &listed)
                        .await?
                } else {
                    SyncApplied::Recorded
                }
            }
            SyncLaneKind::Calendar { coverage } => {
                let links = std::mem::take(&mut stored.pending_watermark);
                let commit = CalendarCommit {
                    coverage: coverage.clone(),
                    watermark: (!links.is_empty())
                        .then_some(CalendarWatermarkUpdate::Merge { links }),
                    ..CalendarCommit::default()
                };
                let result = self
                    .calendar_commit(&commit)
                    .await
                    .map_err(SyncWriteError::Engine)?;
                SyncApplied::CalendarCommitted {
                    lane: lane.id.clone(),
                    result,
                }
            }
        };
        stored.state.completed_at = iso_time(hooks.wall_clock_ms());
        stored.state.watermark = Some(lane.pass_started_at.clone());
        stored.state.coverage = lane.coverage.clone().unwrap_or(Json::Null);
        stored.state.next_variables = None;
        self.storage
            .save_sync_lane(stored.encode(), Vec::new())
            .await
            .map_err(storage_error)?;
        let progress = lane_progress(run, lane_id);
        progress.done = true;
        progress.write_ms += hooks.monotonic_ms() - started;
        Ok(applied)
    }

    /// Deletes members of `scopes` the listing did not include, as server
    /// cache deletions, then drops them from those lanes' members.
    async fn delete_unlisted<H: SyncHooks<S>>(
        &mut self,
        hooks: &H,
        lane_id: &str,
        scopes: &[String],
        listed: &BTreeSet<EntityKey<'static>>,
    ) -> Result<SyncApplied, SyncWriteError<S::Error, H::Error>> {
        let stale = self
            .storage
            .load_sync_members(scopes)
            .await
            .map_err(storage_error)?
            .into_iter()
            .filter(|key| !listed.contains(key))
            .collect::<Vec<_>>();
        if stale.is_empty() {
            return Ok(SyncApplied::Recorded);
        }
        let mut affected = Revisioned {
            revision: self.revision,
            value: BTreeSet::new(),
        };
        for chunk in stale.chunks(DELETE_CHUNK) {
            let projections = hooks
                .deletion_projections(self, chunk)
                .await
                .map_err(SyncWriteError::Hooks)?;
            let deleted = self
                .delete_keys_with_projection_changes(chunk, projections)
                .await
                .map_err(SyncWriteError::Engine)?;
            affected.revision = deleted.revision;
            affected.value.extend(deleted.value);
            // Records go first: a failure here leaves members that the next
            // listing deletes again, which is a no-op for absent records.
            self.storage
                .remove_sync_members(scopes, chunk)
                .await
                .map_err(storage_error)?;
        }
        Ok(SyncApplied::Deleted {
            lane: lane_id.to_owned(),
            keys: stale,
            affected,
        })
    }

    /// Writes one hydrate or calendar page and its lane state (`advance`
    /// maps the saved state to the row and new members to store) in one
    /// storage transaction, doing only what a background page needs. Records
    /// still merge with what is cached (screen loads write the same keys), and
    /// projections and live queries see the write like any authoritative one.
    /// Left out, because hosts publish a sync page only as "hydrated" with its
    /// revision and search buckets: the response projection, field changes,
    /// viewer fields, dependency fan-out, and new hot-tier entries (a
    /// background fill would evict the records open screens use; entries
    /// already hot are refreshed).
    async fn sync_write_page<H, F>(
        &mut self,
        identity: Option<&str>,
        mut updates: RecordUpdates,
        projections: Vec<ProjectionMutation>,
        lane: &SyncLanePlan,
        advance: F,
    ) -> Result<SyncPageWritten<F>, SyncWriteError<S::Error, H>>
    where
        H: std::error::Error + 'static,
        F: FnOnce(StoredSyncLane) -> (SyncLaneRow, Vec<EntityKey<'static>>),
    {
        self.ensure_revision_can_advance()
            .map_err(SyncWriteError::Engine)?;
        self.hydrate_optimistic()
            .await
            .map_err(SyncWriteError::Engine)?;
        if !self.optimistic.is_empty() {
            return Ok(SyncPageWritten::NeedsNetworkWrite {
                projections,
                advance,
            });
        }
        if let Some(observed) = identity {
            match self
                .bound_identity()
                .await
                .map_err(SyncWriteError::Engine)?
            {
                IdentityState::Missing => self
                    .bind_identity(observed)
                    .await
                    .map_err(SyncWriteError::Engine)?,
                IdentityState::Bound(bound) if bound == observed => {}
                IdentityState::Bound(_) | IdentityState::NotHydrated => {
                    return Ok(SyncPageWritten::NeedsNetworkWrite {
                        projections,
                        advance,
                    });
                }
            }
        }
        crate::page_retention::omit_hydration_pages(&mut updates);
        let (row, members) = advance(self.stored_lane::<H>(lane).await?);

        let mut existing: HashMap<EntityKey<'static>, crate::value::Record> = HashMap::new();
        let mut missing = Vec::new();
        for key in updates.keys() {
            match self.hot.peek(key) {
                Some(record) => {
                    existing.insert(key.clone(), record.clone());
                }
                None => missing.push(key.clone()),
            }
        }
        if !missing.is_empty() {
            let fetched = self
                .storage
                .get_batch(&missing)
                .await
                .map_err(storage_error)?;
            for (key, record) in missing.into_iter().zip(fetched) {
                if let Some(record) = record {
                    existing.insert(key, record);
                }
            }
        }
        let mut changed = BTreeSet::new();
        let mut search_changed_buckets = BTreeSet::new();
        let mut to_persist = Vec::new();
        for (key, update) in updates {
            let merged = match existing.remove(&key) {
                Some(mut record) => {
                    let before = snapshot_search_fields(&key, &record);
                    if !record.merge(update) {
                        continue;
                    }
                    collect_search_changes(
                        &key,
                        before.as_ref(),
                        Some(&record),
                        &mut search_changed_buckets,
                    );
                    record
                }
                None => {
                    collect_search_changes(&key, None, Some(&update), &mut search_changed_buckets);
                    update
                }
            };
            changed.insert(key.clone());
            to_persist.push((key, merged));
        }
        // What must outlive the write: refreshed hot entries and loaded catalogs.
        let republish = to_persist
            .iter()
            .filter(|(key, _)| self.search_catalogs.is_loaded() || self.hot.contains(key))
            .cloned()
            .collect::<Vec<_>>();

        let revision_advanced = if changed.is_empty() {
            self.projection_mutations_change(&projections)
                .await
                .map_err(SyncWriteError::Engine)?
        } else {
            true
        };
        let projection_keys = projections
            .iter()
            .map(|mutation| mutation.record_key().clone())
            .collect();
        self.storage
            .write_sync_page(to_persist, projections, row, members)
            .await
            .map_err(storage_error)?;

        let revision = if revision_advanced {
            let revision = self.advance_revision().map_err(SyncWriteError::Engine)?;
            self.live_queries.record(
                revision,
                live_query::Changes {
                    records: changed,
                    projections: projection_keys,
                },
            );
            revision
        } else {
            self.revision
        };
        // Publish only after the write succeeded, like every other write.
        self.update_loaded_search_catalogs(&republish);
        for (key, record) in republish {
            if self.hot.contains(&key) {
                self.hot.put(key, record);
            }
        }
        Ok(SyncPageWritten::Written(HydrationWriteResult {
            search_changed_buckets: search_changed_buckets.clone(),
            write_result: WriteResult {
                field_changes: None,
                identity_errors: Vec::new(),
                revision,
                revision_advanced,
                search_changed_buckets: Some(search_changed_buckets),
                changed: BTreeSet::new(),
                affected_ops: BTreeSet::new(),
                reset: false,
                revalidations: Vec::new(),
                mutation_uuid: None,
            },
            data: None,
        }))
    }

    /// The lane's saved state, counting a new pass when the plan starts one.
    async fn stored_lane<H: std::error::Error + 'static>(
        &self,
        lane: &SyncLanePlan,
    ) -> Result<StoredSyncLane, SyncWriteError<S::Error, H>> {
        let rows = self
            .storage
            .load_sync_lanes()
            .await
            .map_err(storage_error)?;
        let mut stored = match rows.iter().find(|row| row.id == lane.id) {
            Some(row) => StoredSyncLane::decode(row)?,
            None => StoredSyncLane::default(),
        };
        stored.state.id = lane.id.clone();
        stored.begin_pass(&lane.pass_started_at);
        Ok(stored)
    }
}

/// The lane's query operation, parsed on the lane's first page of the run.
fn lane_operation<E: std::error::Error + 'static, H: std::error::Error + 'static>(
    run: &mut SyncRun,
    lane: &SyncLanePlan,
) -> Result<std::sync::Arc<Operation>, SyncWriteError<E, H>> {
    if let Some(operation) = run.operations.get(&lane.id) {
        return Ok(operation.clone());
    }
    let document = Document::parse(&lane.query).map_err(engine_error)?;
    let operation = document
        .operation(lane.operation_name.as_deref())
        .map_err(engine_error)?
        .clone();
    if operation.kind != OperationKind::Query {
        return Err(engine_error(DocumentError::UnsupportedOperationType(
            format!("{:?} (cache hydration is query-only)", operation.kind),
        )));
    }
    let operation = std::sync::Arc::new(operation);
    run.operations.insert(lane.id.clone(), operation.clone());
    Ok(operation)
}

/// A page the cache cannot write. The server follows it with the lane's
/// `laneError`: the lane fails here, nothing is written, and its saved state
/// resumes it in a later run.
fn refuse_page(run: &mut SyncRun, lane_id: &str, reason: &str) -> SyncApplied {
    lane_progress(run, lane_id).error = Some(format!("page {reason}"));
    SyncApplied::Recorded
}

/// A lane's `laneError`: the lane fails for this run (keeping the server's
/// message) and its saved state stays as its last applied page left it, so
/// the next run resumes there. The other lanes carry on.
fn sync_lane_error<E: std::error::Error + 'static, H: std::error::Error + 'static>(
    run: &mut SyncRun,
    lane_id: &str,
    message: String,
) -> Result<SyncApplied, SyncWriteError<E, H>> {
    run.lane(lane_id)?;
    let progress = lane_progress(run, lane_id);
    if progress.done {
        return Err(stream(format!(
            "lane `{lane_id}` sent laneError after laneDone"
        )));
    }
    if progress.error_received {
        return Err(stream(format!("lane `{lane_id}` sent laneError twice")));
    }
    progress.error_received = true;
    progress.error = Some(message);
    Ok(SyncApplied::Recorded)
}

fn lane_progress<'a>(run: &'a mut SyncRun, lane_id: &str) -> &'a mut LaneProgress {
    run.progress.entry(lane_id.to_owned()).or_default()
}

fn stream<E: std::error::Error + 'static, H: std::error::Error + 'static>(
    message: impl Into<String>,
) -> SyncWriteError<E, H> {
    SyncWriteError::Stream(SyncStreamError::Stream(message.into()))
}

fn engine_error<E: std::error::Error + 'static, H: std::error::Error + 'static>(
    error: impl Into<EngineError<E>>,
) -> SyncWriteError<E, H> {
    SyncWriteError::Engine(error.into())
}

fn storage_error<E: std::error::Error + 'static, H: std::error::Error + 'static>(
    error: E,
) -> SyncWriteError<E, H> {
    SyncWriteError::Engine(EngineError::Storage(error))
}

fn iso_time(unix_ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(unix_ms)
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
