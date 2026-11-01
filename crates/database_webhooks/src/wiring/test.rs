//! The service as hosts build it, over the real databases service and entity
//! access in Postgres: a webhook's call becomes a row a reader sees.

use databases::domain::models::{CreateDatabase, TableId};
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::domain::service::NoopMacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellValue, CellWrite, DatabaseId, RowId};
use serde_json::json;

use super::*;
use crate::domain::models::{DatabaseWebhookError, PayloadProblem};
use crate::domain::ports::DatabaseWebhooksService;

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
        _: &databases::domain::models::Awareness,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// A user id no other test in this process shares: entity access caches
/// answers process-wide.
fn unique_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|webhooks-{}@macro.com", uuid::Uuid::new_v4())).unwrap()
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
async fn a_webhook_call_inserts_a_row_the_owner_reads(pool: PgPool) {
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
    let webhooks = build_service(pool.clone(), databases.clone(), entity_access);
    let database = databases
        .create_database(CreateDatabase {
            name: "Meetings".to_string(),
            owner_id: owner.clone(),
            acting_bot: None,
        })
        .await
        .unwrap();
    let view = || {
        EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
            &database.id.to_string(),
            EntityType::Database,
        )
    };
    let detail = databases.get_database(view()).await.unwrap();
    let table = &detail.tables[0];
    let name = &table.columns[0];
    assert_eq!(name.name(), "Name");

    let created = webhooks
        .create_webhook(
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                owner.clone(),
                &database.id.to_string(),
                EntityType::Database,
            ),
            table.table.id,
        )
        .await
        .unwrap();
    let delivery = webhooks
        .deliver(&created.token, &json!({ "name": "Acme kickoff" }))
        .await
        .unwrap();
    let refused = webhooks
        .deliver(&created.token, &json!({ "Nmae": "typo" }))
        .await;

    let [row]: [RowId; 1] = delivery.rows.clone().try_into().unwrap();
    assert_eq!(
        databases
            .cells_of_rows(view(), table.table.id, &[row])
            .await
            .unwrap()
            .remove(&row),
        Some(vec![CellWrite {
            column: name.column.id,
            value: CellValue::Text("Acme kickoff".to_string()),
        }])
    );
    assert!(matches!(
        refused,
        Err(DatabaseWebhookError::InvalidPayload(problems)) if problems == vec![PayloadProblem {
            row: None,
            field: Some("Nmae".to_string()),
            message: "no column is named \"Nmae\"".to_string(),
        }]
    ));
    assert_eq!(
        databases.row_count(view(), table.table.id).await.unwrap(),
        1
    );
}
