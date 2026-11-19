//! The service as hosts build it, over the real databases service, entity
//! access and teams in Postgres: a Granola meeting becomes a row its owner
//! reads, follows the meeting's changes, and goes when the meeting does.

use std::sync::Mutex;

use async_trait::async_trait;
use call::domain::imports::{ImportedCall, ImportedCallPreview, ImportedCallRecord};
use call::domain::records::{CallEntityRecord, CallProvider, ExternalCallId};
use chrono::{TimeZone, Utc};
use databases::domain::models::TableId;
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use import_notion::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, RowsPage, SearchHit,
    SearchObject,
};
use import_notion::domain::ports::{NotionApi, NotionError};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::domain::service::NoopMacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellValue, CellWrite, DatabaseId};
use teams::outbound::team_repo::TeamRepositoryImpl;
use uuid::Uuid;

use super::*;
use crate::domain::models::{GranolaField, NewSync, SyncField, SyncSource, SyncStatus};
use crate::domain::ports::DatabaseSyncsService;

/// Table events no one listens to.
struct Unheard;

impl databases::domain::ports::TableEventPublisher for Unheard {
    type Error = std::convert::Infallible;

    async fn database_changed(&self, _: DatabaseId) -> Result<(), Self::Error> {
        Ok(())
    }

    async fn table_changed(
        &self,
        _: DatabaseId,
        _: TableId,
        _: databases::domain::models::TableVersion,
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    async fn awareness(
        &self,
        _: DatabaseId,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: &databases::domain::models::Awareness,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// The owner's imported Granola meetings.
struct Meetings(Mutex<Vec<ImportedCallRecord>>);

#[async_trait]
impl CallImportService for Meetings {
    async fn ingest(&self, _: ImportedCall) -> Result<Uuid, rootcause::Report> {
        unimplemented!("syncs only read meetings")
    }

    async fn list(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        unimplemented!("syncs read source records")
    }

    async fn list_source_records(
        &self,
        _: &MacroUserIdStr<'static>,
        provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report> {
        assert_eq!(provider, CallProvider::Granola);
        Ok(self.0.lock().unwrap().clone())
    }

    async fn read(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        unimplemented!("syncs read source records")
    }
}

/// Every user's Granola is connected.
struct Connected;

#[async_trait]
impl Accounts for Connected {
    async fn account(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Option<String>, rootcause::Report> {
        Ok(Some("apn_1".to_string()))
    }

    async fn connected(&self) -> Result<Vec<(MacroUserIdStr<'static>, String)>, rootcause::Report> {
        unimplemented!("syncs ask about one user")
    }
}

/// No one has connected Notion.
struct NoNotion;

impl NotionApi for NoNotion {
    async fn search(
        &self,
        _: SearchObject,
        _: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        unimplemented!("never connected")
    }

    async fn page(&self, _: &NotionId) -> Result<NotionPage, NotionError> {
        unimplemented!("never connected")
    }

    async fn page_markdown(&self, _: &NotionId) -> Result<PageMarkdown, NotionError> {
        unimplemented!("never connected")
    }

    async fn data_source(&self, _: &NotionId) -> Result<NotionDataSource, NotionError> {
        unimplemented!("never connected")
    }

    async fn database_sources(&self, _: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        unimplemented!("never connected")
    }

    async fn query_data_source(
        &self,
        _: &NotionId,
        _: Option<String>,
    ) -> Result<RowsPage, NotionError> {
        unimplemented!("never connected")
    }

    async fn users(&self, _: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        unimplemented!("never connected")
    }
}

impl NotionConnections for NoNotion {
    type Api = NoNotion;

    async fn for_user(&self, _: &MacroUserIdStr<'static>) -> Result<Option<NoNotion>, NotionError> {
        Ok(None)
    }
}

/// A user id no other test in this process shares: entity access caches
/// answers process-wide.
fn unique_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|syncs-{}@example.com", Uuid::new_v4())).unwrap()
}

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_granola_meeting_becomes_a_row_that_follows_it(pool: PgPool) {
    let owner = unique_user();
    insert_user(&pool, owner.as_ref()).await;
    let entity_access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let databases = Arc::new(databases::wiring::build_service(
        pool.clone(),
        entity_access.clone(),
        Unheard,
        NoopMacroEventBroker,
    ));
    let call_id = Uuid::now_v7();
    let meetings = Arc::new(Meetings(Mutex::new(vec![ImportedCallRecord {
        id: call_id,
        title: Some("Kickoff".to_string()),
        started_at: Some(Utc.with_ymd_and_hms(2026, 11, 2, 15, 0, 0).unwrap()),
        ended_at: None,
        attendees: vec!["Alice".to_string()],
        external_id: ExternalCallId("note_kickoff".to_string()),
        external_url: Some("https://notes.granola.ai/d/kickoff".to_string()),
        summary: None,
        external_updated_at: None,
    }])));
    let syncs = build_service(
        pool.clone(),
        databases.clone(),
        entity_access,
        SyncSources {
            calls: meetings.clone(),
            granola_accounts: Arc::new(Connected),
            notion: NoNotion,
            teams: Arc::new(TeamRepositoryImpl::new(pool.clone())),
        },
    );

    let sync = syncs
        .create_synced_database(
            &owner,
            NewSync {
                id: Uuid::now_v7(),
                source: SyncSource::GranolaMeetings,
            },
        )
        .await
        .unwrap();
    assert!(syncs.run_due().await.unwrap());

    let view = || {
        EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
            &sync.database_id.to_string(),
            EntityType::Database,
        )
    };
    let detail = databases.get_database(view()).await.unwrap();
    assert_eq!(detail.database.name, "Granola meetings");
    assert_eq!(
        detail
            .tables
            .iter()
            .map(|table| (table.table.id, table.table.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(sync.table_id, "Granola meetings")]
    );
    let title = sync
        .columns
        .iter()
        .find(|column| {
            column.field
                == SyncField::Granola {
                    field: GranolaField::Title,
                }
        })
        .unwrap()
        .column;
    let rows = databases
        .column_cells(view(), sync.table_id, title)
        .await
        .unwrap();
    assert_eq!(
        rows.values().cloned().collect::<Vec<_>>(),
        vec![CellValue::Text("Kickoff".to_string())]
    );
    let row = *rows.keys().next().unwrap();

    meetings.0.lock().unwrap()[0].title = Some("Kickoff, renamed".to_string());
    syncs
        .sync_now(
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                owner.clone(),
                &sync.database_id.to_string(),
                EntityType::Database,
            ),
            sync.id,
        )
        .await
        .unwrap();
    assert!(syncs.run_due().await.unwrap());
    let cells = databases
        .cells_of_rows(view(), sync.table_id, &[row])
        .await
        .unwrap();
    assert!(cells[&row].contains(&CellWrite {
        column: title,
        value: CellValue::Text("Kickoff, renamed".to_string()),
    }));

    meetings.0.lock().unwrap().clear();
    syncs
        .source_changed(&owner, crate::domain::models::SourceKind::GranolaMeetings)
        .await
        .unwrap();
    assert!(syncs.run_due().await.unwrap());
    assert_eq!(databases.row_count(view(), sync.table_id).await.unwrap(), 0);
    assert_eq!(
        syncs
            .list_syncs(EntityAccessReceipt::dangerously_assert_authenticated_user(
                owner.clone(),
                &sync.database_id.to_string(),
                EntityType::Database,
            ))
            .await
            .unwrap()[0]
            .status,
        SyncStatus::Synced
    );
}
