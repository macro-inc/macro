//! The access directory over the real entity access service. Its source-id
//! cache is process-wide, so every test mints its own user ids.

use std::sync::Arc;

use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::models::{CreateDatabase, Database, FirstTable};
use crate::domain::ports::DatabasesRepo;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;

use crate::outbound::pg_databases_repo::PgDatabasesRepo;

/// A user id no other test in this process shares, so the source-id cache
/// cannot carry one test's answer into another's database.
fn unique_user() -> MacroUserIdStr<'static> {
    let id = format!("macro|databases-dir-{}@macro.com", Uuid::new_v4());
    MacroUserIdStr::parse_from_str(&id)
        .expect("valid user id")
        .into_owned()
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
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

async fn create_database(pool: &PgPool, owner: &MacroUserIdStr<'static>) -> Database {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .create_database(
            &CreateDatabase {
                name: "Offsite".to_string(),
                owner_id: owner.clone(),
                acting_bot: None,
                template: None,
            },
            FirstTable {
                name: "Table 1",
                title_column: "Name",
            },
        )
        .await
        .expect("database should insert")
}

fn directory(pool: &PgPool) -> EntityAccessDirectory<EntityAccessServiceImpl<PgAccessRepository>> {
    EntityAccessDirectory::new(Arc::new(EntityAccessServiceImpl::new(
        PgAccessRepository::new(pool.clone()),
    )))
}

fn viewer(user: &MacroUserIdStr<'static>) -> Viewer {
    Viewer {
        user_id: user.clone(),
        acting_bot: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_reaches_their_own_database_and_a_stranger_does_not(pool: PgPool) {
    let owner = unique_user();
    let stranger = unique_user();
    insert_user(&pool, owner.as_ref()).await;
    insert_user(&pool, stranger.as_ref()).await;

    let database = create_database(&pool, &owner).await;
    let directory = directory(&pool);

    assert_eq!(
        directory
            .accessible_databases(&viewer(&owner))
            .await
            .unwrap(),
        vec![(database.id, AccessLevel::Owner)]
    );
    assert_eq!(
        directory
            .database_access(&viewer(&owner), database.id)
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        directory
            .accessible_databases(&viewer(&stranger))
            .await
            .unwrap(),
        Vec::new()
    );
    assert_eq!(
        directory
            .database_access(&viewer(&stranger), database.id)
            .await
            .unwrap(),
        None
    );
}
