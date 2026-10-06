use std::sync::{Arc, Mutex};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use model_owner::Owner;
use sqlx::PgPool;
use uuid::Uuid;

use super::LegacyDocumentPurgeRepository;
use crate::domain::{
    models::DocumentError,
    purge::{
        DocumentPurgeQueue, DocumentPurgeRepository, DocumentPurgeService, DocumentPurger,
        DocxPartReferences,
    },
};

const DOCX: &str = "93000000-0000-0000-0000-000000000011";

struct CapturingQueue {
    pool: PgPool,
    documents: Mutex<Vec<(String, Owner)>>,
}

impl DocumentPurgeQueue for Arc<CapturingQueue> {
    async fn enqueue(&self, document_id: String, owner: Owner) -> Result<(), DocumentError> {
        // The rows outlive the enqueue, so a purge that fails later can be retried.
        let stored = macro_db_client::document::get_deleted_document_info(&self.pool, &document_id)
            .await
            .unwrap();
        assert_eq!(stored.owner, owner);
        self.documents.lock().unwrap().push((document_id, owner));
        Ok(())
    }
}

struct RecordingPartReferences {
    pool: PgPool,
    released: Mutex<Vec<Vec<String>>>,
}

impl DocxPartReferences for Arc<RecordingPartReferences> {
    async fn release(&self, mut shas: Vec<String>) -> Result<(), DocumentError> {
        let deleted = macro_db_client::document::get_deleted_document_info(&self.pool, DOCX).await;
        assert!(matches!(deleted, Err(sqlx::Error::RowNotFound)));
        shas.sort();
        self.released.lock().unwrap().push(shas);
        Ok(())
    }
}

struct Fixture {
    queue: Arc<CapturingQueue>,
    part_references: Arc<RecordingPartReferences>,
    purger: DocumentPurger<
        LegacyDocumentPurgeRepository,
        Arc<CapturingQueue>,
        Arc<RecordingPartReferences>,
        NoopMacroEventBroker,
    >,
}

fn fixture(pool: &PgPool) -> Fixture {
    let queue = Arc::new(CapturingQueue {
        pool: pool.clone(),
        documents: Mutex::default(),
    });
    let part_references = Arc::new(RecordingPartReferences {
        pool: pool.clone(),
        released: Mutex::default(),
    });
    let purger = DocumentPurger::new(
        LegacyDocumentPurgeRepository::new(pool.clone()),
        queue.clone(),
        part_references.clone(),
        NoopMacroEventBroker,
    );
    Fixture {
        queue,
        part_references,
        purger,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../entity_access/fixtures",
        scripts("typed_owner_team")
    )
)]
async fn queues_the_stored_owner_before_deleting_the_document(pool: PgPool) {
    let fixture = fixture(&pool);
    let expected = [
        (
            "90000000-0000-0000-0000-000000000031",
            "macro|typed-owner@example.com",
        ),
        (
            "90000000-0000-0000-0000-000000000033",
            "90000000-0000-0000-0000-000000000011",
        ),
        (
            "90000000-0000-0000-0000-000000000034",
            "bot|90000000-0000-0000-0000-000000000021",
        ),
    ];
    for (id, _) in expected {
        fixture
            .purger
            .purge(Uuid::parse_str(id).unwrap())
            .await
            .unwrap();
    }
    assert_eq!(
        *fixture.queue.documents.lock().unwrap(),
        expected.map(|(id, owner)| (id.to_owned(), Owner::from_principal_str(owner).unwrap()))
    );
    let repository = LegacyDocumentPurgeRepository::new(pool);
    for (id, _) in expected {
        assert_eq!(repository.find(id).await.unwrap(), None);
    }
    assert!(fixture.part_references.released.lock().unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("docx_purge"))
)]
async fn releases_each_docx_part_reference_once_the_rows_are_gone(pool: PgPool) {
    let fixture = fixture(&pool);
    fixture
        .purger
        .purge(Uuid::parse_str(DOCX).unwrap())
        .await
        .unwrap();
    assert_eq!(
        *fixture.part_references.released.lock().unwrap(),
        vec![vec![
            "sha-a".to_owned(),
            "sha-a".to_owned(),
            "sha-b".to_owned()
        ]]
    );
    assert!(
        macro_db_client::document::get_bom_parts(&pool, DOCX)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purge_of_a_missing_document_is_ok(pool: PgPool) {
    let fixture = fixture(&pool);
    fixture.purger.purge(Uuid::now_v7()).await.unwrap();
    assert!(fixture.queue.documents.lock().unwrap().is_empty());
}
