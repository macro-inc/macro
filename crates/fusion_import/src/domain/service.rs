//! Browsing a user's Autodesk data, and importing items and their versions
//! into Macro file documents.
//!
//! Every call is bounded: an import or sync downloads at most
//! [`DOWNLOADS_PER_CALL`] versions, oldest first, and reports what remains,
//! so the agent calls `sync` again until nothing does. That bounds tool
//! latency and how hard one call leans on Autodesk's rate limits, and every
//! call can be repeated: the ledger records each version once, a document is
//! created under an id chosen before it exists, and adding a version holding
//! the newest version's bytes adds nothing.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::time::Duration;

use bytes::Bytes;
use macro_user_id::user_id::MacroUserIdStr;
use model_file_type::{FileAssociation, FileType};
use tracing::Instrument;
use tracing::field::Empty;
use upstream_error::UpstreamError;
use uuid::Uuid;

use super::models::{
    ApsProjectId, BrowseAt, BrowseEntry, BrowsePage, FolderEntry, FusionVersion, ItemId,
    ItemReport, ItemStatus, LinkState, RecordedOutcome, SkipReason, SkippedVersion, SyncReport,
    SyncScope, TrackedItem, TrackedView, VersionOutcome, VersionRecord,
};
use super::ports::{
    ApsConnections, ApsError, ApsReader, CadDocuments, CreatedCad, Download, DownloadError,
    FusionRepo, FusionRollout, SignedDownloads,
};

#[cfg(test)]
mod test;

/// The largest version the import stores, the cap document saves use.
pub const MAX_VERSION_BYTES: u64 = 100 * 1024 * 1024;

/// How many versions one import or sync downloads.
pub const DOWNLOADS_PER_CALL: u32 = 10;

/// How many items one import may name.
pub const MAX_IMPORT_ITEMS: usize = 20;

/// How many items one sync covers.
pub const MAX_SYNC_ITEMS: usize = 50;

/// How long one sync holds an item: longer than ten capped downloads take.
const SYNC_LEASE: Duration = Duration::from_secs(15 * 60);

/// What the flag being off reads as: the feature is not there.
pub const FUSION_IMPORT_OFF: &str = "Fusion import";

/// Why an import call failed as a whole. A failure of one item is reported
/// on that item instead.
#[derive(Debug, thiserror::Error)]
pub enum FusionImportError {
    /// The thing asked for is not there for this user.
    #[error("{0} not found")]
    NotFound(&'static str),
    /// The user has no Autodesk connection that gives file access.
    #[error("Autodesk is not connected")]
    NotConnected,
    /// The user's Autodesk grant stopped working.
    #[error("the Autodesk connection must be authorized again")]
    NeedsReauth,
    /// The request is not one the import takes.
    #[error("{0}")]
    InvalidRequest(&'static str),
    /// Autodesk is rate limiting.
    #[error("Autodesk is rate limiting requests")]
    RateLimited {
        /// How long Autodesk asked us to wait, when it said.
        retry_after: Option<Duration>,
    },
    /// Autodesk is down or answered with something unusable.
    #[error(transparent)]
    Upstream(UpstreamError),
    /// The import failed on our side.
    #[error("Fusion import failed: {0:?}")]
    Internal(rootcause::Report),
}

/// The Fusion import, as its callers see it.
pub trait FusionImport: Send + Sync + 'static {
    /// What is at one place in the user's Autodesk data, with the items they
    /// already imported marked.
    fn browse(
        &self,
        user: &MacroUserIdStr<'static>,
        at: BrowseAt,
    ) -> impl Future<Output = Result<BrowsePage, FusionImportError>> + Send;

    /// Import items of one project: each becomes one document, and its
    /// versions that document's versions, oldest first. An item whose
    /// document was deleted gets a new one.
    fn import(
        &self,
        user: &MacroUserIdStr<'static>,
        project: ApsProjectId,
        items: Vec<ItemId>,
    ) -> impl Future<Output = Result<SyncReport, FusionImportError>> + Send;

    /// Import the versions of imported items that are not imported yet: the
    /// items named, or a page of all the user's imported items.
    fn sync(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: SyncScope,
    ) -> impl Future<Output = Result<SyncReport, FusionImportError>> + Send;
}

/// Whether a sync may replace a deleted document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// An explicit import: a deleted document is replaced.
    Import,
    /// A sync: a deleted document is reported and left alone.
    Sync,
}

/// Why one item's sync stopped.
#[derive(Debug, thiserror::Error)]
enum ItemFailure {
    #[error(transparent)]
    Aps(ApsError),
    #[error(transparent)]
    Download(DownloadError),
    #[error("fusion ledger failed: {0:?}")]
    Ledger(rootcause::Report),
    #[error("documents failed: {0:?}")]
    Documents(rootcause::Report),
}

fn ledger(error: impl std::error::Error + Send + Sync + 'static) -> ItemFailure {
    ItemFailure::Ledger(rootcause::Report::new(error).into_dynamic())
}

fn documents(error: impl std::error::Error + Send + Sync + 'static) -> ItemFailure {
    ItemFailure::Documents(rootcause::Report::new(error).into_dynamic())
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> FusionImportError {
    FusionImportError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// A whole-call Autodesk failure; `what` names the thing that was read.
fn call_error(error: ApsError, what: &'static str) -> FusionImportError {
    match error {
        ApsError::NeedsReauth => FusionImportError::NeedsReauth,
        ApsError::NotFound | ApsError::Forbidden => FusionImportError::NotFound(what),
        ApsError::RateLimited { retry_after } => FusionImportError::RateLimited { retry_after },
        ApsError::Upstream(error) => FusionImportError::Upstream(error),
        ApsError::Internal(report) => FusionImportError::Internal(report),
    }
}

/// A Macro file type the import keeps versions of: one of Macro's 3D types.
/// Documents of other types (PDFs and images among them) serve their first
/// version, so later versions would never show.
fn cad_file_type(extension: &str) -> Option<FileType> {
    FileType::from_str(extension)
        .ok()
        .filter(|file_type| matches!(file_type.macro_app_path(), FileAssociation::ThreeD(_)))
}

/// One item's sync: who it is for, where to read it, and what is known so
/// far.
struct ItemSync<'a, Reader> {
    reader: &'a Reader,
    user: &'a MacroUserIdStr<'static>,
    item: TrackedItem,
    /// The document's name, read from Autodesk when first needed.
    name: Option<String>,
    /// The document's file type, once its first version is imported.
    file_type: Option<FileType>,
}

/// The import over its ports.
pub struct FusionImportService<C, D, R, X, F> {
    connections: C,
    downloads: D,
    repo: R,
    documents: X,
    rollout: F,
}

impl<C, D, R, X, F> FusionImportService<C, D, R, X, F> {
    /// The import over these adapters.
    pub fn new(connections: C, downloads: D, repo: R, documents: X, rollout: F) -> Self {
        Self {
            connections,
            downloads,
            repo,
            documents,
            rollout,
        }
    }
}

impl<C, D, R, X, F> FusionImportService<C, D, R, X, F>
where
    C: ApsConnections,
    D: SignedDownloads,
    R: FusionRepo,
    X: CadDocuments,
    F: FusionRollout,
{
    /// The user's Autodesk account, once the rollout lets them in.
    async fn reader(&self, user: &MacroUserIdStr<'static>) -> Result<C::Reader, FusionImportError> {
        if !self.rollout.enabled_for(user).await {
            return Err(FusionImportError::NotFound(FUSION_IMPORT_OFF));
        }

        self.connections
            .for_user(user)
            .await
            .map_err(|error| call_error(error, "Autodesk connection"))?
            .ok_or(FusionImportError::NotConnected)
    }

    /// Sync one tracked item under its lease, spending `budget`.
    async fn sync_item(
        &self,
        reader: &C::Reader,
        user: &MacroUserIdStr<'static>,
        tracked: TrackedItem,
        name: Option<String>,
        mode: Mode,
        budget: &mut u32,
    ) -> Result<ItemReport, FusionImportError> {
        let mut report = ItemReport::untouched(tracked.item_id.clone(), ItemStatus::NotReached);
        report.document_id = (tracked.state == LinkState::Linked).then_some(tracked.document_id);
        if *budget == 0 {
            return Ok(report);
        }

        let Some(claim) = self
            .repo
            .claim(user, &tracked.item_id, SYNC_LEASE)
            .await
            .map_err(internal)?
        else {
            report.status = ItemStatus::Busy;
            return Ok(report);
        };

        let span = tracing::info_span!(
            "fusion.sync_item",
            fusion.item_id = tracked.item_id.as_str(),
            document_id = Empty,
            versions.imported = Empty,
            versions.skipped = Empty,
            outcome = Empty,
        );
        let mut sync = ItemSync {
            reader,
            user,
            item: claim.item.clone(),
            name,
            file_type: None,
        };
        let synced = self
            .sync_claimed(&mut sync, mode, budget, &mut report)
            .instrument(span.clone())
            .await;

        // Let go of the item whatever happened, so the next call can retry it
        // at once instead of waiting out the lease.
        if let Err(error) = self.repo.release(user, &claim).await {
            tracing::warn!(error = ?error, "failed to release a Fusion item; its lease lapses instead");
        }

        if let Err(failure) = synced {
            report.status = match failure {
                ItemFailure::Aps(ApsError::NeedsReauth) => {
                    return Err(FusionImportError::NeedsReauth);
                }
                ItemFailure::Aps(ApsError::NotFound | ApsError::Forbidden) => ItemStatus::NotFound,
                ItemFailure::Aps(ApsError::RateLimited { .. }) => ItemStatus::RateLimited,
                other => {
                    tracing::warn!(error = ?other, "a Fusion item failed to sync");
                    ItemStatus::Failed
                }
            };
        }

        report.skipped.sort_by_key(|skipped| skipped.version_number);
        if let Some(document_id) = report.document_id {
            span.record("document_id", tracing::field::display(document_id));
        }
        span.record("versions.imported", report.imported_now);
        span.record("versions.skipped", report.skipped.len());
        span.record("outcome", <&'static str>::from(report.status));
        Ok(report)
    }

    /// The body of [`Self::sync_item`]: brings the item's versions up to
    /// date, filling `report` as it goes so a failure part way keeps what
    /// was done.
    async fn sync_claimed(
        &self,
        sync: &mut ItemSync<'_, C::Reader>,
        mode: Mode,
        budget: &mut u32,
        report: &mut ItemReport,
    ) -> Result<(), ItemFailure> {
        let (reader, user) = (sync.reader, sync.user);

        // A linked document that is gone: a sync leaves the item alone, an
        // explicit import starts a new document and forgets the old versions.
        if sync.item.state == LinkState::Linked
            && !self
                .documents
                .is_live(sync.item.document_id)
                .await
                .map_err(documents)?
        {
            if mode == Mode::Sync {
                report.status = ItemStatus::DocumentGone;
                return Ok(());
            }
            let document_id = Uuid::now_v7();
            self.repo
                .relink(user, &sync.item.item_id, document_id)
                .await
                .map_err(ledger)?;
            sync.item.document_id = document_id;
            sync.item.state = LinkState::Creating;
            report.document_id = None;
        }

        let mut versions = reader
            .versions(&sync.item.project_id, &sync.item.item_id)
            .await
            .map_err(ItemFailure::Aps)?;
        versions.sort_by_key(|version| version.number);

        let mut recorded = self
            .repo
            .recorded_versions(user, &sync.item.item_id)
            .await
            .map_err(ledger)?;
        recorded.sort_by_key(|version| version.number);

        // The document's file type is its first imported version's.
        sync.file_type = recorded
            .iter()
            .find(|version| version.outcome == VersionOutcome::Imported)
            .and_then(|version| version.extension.as_deref())
            .and_then(cad_file_type);
        report.already_imported = recorded
            .iter()
            .filter(|version| version.outcome == VersionOutcome::Imported)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        report.skipped = recorded
            .iter()
            .filter(|version| version.outcome != VersionOutcome::Imported)
            .map(|version| SkippedVersion {
                version_number: version.number,
                outcome: version.outcome,
            })
            .collect();

        let seen: HashSet<_> = recorded.iter().map(|version| &version.version_id).collect();
        let pending: Vec<&FusionVersion> = versions
            .iter()
            .filter(|version| !seen.contains(&version.id))
            .collect();
        report.remaining = pending.len().try_into().unwrap_or(u32::MAX);
        report.status = ItemStatus::Synced;

        for version in pending {
            if *budget == 0 {
                break;
            }

            let record = self.import_version(sync, version, budget).await?;
            self.repo
                .record_version(user, &sync.item.item_id, &record)
                .await
                .map_err(ledger)?;
            report.remaining = report.remaining.saturating_sub(1);

            match record.outcome {
                RecordedOutcome::Imported { .. } => {
                    report.imported_now += 1;
                    report.document_id = Some(sync.item.document_id);
                }
                RecordedOutcome::Skipped(_) => report.skipped.push(SkippedVersion {
                    version_number: record.number,
                    outcome: record.outcome.outcome(),
                }),
            }
        }
        Ok(())
    }

    /// Decide one version's outcome, downloading and storing it when it can
    /// be imported. Only a download spends `budget`.
    async fn import_version(
        &self,
        sync: &mut ItemSync<'_, C::Reader>,
        version: &FusionVersion,
        budget: &mut u32,
    ) -> Result<VersionRecord, ItemFailure> {
        let record = |outcome| VersionRecord {
            version_id: version.id.clone(),
            number: version.number,
            outcome,
            size: version.size,
            extension: version.extension.clone(),
            created_at: version.created_at,
        };
        let skip = |reason| record(RecordedOutcome::Skipped(reason));

        let Some(storage) = &version.storage else {
            return Ok(skip(SkipReason::Unavailable));
        };
        let Some(version_type) = version.extension.as_deref().and_then(cad_file_type) else {
            return Ok(skip(SkipReason::UnsupportedFormat));
        };
        // A document has one file type; a version of another can't join it.
        if sync
            .file_type
            .is_some_and(|document_type| document_type != version_type)
        {
            return Ok(skip(SkipReason::UnsupportedFormat));
        }
        if version.size.is_some_and(|size| size > MAX_VERSION_BYTES) {
            return Ok(skip(SkipReason::TooLarge));
        }

        *budget = budget.saturating_sub(1);
        let signed = match sync.reader.signed_download(storage).await {
            Ok(signed) => signed,
            Err(ApsError::NotFound | ApsError::Forbidden) => {
                return Ok(skip(SkipReason::Unavailable));
            }
            Err(error) => return Err(ItemFailure::Aps(error)),
        };
        if signed.size.is_some_and(|size| size > MAX_VERSION_BYTES) {
            return Ok(skip(SkipReason::TooLarge));
        }
        let bytes = match self
            .downloads
            .fetch(&signed, MAX_VERSION_BYTES)
            .await
            .map_err(ItemFailure::Download)?
        {
            Download::Bytes(bytes) => bytes,
            Download::TooLarge => return Ok(skip(SkipReason::TooLarge)),
        };

        let document_version_id = self.store(sync, version_type, bytes).await?;
        sync.file_type = Some(version_type);
        Ok(record(RecordedOutcome::Imported {
            document_version_id,
        }))
    }

    /// Put `bytes` in the item's document, creating it for the first version.
    async fn store(
        &self,
        sync: &mut ItemSync<'_, C::Reader>,
        file_type: FileType,
        bytes: Bytes,
    ) -> Result<i64, ItemFailure> {
        let (user, item) = (sync.user, &mut sync.item);
        if item.state == LinkState::Linked {
            let added = self
                .documents
                .add_version(user, item.document_id, bytes)
                .await
                .map_err(documents)?;
            return Ok(added.document_version_id);
        }

        let document_name = match &sync.name {
            Some(name) => name.clone(),
            None => {
                let fetched = sync
                    .reader
                    .item(&item.project_id, &item.item_id)
                    .await
                    .map_err(ItemFailure::Aps)?;
                sync.name.insert(fetched.name).clone()
            }
        };

        // A document with the chosen id that exists already was made by an
        // attempt that stopped before recording it. Adding the same bytes
        // answers the version that attempt stored, without adding one.
        let created = self
            .documents
            .create(
                user,
                item.document_id,
                &document_name,
                file_type,
                bytes.clone(),
            )
            .await
            .map_err(documents)?;
        let document_version_id = match created {
            CreatedCad::Created {
                document_version_id,
            } => document_version_id,
            CreatedCad::AlreadyExists => {
                self.documents
                    .add_version(user, item.document_id, bytes)
                    .await
                    .map_err(documents)?
                    .document_version_id
            }
        };

        self.repo
            .mark_linked(user, &item.item_id)
            .await
            .map_err(ledger)?;
        item.state = LinkState::Linked;
        Ok(document_version_id)
    }
}

impl<C, D, R, X, F> FusionImport for FusionImportService<C, D, R, X, F>
where
    C: ApsConnections,
    D: SignedDownloads,
    R: FusionRepo,
    X: CadDocuments,
    F: FusionRollout,
{
    #[tracing::instrument(name = "fusion.browse", skip_all, err)]
    async fn browse(
        &self,
        user: &MacroUserIdStr<'static>,
        at: BrowseAt,
    ) -> Result<BrowsePage, FusionImportError> {
        let reader = self.reader(user).await?;

        let entries = match at {
            BrowseAt::Hubs => reader
                .hubs()
                .await
                .map_err(|error| call_error(error, "Autodesk hubs"))?
                .into_iter()
                .map(|hub| BrowseEntry::Hub {
                    id: hub.id,
                    name: hub.name,
                })
                .collect(),
            BrowseAt::Projects { hub } => reader
                .projects(&hub)
                .await
                .map_err(|error| call_error(error, "Autodesk hub"))?
                .into_iter()
                .map(|project| BrowseEntry::Project {
                    id: project.id,
                    name: project.name,
                })
                .collect(),
            BrowseAt::TopFolders { hub, project } => reader
                .top_folders(&hub, &project)
                .await
                .map_err(|error| call_error(error, "Autodesk project"))?
                .into_iter()
                .map(|folder| BrowseEntry::Folder {
                    id: folder.id,
                    name: folder.name,
                })
                .collect(),
            BrowseAt::Folder {
                project,
                folder,
                page,
            } => {
                let contents = reader
                    .folder_contents(&project, &folder, page)
                    .await
                    .map_err(|error| call_error(error, "Autodesk folder"))?;
                let item_ids: Vec<ItemId> = contents
                    .entries
                    .iter()
                    .filter_map(|entry| match entry {
                        FolderEntry::Item(item) => Some(item.id.clone()),
                        FolderEntry::Folder(_) => None,
                    })
                    .collect();
                let tracked: HashMap<ItemId, TrackedView> = if item_ids.is_empty() {
                    HashMap::new()
                } else {
                    self.repo
                        .tracked(user, &item_ids)
                        .await
                        .map_err(internal)?
                        .into_iter()
                        .map(|summary| {
                            let document_id = (summary.item.state == LinkState::Linked)
                                .then_some(summary.item.document_id);
                            let view = TrackedView {
                                document_id,
                                imported_versions: summary.imported_versions,
                            };
                            (summary.item.item_id, view)
                        })
                        .collect()
                };

                let entries = contents
                    .entries
                    .into_iter()
                    .map(|entry| match entry {
                        FolderEntry::Folder(folder) => BrowseEntry::Folder {
                            id: folder.id,
                            name: folder.name,
                        },
                        FolderEntry::Item(item) => BrowseEntry::Item {
                            tracked: tracked.get(&item.id).cloned(),
                            id: item.id,
                            name: item.name,
                            latest_version: item.latest_version,
                        },
                    })
                    .collect();
                return Ok(BrowsePage {
                    entries,
                    next_cursor: contents.next_page.map(|page| page.to_string()),
                });
            }
        };

        Ok(BrowsePage {
            entries,
            next_cursor: None,
        })
    }

    async fn import(
        &self,
        user: &MacroUserIdStr<'static>,
        project: ApsProjectId,
        items: Vec<ItemId>,
    ) -> Result<SyncReport, FusionImportError> {
        let items = distinct(items);
        if items.is_empty() || items.len() > MAX_IMPORT_ITEMS {
            return Err(FusionImportError::InvalidRequest(
                "an import names 1 to 20 items",
            ));
        }

        let span = tracing::info_span!("fusion.import", item.count = items.len());
        async {
            let reader = self.reader(user).await?;
            let mut budget = DOWNLOADS_PER_CALL;
            let mut reports = Vec::with_capacity(items.len());

            // Every item is tracked even once the budget is spent, so a later
            // sync reaches the ones this call did not.
            for item_id in items {
                let item = match reader.item(&project, &item_id).await {
                    Ok(item) => item,
                    Err(ApsError::NeedsReauth) => return Err(FusionImportError::NeedsReauth),
                    Err(ApsError::NotFound | ApsError::Forbidden) => {
                        reports.push(ItemReport::untouched(item_id, ItemStatus::NotFound));
                        continue;
                    }
                    Err(ApsError::RateLimited { .. }) => {
                        reports.push(ItemReport::untouched(item_id, ItemStatus::RateLimited));
                        continue;
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error, "failed to read a Fusion item");
                        reports.push(ItemReport::untouched(item_id, ItemStatus::Failed));
                        continue;
                    }
                };

                let tracked = self
                    .repo
                    .track(user, &item_id, &project, Uuid::now_v7())
                    .await
                    .map_err(internal)?;
                let report = self
                    .sync_item(
                        &reader,
                        user,
                        tracked,
                        Some(item.name),
                        Mode::Import,
                        &mut budget,
                    )
                    .await?;
                reports.push(report);
            }
            Ok(SyncReport::of(reports))
        }
        .instrument(span)
        .await
    }

    async fn sync(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: SyncScope,
    ) -> Result<SyncReport, FusionImportError> {
        let scope = match scope {
            SyncScope::Items(items) => {
                let items = distinct(items);
                if items.is_empty() || items.len() > MAX_SYNC_ITEMS {
                    return Err(FusionImportError::InvalidRequest(
                        "a sync names 1 to 50 items, or none for all",
                    ));
                }
                SyncScope::Items(items)
            }
            all @ SyncScope::All { .. } => all,
        };

        let span = tracing::info_span!("fusion.sync", item.count = Empty);
        async {
            let reader = self.reader(user).await?;

            // A sync of everything takes one page of items in id order, and
            // one more row to know where the next page starts.
            let paged = matches!(scope, SyncScope::All { .. });
            let mut next_page = None;
            let targets: Vec<(ItemId, Option<TrackedItem>)> = match scope {
                SyncScope::Items(items) => {
                    let mut tracked: HashMap<ItemId, TrackedItem> = self
                        .repo
                        .tracked(user, &items)
                        .await
                        .map_err(internal)?
                        .into_iter()
                        .map(|summary| (summary.item.item_id.clone(), summary.item))
                        .collect();
                    items
                        .into_iter()
                        .map(|item| {
                            let found = tracked.remove(&item);
                            (item, found)
                        })
                        .collect()
                }
                SyncScope::All { from } => {
                    let mut page = self
                        .repo
                        .tracked_items(user, from.as_ref(), MAX_SYNC_ITEMS + 1)
                        .await
                        .map_err(internal)?;
                    if page.len() > MAX_SYNC_ITEMS {
                        next_page = page.pop().map(|item| item.item_id);
                    }
                    page.into_iter()
                        .map(|item| (item.item_id.clone(), Some(item)))
                        .collect()
                }
            };
            tracing::Span::current().record("item.count", targets.len());

            let mut budget = DOWNLOADS_PER_CALL;
            let mut reports = Vec::with_capacity(targets.len());
            for (item_id, tracked) in targets {
                let Some(tracked) = tracked else {
                    reports.push(ItemReport::untouched(item_id, ItemStatus::NotTracked));
                    continue;
                };
                let report = self
                    .sync_item(&reader, user, tracked, None, Mode::Sync, &mut budget)
                    .await?;
                reports.push(report);
            }

            let mut report = SyncReport::of(reports);
            // The next sync of everything starts at the first item that still
            // has work, or else at the next page.
            if paged {
                report.next_cursor = report
                    .items
                    .iter()
                    .find(|item| item.remaining > 0 || item.status == ItemStatus::NotReached)
                    .map(|item| item.item_id.clone())
                    .or(next_page);
            }
            Ok(report)
        }
        .instrument(span)
        .await
    }
}

/// `items` without repeats, in their first order.
fn distinct(items: Vec<ItemId>) -> Vec<ItemId> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .collect()
}
