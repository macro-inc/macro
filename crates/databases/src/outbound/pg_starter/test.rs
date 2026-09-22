use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use saved_views::{PgViewStorage, ViewStorage};

use super::*;
use crate::{
    domain::{models::CreateDatabase, ports::DatabasesRepo},
    outbound::pg_databases_repo::PgDatabasesRepo,
};

const USER: &str = "macro|starter-database@macro.com";

fn viewer() -> Viewer {
    Viewer {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
    }
}

async fn insert_user(pool: &PgPool) {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#, id, USER)
        .execute(pool).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        USER,
        id
    )
    .execute(pool)
    .await
    .unwrap();
}

fn repo(pool: &PgPool) -> PgDatabaseStarterRepo<PropertiesPgRepo, PgViewStorage> {
    PgDatabaseStarterRepo::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
        PgViewStorage::new(pool.clone()),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_starter_requests_create_one_complete_editable_example(pool: PgPool) {
    insert_user(&pool).await;
    let repo = repo(&pool);
    let user = viewer();
    let first = StarterBlueprint::default();
    let second = StarterBlueprint::default();
    let (left, right) = tokio::join!(
        repo.ensure_starter(&user, &first),
        repo.ensure_starter(&user, &second)
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_ne!(left.created, right.created);
    assert_eq!(left.database_id, right.database_id);
    let created = if left.created { left } else { right };
    let id = created.database_id.unwrap();
    let table = created.table_id.unwrap();
    let data = PgDatabasesRepo::new(pool.clone());
    let (database, tables) = data.get_database(id).await.unwrap().unwrap();
    assert_eq!(database.name, "Getting started");
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "Ideas");
    let columns = data.columns_for_tables(&[table]).await.unwrap();
    assert_eq!(columns.len(), 2);
    let rows = data.fetch_rows(table, 10).await.unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|row| row.cells.len() == 2));
    let views = PgViewStorage::new(pool.clone())
        .get_views_for_user(USER)
        .await
        .unwrap();
    assert_eq!(views.len(), 2);
    let board = views
        .iter()
        .find(|view| Some(view.id) == created.view_id)
        .unwrap();
    assert_eq!(board.config["view"]["layout"], "board");
    assert_eq!(board.config["view"]["groupBy"], columns[1].id.to_string());
    assert!(
        views
            .iter()
            .all(|view| view.config["tableId"] == table.to_string())
    );
    let owner = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND access_level = 'owner'",
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner, Some(1));

    data.rename_database(id, "My ideas").await.unwrap();
    let again = repo
        .ensure_starter(&user, &StarterBlueprint::default())
        .await
        .unwrap();
    assert!(!again.created);
    assert_eq!(
        data.get_database(id).await.unwrap().unwrap().0.name,
        "My ideas"
    );
    assert_eq!(data.fetch_rows(table, 10).await.unwrap().len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn starter_never_resurrects_trashed_or_deleted_content(pool: PgPool) {
    insert_user(&pool).await;
    let repo = repo(&pool);
    let id = repo
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap()
        .database_id
        .unwrap();
    let data = PgDatabasesRepo::new(pool.clone());
    data.trash_database(id, chrono::Utc::now()).await.unwrap();
    let trashed = repo
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap();
    assert!(!trashed.created);
    assert!(trashed.database_id.is_none());
    data.delete_database(id).await.unwrap();
    let deleted = repo
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap();
    assert!(!deleted.created);
    assert!(deleted.database_id.is_none());
    assert!(data.get_database(id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_database_skips_seed_even_after_it_is_deleted(pool: PgPool) {
    insert_user(&pool).await;
    let data = PgDatabasesRepo::new(pool.clone());
    let database = data
        .create_database(
            &CreateDatabase {
                name: "Already mine".into(),
                owner_id: viewer().user_id,
            },
            "Tasks",
        )
        .await
        .unwrap();
    let repo = repo(&pool);
    let outcome = repo
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap();
    assert!(!outcome.created);
    assert!(outcome.database_id.is_none());
    data.delete_database(database.id).await.unwrap();
    assert!(
        !repo
            .ensure_starter(&viewer(), &StarterBlueprint::default())
            .await
            .unwrap()
            .created
    );
}

struct FailedViews;
impl TransactionalViewStorage for FailedViews {
    type Transaction = Transaction<'static, Postgres>;
    type Err = std::io::Error;
    async fn create_view_in(
        &self,
        _: &mut Self::Transaction,
        _: &saved_views::View,
    ) -> Result<(), Self::Err> {
        Err(std::io::Error::other("injected saved-view failure"))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_dependency_rolls_back_content_and_marker_then_retry_succeeds(pool: PgPool) {
    insert_user(&pool).await;
    let failed = PgDatabaseStarterRepo::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
        FailedViews,
    );
    let blueprint = StarterBlueprint::default();
    assert!(failed.ensure_starter(&viewer(), &blueprint).await.is_err());
    assert!(
        PgDatabasesRepo::new(pool.clone())
            .get_database(blueprint.database_id)
            .await
            .unwrap()
            .is_none()
    );
    let definitions = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_definitions WHERE database_id = $1",
        blueprint.database_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(definitions, Some(0));
    let success = repo(&pool)
        .ensure_starter(&viewer(), &blueprint)
        .await
        .unwrap();
    assert!(success.created);
    assert_eq!(success.database_id, Some(blueprint.database_id));
}
