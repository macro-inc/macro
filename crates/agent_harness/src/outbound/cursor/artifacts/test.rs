use std::collections::BTreeSet;
use std::sync::Mutex;

use bytes::Bytes;
use cursor_cloud_agents::api::wire::ArtifactListing;
use cursor_cloud_agents::domain::model::CursorAgentId;
use macro_user_id::user_id::MacroUserIdStr;

use agent_session::domain::model::ExternalSession;

use super::{
    CursorArtifactApi, CursorArtifactApis, CursorArtifacts, FetchedArtifact, MAX_ARTIFACT_BYTES,
};
use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::{ArtifactSource, ArtifactStore, ArtifactUpload, StoredArtifact};
use crate::outbound::cursor::manager::CURSOR_PROVIDER;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("collector@macro.com").expect("a valid email")
}

fn cursor_session() -> ExternalSession {
    ExternalSession {
        provider: CURSOR_PROVIDER.to_owned(),
        external_id: "bc-1".to_owned(),
        external_name: None,
        external_url: None,
        last_run_id: None,
    }
}

fn listing(path: &str, updated_at: &str, size_bytes: u64) -> ArtifactListing {
    serde_json::from_value(serde_json::json!({
        "path": path,
        "sizeBytes": size_bytes,
        "updatedAt": updated_at,
    }))
    .expect("an artifact listing")
}

/// A stand-in Cursor whose files are declared up front, with the option of
/// failing one download.
#[derive(Default)]
struct FakeCursor {
    files: Vec<(ArtifactListing, Option<String>, Bytes)>,
    failing_path: Option<String>,
    fetched: Mutex<Vec<String>>,
}

impl FakeCursor {
    fn with(files: Vec<(ArtifactListing, Option<String>, Bytes)>) -> Self {
        Self {
            files,
            ..Self::default()
        }
    }

    fn failing(mut self, path: &str) -> Self {
        self.failing_path = Some(path.to_owned());
        self
    }

    fn find(&self, path: &str) -> &(ArtifactListing, Option<String>, Bytes) {
        self.files
            .iter()
            .find(|(listing, _, _)| listing.path == path)
            .expect("a listed artifact")
    }
}

impl CursorArtifactApi for &FakeCursor {
    async fn list(&self, _agent: &CursorAgentId) -> Result<Vec<ArtifactListing>> {
        Ok(self
            .files
            .iter()
            .map(|(item, _, _)| listing(&item.path, &item.updated_at, item.size_bytes))
            .collect())
    }

    async fn download_url(&self, _agent: &CursorAgentId, path: &str) -> Result<String> {
        Ok(format!("https://s3.test/{path}?sig=1"))
    }

    async fn fetch(&self, url: &str) -> Result<FetchedArtifact> {
        let path = url
            .strip_prefix("https://s3.test/")
            .and_then(|rest| rest.split('?').next())
            .expect("a url this fake minted")
            .to_owned();
        if self.failing_path.as_deref() == Some(path.as_str()) {
            return Err(HarnessError::Artifacts(rootcause::report!("s3 said no")));
        }
        self.fetched.lock().expect("fetch log").push(path.clone());
        let (_, content_type, bytes) = self.find(&path);
        Ok(FetchedArtifact {
            content_type: content_type.clone(),
            bytes: bytes.clone(),
        })
    }
}

/// An API source that records whether a key was ever asked for.
struct FakeApis<'cursor> {
    cursor: &'cursor FakeCursor,
    resolutions: Mutex<usize>,
}

impl<'cursor> FakeApis<'cursor> {
    fn new(cursor: &'cursor FakeCursor) -> Self {
        Self {
            cursor,
            resolutions: Mutex::new(0),
        }
    }

    fn resolutions(&self) -> usize {
        *self.resolutions.lock().expect("resolution count")
    }
}

impl CursorArtifactApis for &'static FakeApis<'static> {
    type Api = &'static FakeCursor;

    async fn api_for(&self, _owner: &MacroUserIdStr<'_>) -> Result<Self::Api> {
        *self.resolutions.lock().expect("resolution count") += 1;
        Ok(self.cursor)
    }
}

/// A store that hands back a permalink and remembers what it was given.
#[derive(Default)]
struct FakeStore {
    uploads: Mutex<Vec<ArtifactUpload>>,
}

impl FakeStore {
    fn uploads(&self) -> Vec<ArtifactUpload> {
        self.uploads.lock().expect("upload log").clone()
    }
}

impl ArtifactStore for &'static FakeStore {
    async fn store(&self, upload: ArtifactUpload) -> Result<StoredArtifact> {
        let uri = format!("https://files.macro.com/file/{}", upload.file_name);
        self.uploads.lock().expect("upload log").push(upload);
        Ok(StoredArtifact { uri })
    }
}

/// Leaks the fixtures so the adapter's `'static` bounds are satisfiable
/// without an `Arc` dance in every test.
fn harness(
    cursor: FakeCursor,
    store: FakeStore,
) -> (
    &'static FakeApis<'static>,
    &'static FakeStore,
    CursorArtifacts<&'static FakeApis<'static>, &'static FakeStore>,
) {
    let cursor: &'static FakeCursor = Box::leak(Box::new(cursor));
    let apis: &'static FakeApis<'static> = Box::leak(Box::new(FakeApis::new(cursor)));
    let store: &'static FakeStore = Box::leak(Box::new(store));
    let collector = CursorArtifacts::with_apis(apis, store);
    (apis, store, collector)
}

fn png(name: &str, updated_at: &str) -> (ArtifactListing, Option<String>, Bytes) {
    (
        listing(&format!("artifacts/{name}"), updated_at, 3),
        Some("image/png".to_owned()),
        Bytes::from_static(b"png"),
    )
}

#[tokio::test]
async fn skips_artifacts_whose_keys_are_already_logged() {
    let (_, store, collector) = harness(
        FakeCursor::with(vec![
            png("one.png", "2026-09-15T00:00:01Z"),
            png("two.png", "2026-09-15T00:00:02Z"),
        ]),
        FakeStore::default(),
    );
    let known = BTreeSet::from(["artifacts/one.png@2026-09-15T00:00:01Z".to_owned()]);

    let collected = collector
        .collect(&owner(), &cursor_session(), &known)
        .await
        .expect("a collection");

    assert_eq!(
        collected
            .iter()
            .map(|artifact| artifact.key.as_str())
            .collect::<Vec<_>>(),
        vec!["artifacts/two.png@2026-09-15T00:00:02Z"]
    );
    assert_eq!(store.uploads().len(), 1);
}

#[tokio::test]
async fn a_repeated_path_written_again_is_a_new_artifact() {
    let (_, _, collector) = harness(
        FakeCursor::with(vec![png("shot.png", "2026-09-15T00:00:09Z")]),
        FakeStore::default(),
    );
    let known = BTreeSet::from(["artifacts/shot.png@2026-09-15T00:00:01Z".to_owned()]);

    let collected = collector
        .collect(&owner(), &cursor_session(), &known)
        .await
        .expect("a collection");

    assert_eq!(collected.len(), 1);
}

#[tokio::test]
async fn orders_by_write_time_then_path() {
    let (_, _, collector) = harness(
        FakeCursor::with(vec![
            png("later.png", "2026-09-15T00:00:09Z"),
            png("b.png", "2026-09-15T00:00:01Z"),
            png("a.png", "2026-09-15T00:00:01Z"),
        ]),
        FakeStore::default(),
    );

    let collected = collector
        .collect(&owner(), &cursor_session(), &BTreeSet::new())
        .await
        .expect("a collection");

    assert_eq!(
        collected
            .iter()
            .map(|artifact| artifact.name.as_str())
            .collect::<Vec<_>>(),
        vec!["a.png", "b.png", "later.png"]
    );
}

#[tokio::test]
async fn another_provider_is_not_cursors_business() {
    let (apis, _, collector) = harness(
        FakeCursor::with(vec![png("one.png", "2026-09-15T00:00:01Z")]),
        FakeStore::default(),
    );
    let external = ExternalSession {
        provider: "codex".to_owned(),
        ..cursor_session()
    };

    let collected = collector
        .collect(&owner(), &external, &BTreeSet::new())
        .await
        .expect("a collection");

    assert!(collected.is_empty());
    assert_eq!(
        apis.resolutions(),
        0,
        "no key is resolved for another provider"
    );
}

#[tokio::test]
async fn an_oversized_file_is_skipped_rather_than_buffered() {
    let (_, store, collector) = harness(
        FakeCursor::with(vec![
            (
                listing(
                    "artifacts/walkthrough.mp4",
                    "2026-09-15T00:00:01Z",
                    MAX_ARTIFACT_BYTES + 1,
                ),
                Some("video/mp4".to_owned()),
                Bytes::from_static(b"mp4"),
            ),
            png("after.png", "2026-09-15T00:00:02Z"),
        ]),
        FakeStore::default(),
    );

    let collected = collector
        .collect(&owner(), &cursor_session(), &BTreeSet::new())
        .await
        .expect("a collection");

    assert_eq!(
        collected
            .iter()
            .map(|artifact| artifact.name.as_str())
            .collect::<Vec<_>>(),
        vec!["after.png"]
    );
    assert_eq!(store.uploads().len(), 1);
}

#[tokio::test]
async fn one_failed_download_does_not_sink_the_batch() {
    let (_, _, collector) = harness(
        FakeCursor::with(vec![
            png("one.png", "2026-09-15T00:00:01Z"),
            png("two.png", "2026-09-15T00:00:02Z"),
            png("three.png", "2026-09-15T00:00:03Z"),
        ])
        .failing("artifacts/two.png"),
        FakeStore::default(),
    );

    let collected = collector
        .collect(&owner(), &cursor_session(), &BTreeSet::new())
        .await
        .expect("a collection");

    assert_eq!(
        collected
            .iter()
            .map(|artifact| artifact.name.as_str())
            .collect::<Vec<_>>(),
        vec!["one.png", "three.png"]
    );
}

#[tokio::test]
async fn an_uninformative_content_type_falls_back_to_the_extension() {
    let (_, _, collector) = harness(
        FakeCursor::with(vec![
            (
                listing("artifacts/clip.mp4", "2026-09-15T00:00:01Z", 3),
                Some("binary/octet-stream".to_owned()),
                Bytes::from_static(b"mp4"),
            ),
            (
                listing("artifacts/notes.unknown", "2026-09-15T00:00:02Z", 3),
                None,
                Bytes::from_static(b"raw"),
            ),
        ]),
        FakeStore::default(),
    );

    let collected = collector
        .collect(&owner(), &cursor_session(), &BTreeSet::new())
        .await
        .expect("a collection");

    assert_eq!(
        collected
            .iter()
            .map(|artifact| artifact.mime_type.as_str())
            .collect::<Vec<_>>(),
        vec!["video/mp4", "application/octet-stream"]
    );
}

#[tokio::test]
async fn the_store_receives_the_file_and_answers_the_uri() {
    let (_, store, collector) = harness(
        FakeCursor::with(vec![(
            listing("artifacts/nested/shot.png", "2026-09-15T00:00:01Z", 3),
            Some("image/png; charset=binary".to_owned()),
            Bytes::from_static(b"png"),
        )]),
        FakeStore::default(),
    );

    let collected = collector
        .collect(&owner(), &cursor_session(), &BTreeSet::new())
        .await
        .expect("a collection");

    let uploads = store.uploads();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].file_name, "shot.png");
    assert_eq!(uploads[0].mime_type, "image/png");
    assert_eq!(uploads[0].bytes.as_ref(), b"png");

    let artifact = &collected[0];
    assert_eq!(artifact.uri, "https://files.macro.com/file/shot.png");
    assert_eq!(artifact.name, "shot.png");
    assert_eq!(artifact.size_bytes, 3);
    assert_eq!(
        artifact.key,
        "artifacts/nested/shot.png@2026-09-15T00:00:01Z"
    );
}
