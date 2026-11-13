//! A creator's edit receipt over the real entity access service. Its
//! source-id cache is process-wide, so every test mints its own user ids.

use std::sync::Arc;

use entity_access::domain::models::{AccessLevel, EntityPermission};
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::models::{CreateDatabase, FirstTable};
use crate::domain::ports::DatabasesRepo;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_gets_an_edit_receipt_and_a_stranger_none(pool: PgPool) {
    let owner_id = format!("macro|creators-owner-{}@macro.com", Uuid::new_v4());
    let stranger_id = format!("macro|creators-stranger-{}@macro.com", Uuid::new_v4());
    for user_id in [&owner_id, &stranger_id] {
        let macro_user_id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
            macro_user_id,
            user_id,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
            user_id,
            macro_user_id,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let owner = MacroUserIdStr::parse_from_str(&owner_id)
        .unwrap()
        .into_owned();
    let stranger = MacroUserIdStr::parse_from_str(&stranger_id)
        .unwrap()
        .into_owned();
    let database = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .create_database(
            &CreateDatabase {
                name: "Offsite".to_string(),
                owner_id: owner.clone(),
                acting_bot: None,
                first_table: None,
            },
            FirstTable {
                name: "Table 1",
                title_column: "Name",
            },
        )
        .await
        .unwrap();
    let creators = EntityAccessCreators::new(Arc::new(EntityAccessServiceImpl::new(
        PgAccessRepository::new(pool.clone()),
    )));

    let receipt = creators
        .edit_receipt(&owner, database.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(receipt.entity().entity_id, database.id.to_string());
    assert_eq!(
        receipt.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    );
    assert!(
        creators
            .edit_receipt(&stranger, database.id)
            .await
            .unwrap()
            .is_none()
    );
}
