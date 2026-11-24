//! `DocumentCreator::add_file_version` against the real repository.
use entity_registry::{BotFacts, EntityRegistryResult, OwnerGrantPolicy};
use entity_registry_db_utils::OwnedEntityRegistrar;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::create::{
    AddedFileVersion, DocumentCreator, NewDocumentMetadata, NonMarkdownFileType,
    file_version::MAX_FILE_VERSION_BYTES,
};
use crate::domain::ports::create::{DocumentBytesUpload, DocumentBytesUploadPort};
use crate::outbound::pg_document_repo::PgDocumentRepo;

struct NoBots;

impl BotFacts for NoBots {
    async fn sponsor(&self, _: bot_id::BotId) -> EntityRegistryResult<Option<Owner>> {
        Ok(None)
    }
}

/// Records each upload's URL and bytes; fails every upload once `fail` is set.
#[derive(Clone, Default)]
struct StoredBytes {
    uploads: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
    fail: Arc<std::sync::atomic::AtomicBool>,
}

impl DocumentBytesUploadPort for StoredBytes {
    async fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "storage unavailable"
            )));
        }
        self.uploads
            .lock()
            .unwrap()
            .push((upload.presigned_url, upload.bytes));
        Ok(())
    }
}

type FileVersionService = DocumentServiceImpl<
    PgDocumentRepo<NoBots>,
    RecordingUploadUrlPort,
    TestTaskPropertiesPort,
    TestConnectionService,
    TestEntityAccessManagementService,
    TestForeignEntityService,
    TestEventBroker,
    sync_service_client::SyncServiceClient,
>;

struct Harness {
    service: Arc<FileVersionService>,
    creator: DocumentCreator<
        Arc<FileVersionService>,
        RejectUnexpectedFinalization,
        StoredBytes,
        RejectUnexpectedFinalization,
    >,
    presigned: RecordingUploadUrlPort,
    stored: StoredBytes,
    pool: PgPool,
}

fn harness(pool: PgPool) -> Harness {
    let presigned = RecordingUploadUrlPort::default();
    let service = Arc::new(DocumentServiceImpl::new(
        PgDocumentRepo::new(
            pool.clone(),
            OwnedEntityRegistrar::new(OwnerGrantPolicy::new(NoBots)),
        ),
        test_cloudfront_config(),
        sync_service_client::SyncServiceClient::new(
            "test-sync-key".to_string(),
            "http://sync-service.test".to_string(),
        ),
        presigned.clone(),
        TestTaskPropertiesPort,
        TestConnectionService::default(),
        TestEntityAccessManagementService::default(),
        TestForeignEntityService::default(),
        TestEventBroker::default(),
    ));
    let stored = StoredBytes::default();
    let creator = DocumentCreator::new(
        service.clone(),
        RejectUnexpectedFinalization,
        stored.clone(),
        RejectUnexpectedFinalization,
    );
    Harness {
        service,
        creator,
        presigned,
        stored,
        pool,
    }
}

impl Harness {
    async fn create(&self, file_type: FileType, bytes: &[u8]) -> (String, i64) {
        let created = self
            .creator
            .create_file(
                &CreationPrincipal::User(test_user()),
                NewDocumentMetadata::new("design"),
                NonMarkdownFileType::new(file_type).unwrap(),
                bytes.to_vec(),
            )
            .await
            .unwrap();
        (
            created.document_id().to_string(),
            created.document_version_id(),
        )
    }

    async fn instance_ids(&self, document_id: &str) -> Vec<i64> {
        sqlx::query_scalar!(
            r#"SELECT id FROM "DocumentInstance" WHERE "documentId" = $1 ORDER BY id"#,
            document_id
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

fn editor(document_id: &str) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        test_user(),
        document_id,
        EntityType::Document,
    )
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn a_new_version_is_the_one_served(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::F3d, b"version one").await;

    let added = harness
        .creator
        .add_file_version(editor(&document_id), b"version two".to_vec())
        .await
        .unwrap();

    assert!(added.created);
    assert_ne!(added.document_version_id, first);
    assert_eq!(
        harness.instance_ids(&document_id).await,
        [first, added.document_version_id]
    );

    let served = harness
        .service
        .get_document(authenticated_receipt(&document_id))
        .await
        .unwrap();
    assert_eq!(
        served.document_metadata.metadata.document_version_id,
        added.document_version_id
    );
    let (latest, _) = harness
        .service
        .repo
        .get_latest_document_version_id(&document_id)
        .await
        .unwrap();
    assert_eq!(latest, added.document_version_id);

    let key = build_cloud_storage_bucket_document_key(
        &Owner::User(test_user()),
        &document_id,
        added.document_version_id,
    );
    let presigned = harness.presigned.uploads.lock().unwrap().clone();
    assert_eq!(presigned.last().map(|(key, _)| key), Some(&key));
    let stored = harness.stored.uploads.lock().unwrap().clone();
    assert_eq!(
        stored.last().map(|(_, bytes)| bytes.as_slice()),
        Some(&b"version two"[..])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn the_same_bytes_again_answer_the_newest_version(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::Step, b"version one").await;

    let unchanged = harness
        .creator
        .add_file_version(editor(&document_id), b"version one".to_vec())
        .await
        .unwrap();
    assert_eq!(
        unchanged,
        AddedFileVersion {
            document_version_id: first,
            created: false,
        }
    );

    let added = harness
        .creator
        .add_file_version(editor(&document_id), b"version two".to_vec())
        .await
        .unwrap();
    let again = harness
        .creator
        .add_file_version(editor(&document_id), b"version two".to_vec())
        .await
        .unwrap();

    assert_eq!(
        again,
        AddedFileVersion {
            document_version_id: added.document_version_id,
            created: false,
        }
    );
    assert_eq!(
        harness.instance_ids(&document_id).await,
        [first, added.document_version_id]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn documents_that_serve_their_first_version_are_refused(pool: PgPool) {
    let harness = harness(pool);

    for file_type in [FileType::Pdf, FileType::Png] {
        let (document_id, first) = harness.create(file_type, b"original").await;

        let refused = harness
            .creator
            .add_file_version(editor(&document_id), b"replacement".to_vec())
            .await;

        assert!(
            matches!(refused, Err(DocumentError::BadRequest(_))),
            "{file_type}: {refused:?}"
        );
        assert_eq!(harness.instance_ids(&document_id).await, [first]);
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn a_receipt_for_another_entity_is_refused(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::Stl, b"original").await;

    // The edit requirement itself is the receipt's type: a caller without
    // edit access cannot mint an `EditAccessLevel` receipt. What remains to
    // refuse is edit access to something other than the document.
    let project_receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        test_user(),
        &document_id,
        EntityType::Project,
    );
    let refused = harness
        .creator
        .add_file_version(project_receipt, b"replacement".to_vec())
        .await;

    assert!(matches!(refused, Err(DocumentError::BadRequest(_))));
    assert_eq!(harness.instance_ids(&document_id).await, [first]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn more_than_the_limit_is_refused(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::Igs, b"original").await;

    let refused = harness
        .creator
        .add_file_version(editor(&document_id), vec![0; MAX_FILE_VERSION_BYTES + 1])
        .await;

    assert!(matches!(refused, Err(DocumentError::BadRequest(_))));
    assert_eq!(harness.instance_ids(&document_id).await, [first]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn a_failed_upload_leaves_no_version(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::F3z, b"version one").await;
    harness
        .stored
        .fail
        .store(true, std::sync::atomic::Ordering::SeqCst);

    let failed = harness
        .creator
        .add_file_version(editor(&document_id), b"version two".to_vec())
        .await;
    assert!(matches!(failed, Err(DocumentError::Internal(_))));
    assert_eq!(harness.instance_ids(&document_id).await, [first]);

    // A failed re-upload of bytes the newest version already holds keeps it.
    let failed_again = harness
        .creator
        .add_file_version(editor(&document_id), b"version one".to_vec())
        .await;
    assert!(matches!(failed_again, Err(DocumentError::Internal(_))));
    assert_eq!(harness.instance_ids(&document_id).await, [first]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_test_data"))
)]
async fn a_trashed_document_is_not_found(pool: PgPool) {
    let harness = harness(pool);
    let (document_id, first) = harness.create(FileType::Iges, b"version one").await;
    harness
        .service
        .repo
        .soft_delete_document(&document_id)
        .await
        .unwrap();

    let refused = harness
        .creator
        .add_file_version(editor(&document_id), b"version two".to_vec())
        .await;

    assert!(matches!(refused, Err(DocumentError::NotFound(_))));
    assert_eq!(harness.instance_ids(&document_id).await, [first]);
}
