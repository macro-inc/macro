use std::sync::{Arc, Mutex};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use model_owner::Owner;
use sqlx::PgPool;
use uuid::Uuid;

use super::LegacyDocumentPurgeRepository;
use crate::domain::{
    models::DocumentError,
    purge::{DocumentPurgeQueue, DocumentPurgeService, DocumentPurger},
};

struct CapturingQueue {
    pool: PgPool,
    documents: Mutex<Vec<(String, Owner)>>,
}

impl DocumentPurgeQueue for Arc<CapturingQueue> {
    async fn enqueue(&self, document_id: String, owner: Owner) -> Result<(), DocumentError> {
        // The worker can no longer resolve ownership from the database at this point.
        let deleted =
            macro_db_client::document::get_deleted_document_info(&self.pool, &document_id).await;
        assert!(matches!(deleted, Err(sqlx::Error::RowNotFound)));
        self.documents.lock().unwrap().push((document_id, owner));
        Ok(())
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../entity_access/fixtures",
        scripts("typed_owner_team")
    )
)]
async fn queues_the_stored_owner_after_document_metadata_is_gone(pool: PgPool) {
    let queue = Arc::new(CapturingQueue {
        pool: pool.clone(),
        documents: Mutex::default(),
    });
    let purger = DocumentPurger::new(
        LegacyDocumentPurgeRepository::new(pool),
        queue.clone(),
        NoopMacroEventBroker,
    );
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
        purger.purge(Uuid::parse_str(id).unwrap()).await.unwrap();
    }
    assert_eq!(
        *queue.documents.lock().unwrap(),
        expected.map(|(id, owner)| (id.to_owned(), Owner::from_principal_str(owner).unwrap()))
    );
}
