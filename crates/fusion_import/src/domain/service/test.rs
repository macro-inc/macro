//! The import over hand-written fakes of every port.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::models::{
    ApsFolderId, ApsProject, Folder, FolderPage, FusionItem, Hub, HubId, RecordedVersion,
    SignedUrl, StorageObject, SyncScope, TrackedSummary, VersionId,
};
use crate::domain::ports::{AddedVersion, Claim, FusionRepo};

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeError;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|designer@example.com")
        .unwrap()
        .into_owned()
}

fn project() -> ApsProjectId {
    ApsProjectId::parse("a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE").unwrap()
}

fn item_id(name: &str) -> ItemId {
    ItemId::parse(&format!("urn:adsk.wipprod:dm.lineage:{name}")).unwrap()
}

/// Version `number` of item `name`, a downloadable STL whose bytes are
/// `"<name> v<number>"`.
fn stl(name: &str, number: u32) -> FusionVersion {
    FusionVersion {
        id: VersionId::parse(&format!(
            "urn:adsk.wipprod:fs.file:vf.{name}?version={number}"
        ))
        .unwrap(),
        number,
        created_at: None,
        size: Some(16),
        extension: Some("stl".into()),
        storage: Some(StorageObject {
            bucket_key: "wip.dm.prod".into(),
            object_key: format!("{name}-v{number}.stl"),
        }),
    }
}

fn bytes_of(name: &str, number: u32) -> Bytes {
    Bytes::from(format!("{name} v{number}"))
}

// -- Autodesk ---------------------------------------------------------------

#[derive(Default)]
struct ApsState {
    connected: bool,
    needs_reauth: bool,
    items: HashMap<ItemId, Vec<FusionVersion>>,
    folder: Vec<FolderEntry>,
    /// Objects APS refuses to sign.
    refused: HashSet<String>,
    signed: u32,
}

#[derive(Clone)]
struct FakeAps(Arc<Mutex<ApsState>>);

impl ApsConnections for FakeAps {
    type Reader = FakeAps;

    async fn for_user(&self, _user: &MacroUserIdStr<'static>) -> Result<Option<FakeAps>, ApsError> {
        Ok(self.0.lock().unwrap().connected.then(|| self.clone()))
    }
}

impl ApsReader for FakeAps {
    async fn hubs(&self) -> Result<Vec<Hub>, ApsError> {
        Ok(vec![])
    }

    async fn projects(&self, _hub: &HubId) -> Result<Vec<ApsProject>, ApsError> {
        Ok(vec![])
    }

    async fn top_folders(
        &self,
        _hub: &HubId,
        _project: &ApsProjectId,
    ) -> Result<Vec<Folder>, ApsError> {
        Ok(vec![])
    }

    async fn folder_contents(
        &self,
        _project: &ApsProjectId,
        _folder: &ApsFolderId,
        _page: u32,
    ) -> Result<FolderPage, ApsError> {
        Ok(FolderPage {
            entries: self.0.lock().unwrap().folder.clone(),
            next_page: None,
        })
    }

    async fn item(&self, _project: &ApsProjectId, item: &ItemId) -> Result<FusionItem, ApsError> {
        let state = self.0.lock().unwrap();
        let versions = state.items.get(item).ok_or(ApsError::NotFound)?;
        Ok(FusionItem {
            id: item.clone(),
            name: format!("{} design", item.as_str()),
            latest_version: versions.iter().map(|version| version.number).max(),
        })
    }

    async fn versions(
        &self,
        _project: &ApsProjectId,
        item: &ItemId,
    ) -> Result<Vec<FusionVersion>, ApsError> {
        let state = self.0.lock().unwrap();
        if state.needs_reauth {
            return Err(ApsError::NeedsReauth);
        }
        // Newest first, as APS lists them.
        let mut versions = state.items.get(item).cloned().ok_or(ApsError::NotFound)?;
        versions.reverse();
        Ok(versions)
    }

    async fn signed_download(&self, storage: &StorageObject) -> Result<SignedUrl, ApsError> {
        let mut state = self.0.lock().unwrap();
        state.signed += 1;
        if state.refused.contains(&storage.object_key) {
            return Err(ApsError::Forbidden);
        }
        Ok(SignedUrl {
            parts: vec![format!("https://storage.test/{}", storage.object_key)],
            size: None,
        })
    }
}

// -- storage ----------------------------------------------------------------

#[derive(Default)]
struct DownloadState {
    /// Objects whose bytes are past any cap.
    huge: HashSet<String>,
    fetched: Vec<String>,
}

#[derive(Clone)]
struct FakeDownloads(Arc<Mutex<DownloadState>>);

impl SignedDownloads for FakeDownloads {
    async fn fetch(&self, url: &SignedUrl, _max_bytes: u64) -> Result<Download, DownloadError> {
        let address = url.parts.concat();
        let object = address
            .trim_start_matches("https://storage.test/")
            .to_owned();
        let mut state = self.0.lock().unwrap();
        state.fetched.push(object.clone());
        if state.huge.contains(&object) {
            return Ok(Download::TooLarge);
        }
        // `<name>-v<number>.<ext>` holds `<name> v<number>`.
        let body = object
            .rsplit_once('.')
            .map(|(stem, _)| stem.replacen("-v", " v", 1))
            .unwrap();
        Ok(Download::Bytes(Bytes::from(body)))
    }
}

// -- ledger -----------------------------------------------------------------

#[derive(Clone)]
struct LedgerRow {
    item: TrackedItem,
    lease_until: Option<chrono::DateTime<Utc>>,
    versions: Vec<VersionRecord>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<HashMap<ItemId, LedgerRow>>>);

impl FakeRepo {
    fn row(&self, item: &ItemId) -> LedgerRow {
        self.0.lock().unwrap().get(item).cloned().unwrap()
    }
}

impl FusionRepo for FakeRepo {
    type Err = FakeError;

    async fn track(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
        project: &ApsProjectId,
        document_id: Uuid,
    ) -> Result<TrackedItem, FakeError> {
        let mut rows = self.0.lock().unwrap();
        let row = rows.entry(item.clone()).or_insert_with(|| LedgerRow {
            item: TrackedItem {
                item_id: item.clone(),
                project_id: project.clone(),
                document_id,
                state: LinkState::Creating,
            },
            lease_until: None,
            versions: Vec::new(),
        });
        Ok(row.item.clone())
    }

    async fn tracked(
        &self,
        _user: &MacroUserIdStr<'static>,
        items: &[ItemId],
    ) -> Result<Vec<TrackedSummary>, FakeError> {
        let rows = self.0.lock().unwrap();
        Ok(items
            .iter()
            .filter_map(|item| rows.get(item))
            .map(|row| TrackedSummary {
                item: row.item.clone(),
                imported_versions: row
                    .versions
                    .iter()
                    .filter(|version| version.outcome.outcome() == VersionOutcome::Imported)
                    .count()
                    .try_into()
                    .unwrap(),
            })
            .collect())
    }

    async fn tracked_items(
        &self,
        _user: &MacroUserIdStr<'static>,
        from: Option<&ItemId>,
        limit: usize,
    ) -> Result<Vec<TrackedItem>, FakeError> {
        let rows = self.0.lock().unwrap();
        let mut items: Vec<TrackedItem> = rows
            .values()
            .map(|row| row.item.clone())
            .filter(|item| from.is_none_or(|from| item.item_id >= *from))
            .collect();
        items.sort_by(|a, b| a.item_id.cmp(&b.item_id));
        items.truncate(limit);
        Ok(items)
    }

    async fn claim(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
        lease: Duration,
    ) -> Result<Option<Claim>, FakeError> {
        let mut rows = self.0.lock().unwrap();
        let row = rows.get_mut(item).unwrap();
        let now = Utc::now();
        if row.lease_until.is_some_and(|until| until >= now) {
            return Ok(None);
        }
        let until = now + chrono::Duration::from_std(lease).unwrap();
        row.lease_until = Some(until);
        Ok(Some(Claim {
            item: row.item.clone(),
            until,
        }))
    }

    async fn release(
        &self,
        _user: &MacroUserIdStr<'static>,
        claim: &Claim,
    ) -> Result<(), FakeError> {
        let mut rows = self.0.lock().unwrap();
        let row = rows.get_mut(&claim.item.item_id).unwrap();
        if row.lease_until == Some(claim.until) {
            row.lease_until = None;
        }
        Ok(())
    }

    async fn mark_linked(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> Result<(), FakeError> {
        self.0.lock().unwrap().get_mut(item).unwrap().item.state = LinkState::Linked;
        Ok(())
    }

    async fn relink(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
        document_id: Uuid,
    ) -> Result<(), FakeError> {
        let mut rows = self.0.lock().unwrap();
        let row = rows.get_mut(item).unwrap();
        row.item.document_id = document_id;
        row.item.state = LinkState::Creating;
        row.versions.clear();
        Ok(())
    }

    async fn recorded_versions(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> Result<Vec<RecordedVersion>, FakeError> {
        let rows = self.0.lock().unwrap();
        Ok(rows
            .get(item)
            .unwrap()
            .versions
            .iter()
            .map(|version| RecordedVersion {
                version_id: version.version_id.clone(),
                number: version.number,
                outcome: version.outcome.outcome(),
                extension: version.extension.clone(),
            })
            .collect())
    }

    async fn record_version(
        &self,
        _user: &MacroUserIdStr<'static>,
        item: &ItemId,
        version: &VersionRecord,
    ) -> Result<(), FakeError> {
        let mut rows = self.0.lock().unwrap();
        let row = rows.get_mut(item).unwrap();
        if !row
            .versions
            .iter()
            .any(|recorded| recorded.version_id == version.version_id)
        {
            row.versions.push(version.clone());
        }
        Ok(())
    }
}

// -- documents --------------------------------------------------------------

struct FakeDocument {
    file_type: FileType,
    versions: Vec<(i64, Bytes)>,
    live: bool,
}

#[derive(Default)]
struct DocumentState {
    documents: HashMap<Uuid, FakeDocument>,
    next_version_id: i64,
    /// The next create stores the document, then fails, as a crash would.
    crash_after_create: bool,
    /// The next add stores the version, then fails.
    crash_after_add: bool,
}

impl DocumentState {
    fn add(&mut self, document_id: Uuid, bytes: Bytes) -> AddedVersion {
        self.next_version_id += 1;
        let id = self.next_version_id;
        let document = self.documents.get_mut(&document_id).unwrap();
        if let Some((newest, held)) = document.versions.last()
            && *held == bytes
        {
            return AddedVersion {
                document_version_id: *newest,
                created: false,
            };
        }
        document.versions.push((id, bytes));
        AddedVersion {
            document_version_id: id,
            created: true,
        }
    }
}

#[derive(Clone, Default)]
struct FakeDocuments(Arc<Mutex<DocumentState>>);

impl FakeDocuments {
    /// Each document's file type and version bytes.
    fn contents(&self) -> Vec<(Uuid, FileType, Vec<Bytes>)> {
        let state = self.0.lock().unwrap();
        let mut contents: Vec<_> = state
            .documents
            .iter()
            .map(|(id, document)| {
                let bytes = document
                    .versions
                    .iter()
                    .map(|(_, bytes)| bytes.clone())
                    .collect();
                (*id, document.file_type, bytes)
            })
            .collect();
        contents.sort_by_key(|(id, _, _)| *id);
        contents
    }
}

impl CadDocuments for FakeDocuments {
    type Err = FakeError;

    async fn create(
        &self,
        _user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        _name: &str,
        file_type: FileType,
        bytes: Bytes,
    ) -> Result<CreatedCad, FakeError> {
        let mut state = self.0.lock().unwrap();
        if state.documents.contains_key(&document_id) {
            return Ok(CreatedCad::AlreadyExists);
        }
        state.documents.insert(
            document_id,
            FakeDocument {
                file_type,
                versions: Vec::new(),
                live: true,
            },
        );
        let added = state.add(document_id, bytes);
        if std::mem::take(&mut state.crash_after_create) {
            return Err(FakeError);
        }
        Ok(CreatedCad::Created {
            document_version_id: added.document_version_id,
        })
    }

    async fn add_version(
        &self,
        _user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        bytes: Bytes,
    ) -> Result<AddedVersion, FakeError> {
        let mut state = self.0.lock().unwrap();
        let added = state.add(document_id, bytes);
        if std::mem::take(&mut state.crash_after_add) {
            return Err(FakeError);
        }
        Ok(added)
    }

    async fn is_live(&self, document_id: Uuid) -> Result<bool, FakeError> {
        let state = self.0.lock().unwrap();
        Ok(state
            .documents
            .get(&document_id)
            .is_some_and(|document| document.live))
    }
}

// -- rollout ----------------------------------------------------------------

struct FakeRollout(bool);

impl FusionRollout for FakeRollout {
    async fn enabled_for(&self, _user: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

// -- the world --------------------------------------------------------------

struct World {
    aps: FakeAps,
    downloads: FakeDownloads,
    repo: FakeRepo,
    documents: FakeDocuments,
}

type Service = FusionImportService<FakeAps, FakeDownloads, FakeRepo, FakeDocuments, FakeRollout>;

impl World {
    /// A connected, flagged user whose items hold `versions` STL versions
    /// each, numbered from 1.
    fn with_items(items: &[(&str, u32)]) -> Self {
        let mut aps = ApsState {
            connected: true,
            ..ApsState::default()
        };
        for (name, versions) in items {
            let versions = (1..=*versions).map(|number| stl(name, number)).collect();
            aps.items.insert(item_id(name), versions);
        }
        Self {
            aps: FakeAps(Arc::new(Mutex::new(aps))),
            downloads: FakeDownloads(Arc::default()),
            repo: FakeRepo::default(),
            documents: FakeDocuments::default(),
        }
    }

    fn service(&self) -> Service {
        self.service_flagged(true)
    }

    fn service_flagged(&self, enabled: bool) -> Service {
        FusionImportService::new(
            self.aps.clone(),
            self.downloads.clone(),
            self.repo.clone(),
            self.documents.clone(),
            FakeRollout(enabled),
        )
    }

    fn add_version(&self, version: FusionVersion, name: &str) {
        let mut state = self.aps.0.lock().unwrap();
        state.items.get_mut(&item_id(name)).unwrap().push(version);
    }

    fn fetched(&self) -> usize {
        self.downloads.0.lock().unwrap().fetched.len()
    }
}

async fn import(world: &World, names: &[&str]) -> SyncReport {
    world
        .service()
        .import(
            &user(),
            project(),
            names.iter().map(|name| item_id(name)).collect(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn a_first_import_makes_one_document_with_every_version_oldest_first() {
    let world = World::with_items(&[("bracket", 3)]);

    let report = import(&world, &["bracket"]).await;

    let documents = world.documents.contents();
    assert_eq!(documents.len(), 1);
    let (document_id, file_type, versions) = &documents[0];
    assert_eq!(*file_type, FileType::Stl);
    assert_eq!(
        *versions,
        vec![
            bytes_of("bracket", 1),
            bytes_of("bracket", 2),
            bytes_of("bracket", 3)
        ]
    );
    assert_eq!(
        report,
        SyncReport {
            items: vec![ItemReport {
                item_id: item_id("bracket"),
                status: ItemStatus::Synced,
                document_id: Some(*document_id),
                imported_now: 3,
                already_imported: 0,
                skipped: vec![],
                unidentified: vec![],
                remaining: 0,
            }],
            remaining: 0,
            not_reached: 0,
            next_cursor: None,
        }
    );
    let row = world.repo.row(&item_id("bracket"));
    assert_eq!(row.item.state, LinkState::Linked);
    assert_eq!(row.lease_until, None);
}

#[tokio::test]
async fn a_resync_adds_only_the_new_versions() {
    let world = World::with_items(&[("bracket", 2)]);
    import(&world, &["bracket"]).await;
    world.add_version(stl("bracket", 3), "bracket");

    let report = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let again = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    assert_eq!(report.items[0].imported_now, 1);
    assert_eq!(report.items[0].already_imported, 2);
    assert_eq!(again.items[0].imported_now, 0);
    assert_eq!(again.items[0].already_imported, 3);
    assert_eq!(world.fetched(), 3);
    let (_, _, versions) = &world.documents.contents()[0];
    assert_eq!(versions.len(), 3);
}

#[tokio::test]
async fn a_call_downloads_ten_versions_and_reports_what_remains() {
    let world = World::with_items(&[("bracket", 13), ("hinge", 1)]);

    let first = import(&world, &["bracket", "hinge"]).await;

    assert_eq!(first.items[0].imported_now, 10);
    assert_eq!(first.items[0].remaining, 3);
    assert_eq!(first.items[1].status, ItemStatus::NotReached);
    assert_eq!(first.remaining, 3);
    assert_eq!(first.not_reached, 1);
    assert_eq!(world.fetched(), 10);

    // The not-reached item was tracked, so a plain sync picks it up.
    let second = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    assert_eq!(second.remaining, 0);
    assert_eq!(second.not_reached, 0);
    let imported: u32 = second.items.iter().map(|item| item.imported_now).sum();
    assert_eq!(imported, 4);
    let mut lengths: Vec<usize> = world
        .documents
        .contents()
        .into_iter()
        .map(|(_, _, versions)| versions.len())
        .collect();
    lengths.sort();
    assert_eq!(lengths, vec![1, 13]);
}

#[tokio::test]
async fn versions_that_cannot_be_imported_are_recorded_and_not_retried() {
    let world = World::with_items(&[("bracket", 0)]);
    let no_storage = FusionVersion {
        storage: None,
        ..stl("bracket", 1)
    };
    let oversized = FusionVersion {
        size: Some(MAX_VERSION_BYTES + 1),
        ..stl("bracket", 2)
    };
    let drawing = FusionVersion {
        extension: Some("pdf".into()),
        ..stl("bracket", 3)
    };
    let refused = stl("bracket", 4);
    let huge_download = stl("bracket", 5);
    let imported = stl("bracket", 6);
    let other_3d_type = FusionVersion {
        extension: Some("obj".into()),
        ..stl("bracket", 7)
    };
    for version in [
        no_storage,
        oversized,
        drawing,
        refused,
        huge_download,
        imported,
        other_3d_type,
    ] {
        world.add_version(version, "bracket");
    }
    world
        .aps
        .0
        .lock()
        .unwrap()
        .refused
        .insert("bracket-v4.stl".into());
    world
        .downloads
        .0
        .lock()
        .unwrap()
        .huge
        .insert("bracket-v5.stl".into());

    let report = import(&world, &["bracket"]).await;
    let signed_before = world.aps.0.lock().unwrap().signed;
    let again = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    let skipped = vec![
        SkippedVersion {
            version_number: 1,
            outcome: VersionOutcome::Unavailable,
        },
        SkippedVersion {
            version_number: 2,
            outcome: VersionOutcome::TooLarge,
        },
        SkippedVersion {
            version_number: 3,
            outcome: VersionOutcome::UnsupportedFormat,
        },
        SkippedVersion {
            version_number: 4,
            outcome: VersionOutcome::Unavailable,
        },
        SkippedVersion {
            version_number: 5,
            outcome: VersionOutcome::TooLarge,
        },
        SkippedVersion {
            version_number: 7,
            outcome: VersionOutcome::UnsupportedFormat,
        },
    ];
    assert_eq!(report.items[0].imported_now, 1);
    assert_eq!(report.items[0].skipped, skipped);
    assert_eq!(report.items[0].remaining, 0);
    assert_eq!(again.items[0].imported_now, 0);
    assert_eq!(again.items[0].skipped, skipped);
    assert_eq!(world.aps.0.lock().unwrap().signed, signed_before);
    assert_eq!(world.fetched(), 2);
    let (_, _, versions) = &world.documents.contents()[0];
    assert_eq!(*versions, vec![bytes_of("bracket", 6)]);
}

#[tokio::test]
async fn a_crash_after_the_document_is_created_converges_on_retry() {
    let world = World::with_items(&[("bracket", 2)]);
    world.documents.0.lock().unwrap().crash_after_create = true;

    let crashed = import(&world, &["bracket"]).await;
    let retried = import(&world, &["bracket"]).await;

    assert_eq!(crashed.items[0].status, ItemStatus::Failed);
    assert_eq!(retried.items[0].status, ItemStatus::Synced);
    assert_eq!(retried.items[0].imported_now, 2);
    let documents = world.documents.contents();
    assert_eq!(documents.len(), 1);
    assert_eq!(
        documents[0].2,
        vec![bytes_of("bracket", 1), bytes_of("bracket", 2)]
    );
    assert_eq!(
        world.repo.row(&item_id("bracket")).item.state,
        LinkState::Linked
    );
}

#[tokio::test]
async fn a_crash_after_a_version_is_added_converges_on_retry() {
    let world = World::with_items(&[("bracket", 1)]);
    import(&world, &["bracket"]).await;
    world.add_version(stl("bracket", 2), "bracket");
    world.documents.0.lock().unwrap().crash_after_add = true;

    let crashed = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let retried = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    assert_eq!(crashed.items[0].status, ItemStatus::Failed);
    assert_eq!(retried.items[0].imported_now, 1);
    let (_, _, versions) = &world.documents.contents()[0];
    assert_eq!(
        *versions,
        vec![bytes_of("bracket", 1), bytes_of("bracket", 2)]
    );
    let recorded = world.repo.row(&item_id("bracket")).versions;
    assert_eq!(recorded.len(), 2);
}

#[tokio::test]
async fn a_trashed_document_is_skipped_by_sync_and_replaced_by_import() {
    let world = World::with_items(&[("bracket", 2)]);
    let first = import(&world, &["bracket"]).await;
    let old_document = first.items[0].document_id.unwrap();
    world
        .documents
        .0
        .lock()
        .unwrap()
        .documents
        .get_mut(&old_document)
        .unwrap()
        .live = false;

    let synced = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let fetched_by_sync = world.fetched();
    let reimported = import(&world, &["bracket"]).await;

    assert_eq!(synced.items[0].status, ItemStatus::DocumentGone);
    assert_eq!(fetched_by_sync, 2);
    let new_document = reimported.items[0].document_id.unwrap();
    assert_ne!(new_document, old_document);
    assert_eq!(reimported.items[0].imported_now, 2);
    assert_eq!(reimported.items[0].already_imported, 0);
    assert_eq!(world.documents.contents().len(), 2);
}

#[tokio::test]
async fn an_item_another_sync_holds_is_reported_busy() {
    let world = World::with_items(&[("bracket", 1)]);
    import(&world, &["bracket"]).await;
    world.add_version(stl("bracket", 2), "bracket");
    world
        .repo
        .claim(&user(), &item_id("bracket"), Duration::from_secs(60))
        .await
        .unwrap()
        .unwrap();

    let report = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    assert_eq!(report.items[0].status, ItemStatus::Busy);
    assert_eq!(world.fetched(), 1);
}

#[tokio::test]
async fn an_item_not_in_the_account_does_not_stop_the_others() {
    let world = World::with_items(&[("bracket", 1)]);

    let report = import(&world, &["missing", "bracket"]).await;

    assert_eq!(report.items[0].status, ItemStatus::NotFound);
    assert_eq!(report.items[1].status, ItemStatus::Synced);
    assert_eq!(report.items[1].imported_now, 1);
}

#[tokio::test]
async fn a_sync_of_an_item_never_imported_says_so() {
    let world = World::with_items(&[("bracket", 1)]);

    let report = world
        .service()
        .sync(&user(), SyncScope::Items(vec![item_id("bracket")]))
        .await
        .unwrap();

    assert_eq!(report.items[0].status, ItemStatus::NotTracked);
    assert_eq!(world.fetched(), 0);
}

#[tokio::test]
async fn a_grant_that_stops_working_fails_the_call() {
    let world = World::with_items(&[("bracket", 1)]);
    world.aps.0.lock().unwrap().needs_reauth = true;

    let error = world
        .service()
        .import(&user(), project(), vec![item_id("bracket")])
        .await
        .unwrap_err();

    assert!(matches!(error, FusionImportError::NeedsReauth));
    // The item's hold was let go.
    assert_eq!(world.repo.row(&item_id("bracket")).lease_until, None);
}

#[tokio::test]
async fn a_browsed_folder_marks_the_items_already_imported() {
    let world = World::with_items(&[("bracket", 1), ("hinge", 1)]);
    let first = import(&world, &["bracket"]).await;
    world.aps.0.lock().unwrap().folder = vec![
        FolderEntry::Item(FusionItem {
            id: item_id("bracket"),
            name: "Bracket".into(),
            latest_version: Some(1),
        }),
        FolderEntry::Item(FusionItem {
            id: item_id("hinge"),
            name: "Hinge".into(),
            latest_version: Some(1),
        }),
    ];
    let folder = ApsFolderId::parse("urn:adsk.wipprod:fs.folder:co.plans").unwrap();

    let page = world
        .service()
        .browse(
            &user(),
            BrowseAt::Folder {
                project: project(),
                folder,
                page: 0,
            },
        )
        .await
        .unwrap();

    assert_eq!(
        page.entries,
        vec![
            BrowseEntry::Item {
                id: item_id("bracket"),
                name: "Bracket".into(),
                latest_version: Some(1),
                tracked: Some(TrackedView {
                    document_id: first.items[0].document_id,
                    imported_versions: 1,
                }),
            },
            BrowseEntry::Item {
                id: item_id("hinge"),
                name: "Hinge".into(),
                latest_version: Some(1),
                tracked: None,
            },
        ]
    );
}

#[tokio::test]
async fn the_import_is_refused_with_the_flag_off() {
    let world = World::with_items(&[("bracket", 1)]);
    let service = world.service_flagged(false);

    let browse = service.browse(&user(), BrowseAt::Hubs).await.unwrap_err();
    let import = service
        .import(&user(), project(), vec![item_id("bracket")])
        .await
        .unwrap_err();
    let sync = service
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap_err();

    for error in [browse, import, sync] {
        assert!(matches!(
            error,
            FusionImportError::NotFound(FUSION_IMPORT_OFF)
        ));
    }
    assert_eq!(world.fetched(), 0);
}

#[tokio::test]
async fn the_import_is_refused_without_an_autodesk_connection() {
    let world = World::with_items(&[("bracket", 1)]);
    world.aps.0.lock().unwrap().connected = false;

    let error = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap_err();

    assert!(matches!(error, FusionImportError::NotConnected));
}

#[tokio::test]
async fn an_import_names_one_to_twenty_items() {
    let world = World::with_items(&[]);
    let too_many = (0..21).map(|n| item_id(&format!("part-{n}"))).collect();

    let none = world.service().import(&user(), project(), vec![]).await;
    let over = world.service().import(&user(), project(), too_many).await;

    assert!(matches!(none, Err(FusionImportError::InvalidRequest(_))));
    assert!(matches!(over, Err(FusionImportError::InvalidRequest(_))));
}

/// Track `names` without importing them, as an import whose budget ran out
/// leaves them.
async fn track(world: &World, names: &[&str]) {
    for name in names {
        world
            .repo
            .track(&user(), &item_id(name), &project(), Uuid::now_v7())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a_sync_of_everything_continues_from_the_first_item_with_work() {
    let world = World::with_items(&[("a-bracket", 8), ("b-hinge", 8)]);
    track(&world, &["a-bracket", "b-hinge"]).await;

    let first = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let second = world
        .service()
        .sync(
            &user(),
            SyncScope::All {
                from: first.next_cursor.clone(),
            },
        )
        .await
        .unwrap();

    assert_eq!(first.items[0].imported_now, 8);
    assert_eq!(first.items[1].imported_now, 2);
    assert_eq!(first.next_cursor, Some(item_id("b-hinge")));
    // The second page starts at the hinge; the bracket is not listed again.
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].item_id, item_id("b-hinge"));
    assert_eq!(second.items[0].imported_now, 6);
    assert_eq!(second.next_cursor, None);
}

#[tokio::test]
async fn a_sync_of_everything_pages_fifty_items_at_a_time() {
    let names: Vec<String> = (0..51).map(|n| format!("part-{n:02}")).collect();
    let items: Vec<(&str, u32)> = names.iter().map(|name| (name.as_str(), 0)).collect();
    let world = World::with_items(&items);
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    track(&world, &names).await;

    let first = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let second = world
        .service()
        .sync(
            &user(),
            SyncScope::All {
                from: first.next_cursor.clone(),
            },
        )
        .await
        .unwrap();

    assert_eq!(first.items.len(), 50);
    assert_eq!(first.next_cursor, Some(item_id("part-50")));
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.next_cursor, None);
}

#[tokio::test]
async fn a_sync_of_named_items_has_no_cursor() {
    let world = World::with_items(&[("bracket", 12)]);
    track(&world, &["bracket"]).await;

    let report = world
        .service()
        .sync(&user(), SyncScope::Items(vec![item_id("bracket")]))
        .await
        .unwrap();

    assert_eq!(report.remaining, 2);
    assert_eq!(report.next_cursor, None);
}

#[tokio::test]
async fn a_fusion_design_version_imports_as_an_f3d_document() {
    let world = World::with_items(&[("bracket", 0)]);
    let design = FusionVersion {
        extension: Some("f3d".into()),
        storage: Some(StorageObject {
            bucket_key: "wip.dm.prod".into(),
            object_key: "bracket-v1.f3d".into(),
        }),
        ..stl("bracket", 1)
    };
    world.add_version(design, "bracket");

    let report = import(&world, &["bracket"]).await;

    assert_eq!(report.items[0].imported_now, 1);
    let (_, file_type, versions) = &world.documents.contents()[0];
    assert_eq!(*file_type, FileType::F3d);
    assert_eq!(*versions, vec![bytes_of("bracket", 1)]);
}

#[tokio::test]
async fn a_version_of_unknown_type_is_not_recorded_and_is_tried_again() {
    let world = World::with_items(&[("bracket", 2)]);
    let unknown = FusionVersion {
        extension: None,
        ..stl("bracket", 3)
    };
    world.add_version(unknown, "bracket");

    let first = import(&world, &["bracket"]).await;
    let again = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();

    assert_eq!(first.items[0].imported_now, 2);
    assert_eq!(first.items[0].unidentified, vec![3]);
    assert_eq!(first.items[0].skipped, vec![]);
    assert_eq!(first.items[0].remaining, 0);
    assert_eq!(world.repo.row(&item_id("bracket")).versions.len(), 2);
    // Still unrecorded, so a sync looks at it again rather than writing it off.
    assert_eq!(again.items[0].unidentified, vec![3]);
    assert_eq!(world.fetched(), 2);
}

#[tokio::test]
async fn a_document_trashed_before_its_creation_was_recorded_is_replaced_by_import() {
    let world = World::with_items(&[("bracket", 1)]);
    world.documents.0.lock().unwrap().crash_after_create = true;
    import(&world, &["bracket"]).await;
    let orphan = world.repo.row(&item_id("bracket")).item.document_id;
    world
        .documents
        .0
        .lock()
        .unwrap()
        .documents
        .get_mut(&orphan)
        .unwrap()
        .live = false;

    let synced = world
        .service()
        .sync(&user(), SyncScope::All { from: None })
        .await
        .unwrap();
    let reimported = import(&world, &["bracket"]).await;

    assert_eq!(synced.items[0].status, ItemStatus::DocumentGone);
    assert_eq!(reimported.items[0].status, ItemStatus::Synced);
    assert_ne!(reimported.items[0].document_id, Some(orphan));
    assert_eq!(reimported.items[0].imported_now, 1);
}
