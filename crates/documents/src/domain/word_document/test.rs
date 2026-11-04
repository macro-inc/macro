use super::*;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use std::collections::VecDeque;
use std::sync::Mutex;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813c";
const SECRET: &str = "local-word-document-test-secret";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|words@macro.com".to_owned()).unwrap()
}

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

fn lookup(file_type: &str) -> MockWordDocumentLookup {
    let mut lookup = MockWordDocumentLookup::new();
    let file_type = file_type.to_owned();
    lookup
        .expect_file_type()
        .withf(|id| id == DOCUMENT)
        .times(1)
        .returning(move |_| {
            let file_type = file_type.clone();
            Box::pin(async move { Ok(Some(file_type)) })
        });
    lookup
}

/// The sync service: answers `exists` in turn (repeating the last answer)
/// and records the snapshots it was asked to store.
struct FakeSync {
    exists: Mutex<VecDeque<bool>>,
    accept: bool,
    initialized: Mutex<Vec<Vec<u8>>>,
}

impl FakeSync {
    fn new(exists: &[bool], accept: bool) -> Self {
        Self {
            exists: Mutex::new(exists.iter().copied().collect()),
            accept,
            initialized: Mutex::default(),
        }
    }
}

impl SyncServiceProbe for FakeSync {
    async fn exists(&self, document_id: &str) -> anyhow::Result<bool> {
        assert_eq!(document_id, DOCUMENT);
        let mut answers = self.exists.lock().unwrap();
        Ok(if answers.len() > 1 {
            answers.pop_front().unwrap()
        } else {
            answers[0]
        })
    }
}

impl SyncInitializeSnapshotPort for FakeSync {
    async fn initialize_from_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> anyhow::Result<()> {
        assert_eq!(document_id, DOCUMENT);
        self.initialized.lock().unwrap().push(snapshot.to_vec());
        anyhow::ensure!(self.accept, "snapshot already exists");
        Ok(())
    }
}

/// The uploaded file, or `None` while it is still being extracted.
struct FakeFiles(Option<&'static [u8]>);

#[async_trait::async_trait]
impl WordDocumentFiles for FakeFiles {
    async fn original(&self, document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        assert_eq!(document_id, DOCUMENT);
        Ok(self.0.map(<[u8]>::to_vec))
    }
}

const NDA: &[u8] = include_bytes!("../../../../docx_engine/tests/fixtures/mutual-nda.docx");

/// A service over a document whose live copy already exists.
fn word_service(
    lookup: Arc<MockWordDocumentLookup>,
    worker: Arc<MockEditingWorkerService>,
) -> WordDocumentService<MockWordDocumentLookup, MockEditingWorkerService, FakeSync> {
    WordDocumentService::new(
        lookup,
        worker,
        Arc::new(FakeSync::new(&[true], true)),
        Arc::new(NoWordDocumentFiles),
        SECRET.into(),
    )
}

fn reading_worker(times: usize) -> MockEditingWorkerService {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_word_document()
        .times(times)
        .returning(|_, _, _| Box::pin(async { Ok(response("Word document with 3 blocks.")) }));
    worker
}

async fn read_through(
    sync: Arc<FakeSync>,
    files: FakeFiles,
    worker: MockEditingWorkerService,
) -> anyhow::Result<WordDocumentResponse> {
    WordDocumentService::new(
        Arc::new(lookup("docx")),
        Arc::new(worker),
        sync,
        Arc::new(files),
        SECRET.into(),
    )
    .read(
        receipt(AccessLevel::View),
        &user(),
        "macro|ai@macro.com",
        None,
        None,
    )
    .await
}

#[tokio::test]
async fn a_document_nobody_opened_is_seeded_before_the_worker_reads_it() {
    let sync = Arc::new(FakeSync::new(&[false], true));
    read_through(sync.clone(), FakeFiles(Some(NDA)), reading_worker(1))
        .await
        .unwrap();
    let initialized = sync.initialized.lock().unwrap();
    assert_eq!(initialized.len(), 1);
    let live = loro::LoroDoc::new();
    live.import(&initialized[0]).unwrap();
    assert_eq!(
        live.get_map("docxMeta")
            .get("formatVersion")
            .unwrap()
            .into_value()
            .unwrap(),
        loro::LoroValue::Double(2.0)
    );
}

#[tokio::test]
async fn an_existing_live_copy_is_never_seeded_again() {
    let sync = Arc::new(FakeSync::new(&[true], false));
    read_through(sync.clone(), FakeFiles(None), reading_worker(1))
        .await
        .unwrap();
    assert!(sync.initialized.lock().unwrap().is_empty());
}

#[tokio::test]
async fn losing_the_seeding_race_to_an_editor_still_reaches_the_worker() {
    let sync = Arc::new(FakeSync::new(&[false, true], false));
    read_through(sync.clone(), FakeFiles(Some(NDA)), reading_worker(1))
        .await
        .unwrap();
    assert_eq!(sync.initialized.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_failed_seed_never_reaches_the_worker() {
    let sync = Arc::new(FakeSync::new(&[false], false));
    let error = read_through(sync, FakeFiles(Some(NDA)), reading_worker(0))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "snapshot already exists");
}

#[tokio::test]
async fn an_upload_still_being_extracted_asks_to_retry() {
    let sync = Arc::new(FakeSync::new(&[false], true));
    let error = read_through(sync.clone(), FakeFiles(None), reading_worker(0))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("still being processed"));
    assert!(sync.initialized.lock().unwrap().is_empty());
}

fn response(content: &str) -> WordDocumentResponse {
    WordDocumentResponse {
        content: content.to_owned(),
    }
}

fn claims(token: &macro_sync_service_jwt::DocumentPermissionToken) -> serde_json::Value {
    macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap()
}

fn rename(paragraph: &str) -> WordDocumentOperation {
    WordDocumentOperation::ReplaceText {
        paragraph: paragraph.to_owned(),
        find: "two".to_owned(),
        replace: "three".to_owned(),
        occurrence: None,
    }
}

#[tokio::test]
async fn reads_mint_only_view_access_for_the_delegated_actor() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_word_document()
        .times(1)
        .returning(|id, token, request| {
            assert_eq!(id, DOCUMENT);
            assert!(matches!(
                request,
                WordDocumentRequest::Read {
                    start: Some(3),
                    count: None
                }
            ));
            let claims = claims(token);
            assert_eq!(claims["document_id"], DOCUMENT);
            assert_eq!(claims["access_level"], "view");
            assert_eq!(claims["user_id"], "macro|words@macro.com");
            assert_eq!(claims["actor"], "macro|ai@macro.com");
            Box::pin(async { Ok(response("Word document with 3 blocks.")) })
        });
    let service = word_service(Arc::new(lookup("docx")), Arc::new(worker));
    let read = service
        .read(
            receipt(AccessLevel::View),
            &user(),
            "macro|ai@macro.com",
            Some(3),
            None,
        )
        .await
        .unwrap();
    assert_eq!(read.content, "Word document with 3 blocks.");
}

/// A docx lookup that knows the requesting user by `name`.
fn named(name: Option<&'static str>) -> MockWordDocumentLookup {
    let mut lookup = lookup("docx");
    lookup
        .expect_display_name()
        .withf(|id| id == "macro|words@macro.com")
        .returning(move |_| Box::pin(async move { Ok(name.map(str::to_owned)) }));
    lookup
}

/// A worker expecting one edit, checking its tracking and author.
fn editing_worker(track: Option<bool>, expected_author: &'static str) -> MockEditingWorkerService {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_word_document()
        .times(1)
        .returning(move |_, token, request| {
            assert_eq!(claims(token)["access_level"], "edit");
            let WordDocumentRequest::Edit {
                operations,
                track_changes,
                author,
            } = request
            else {
                panic!("expected an edit");
            };
            assert_eq!(operations.len(), 2);
            assert_eq!(*track_changes, track);
            assert_eq!(author, expected_author);
            Box::pin(async { Ok(response("Applied 2 operations.")) })
        });
    worker
}

#[tokio::test]
async fn edits_mint_edit_access_and_are_attributed_to_the_user() {
    let service = word_service(
        Arc::new(named(Some("Jacob Beckerman"))),
        Arc::new(editing_worker(Some(true), "Jacob Beckerman")),
    );
    let edited = service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            "macro|ai@macro.com",
            vec![rename("a"), rename("b")],
            WordEditOptions {
                track_changes: Some(true),
                author: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.content, "Applied 2 operations.");
}

#[tokio::test]
async fn a_user_without_a_name_is_named_by_their_email() {
    let service = word_service(
        Arc::new(named(None)),
        Arc::new(editing_worker(None, "words")),
    );
    service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            "macro|ai@macro.com",
            vec![rename("a"), rename("b")],
            WordEditOptions::default(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn an_explicit_author_replaces_the_user() {
    let mut lookup = lookup("docx");
    lookup.expect_display_name().never();
    let service = word_service(
        Arc::new(lookup),
        Arc::new(editing_worker(Some(false), "Acme Legal")),
    );
    service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            "macro|ai@macro.com",
            vec![rename("a"), rename("b")],
            WordEditOptions {
                track_changes: Some(false),
                author: Some("  Acme Legal ".into()),
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn authors_are_one_short_line() {
    for author in ["A\nB".to_owned(), "x".repeat(MAX_AUTHOR_LENGTH + 1)] {
        let mut worker = MockEditingWorkerService::new();
        worker.expect_word_document().never();
        let service = word_service(Arc::new(MockWordDocumentLookup::new()), Arc::new(worker));
        let error = service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                "macro|ai@macro.com",
                vec![rename("a")],
                WordEditOptions {
                    track_changes: None,
                    author: Some(author),
                },
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("author must be one line"));
    }
}

#[tokio::test]
async fn other_file_types_never_reach_the_worker() {
    for file_type in ["md", "pdf", "spreadsheet"] {
        let mut worker = MockEditingWorkerService::new();
        worker.expect_word_document().never();
        let service = word_service(Arc::new(lookup(file_type)), Arc::new(worker));
        let error = service
            .read(
                receipt(AccessLevel::View),
                &user(),
                "macro|ai@macro.com",
                None,
                None,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Word (.docx) documents only"));
    }
}

#[tokio::test]
async fn edits_need_between_one_and_fifty_operations() {
    for operations in [vec![], vec![rename("a"); MAX_OPERATIONS + 1]] {
        let mut worker = MockEditingWorkerService::new();
        worker.expect_word_document().never();
        let service = word_service(Arc::new(MockWordDocumentLookup::new()), Arc::new(worker));
        let error = service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                "macro|ai@macro.com",
                operations,
                WordEditOptions::default(),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("between 1 and 50"));
    }
}

#[test]
fn operations_use_the_worker_wire_format() {
    let request = WordDocumentRequest::Edit {
        operations: vec![
            WordDocumentOperation::InsertParagraph {
                after: Some("p1".into()),
                before: None,
                text: "New".into(),
                style: None,
            },
            WordDocumentOperation::FormatText {
                paragraph: "p1".into(),
                find: None,
                occurrence: None,
                bold: Some(true),
                italic: None,
                underline: None,
                strikethrough: None,
            },
            WordDocumentOperation::AddComment {
                paragraph: "p1".into(),
                find: None,
                occurrence: None,
                text: "Why?".into(),
            },
        ],
        track_changes: Some(true),
        author: "Jacob Beckerman".into(),
    };
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        serde_json::json!({
            "action": "edit",
            "operations": [
                { "type": "insertParagraph", "after": "p1", "text": "New" },
                { "type": "formatText", "paragraph": "p1", "bold": true },
                { "type": "addComment", "paragraph": "p1", "text": "Why?" },
            ],
            "trackChanges": true,
            "author": "Jacob Beckerman",
        })
    );
    assert_eq!(
        serde_json::to_value(WordDocumentRequest::Read {
            start: None,
            count: Some(5)
        })
        .unwrap(),
        serde_json::json!({ "action": "read", "count": 5 })
    );
}

#[test]
fn operations_reject_unknown_types_and_fields() {
    assert!(
        serde_json::from_value::<WordDocumentOperation>(serde_json::json!({
            "type": "runScript", "paragraph": "p1"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<WordDocumentOperation>(serde_json::json!({
            "type": "setText", "paragraph": "p1", "text": "x", "color": "red"
        }))
        .is_err()
    );
}
