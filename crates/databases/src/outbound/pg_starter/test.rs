//! The starter over Postgres, through the service as hosts build it: the
//! Getting started template, given once per user, whole or not at all.

use std::sync::Arc;

use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::OptionId;
use models_databases::views::{Lane, LaneKey, ViewLayout, ViewQuery};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use crate::domain::models::{CreateDatabase, Viewer};
use crate::domain::ports::{CellStore, ColumnDefinitionStore, DatabasesRepo, DatabasesService};
use crate::domain::starter::{DatabaseStarterService, StarterDatabase};
use crate::outbound::gateway_event_publisher::NoOpTableEventPublisher;
use crate::outbound::pg_cell_store::PgCellStore;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::outbound::pg_definition_store::PgDefinitionStore;
use crate::wiring::{PgDatabasesService, build_service};

const USER: &str = "macro|starter-database@macro.com";

fn viewer() -> Viewer {
    Viewer {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
        acting_bot: None,
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

fn service(
    pool: &PgPool,
) -> PgDatabasesService<
    NoOpTableEventPublisher,
    NoopMacroEventBroker,
    EntityAccessServiceImpl<PgAccessRepository>,
> {
    build_service(
        pool.clone(),
        Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    )
}

fn data(pool: &PgPool) -> PgDatabasesRepo<PropertiesPgRepo> {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
}

const NOT_GIVEN: StarterDatabase = StarterDatabase {
    database_id: None,
    table_id: None,
    view_id: None,
    created: false,
};

async fn database_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM database_entity WHERE user_id = $1"#,
        USER
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_starter_requests_create_one_complete_editable_example(pool: PgPool) {
    insert_user(&pool).await;
    let service = service(&pool);
    let (left, right) = tokio::join!(
        service.ensure_starter(viewer()),
        service.ensure_starter(viewer())
    );
    let (left, right) = (left.unwrap(), right.unwrap());
    assert_ne!(left.created, right.created);
    assert_eq!(left.database_id, right.database_id);
    let created = if left.created { left } else { right };
    let id = created.database_id.unwrap();
    let table = created.table_id.unwrap();
    let data = data(&pool);
    let (database, tables) = data.get_database(id).await.unwrap().unwrap();
    assert_eq!(database.name, "Getting started");
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "Ideas");
    assert_eq!(tables[0].id, table);
    let columns = data.columns_for_tables(&[table]).await.unwrap();
    assert_eq!(columns.len(), 2);
    let rows = data.row_refs(table).await.unwrap();
    assert_eq!(rows.len(), 3);
    let cells = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .cells(&rows.iter().map(|row| row.id).collect::<Vec<_>>())
        .await
        .unwrap();
    assert!(rows.iter().all(|row| cells[&row.id].len() == 2));
    let stages: Vec<OptionId> =
        PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .definitions(&[columns[1].property_definition_id])
            .await
            .unwrap()
            .remove(0)
            .property_options
            .iter()
            .map(|option| OptionId::from_uuid(option.id))
            .collect();
    let views = data.views_for_tables(&[table]).await.unwrap();
    let shown: Vec<(&str, &str, &ViewQuery, &ViewLayout)> = views
        .iter()
        .map(|view| {
            (
                view.name.as_str(),
                view.position.as_str(),
                &view.query,
                &view.layout,
            )
        })
        .collect();
    assert_eq!(
        shown,
        vec![
            (
                "Table",
                "80",
                &ViewQuery::default(),
                &ViewLayout::Table { columns: vec![] }
            ),
            (
                "Board",
                "8180",
                &ViewQuery::default(),
                &ViewLayout::Board {
                    group_by: columns[1].id,
                    title: columns[0].id,
                    lanes: stages
                        .iter()
                        .map(|option| Lane {
                            key: LaneKey::Option(*option),
                            hidden: false,
                        })
                        .collect(),
                    card_fields: vec![],
                    hide_empty_lanes: false,
                }
            ),
        ]
    );
    assert_eq!(created.view_id, Some(views[1].id));
    let owner = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND access_level = 'owner'",
        id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner, Some(1));

    data.rename_database(id, "My ideas").await.unwrap();
    assert_eq!(
        service.ensure_starter(viewer()).await.unwrap(),
        StarterDatabase {
            database_id: Some(id),
            table_id: None,
            view_id: None,
            created: false,
        }
    );
    assert_eq!(
        data.get_database(id).await.unwrap().unwrap().0.name,
        "My ideas"
    );
    assert_eq!(data.row_refs(table).await.unwrap().len(), 3);
    assert_eq!(database_count(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_starter_stages_are_coloured_in_palette_order(pool: PgPool) {
    insert_user(&pool).await;
    let created = service(&pool).ensure_starter(viewer()).await.unwrap();
    let columns = data(&pool)
        .columns_for_tables(&[created.table_id.unwrap()])
        .await
        .unwrap();
    let definitions = PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .definitions(&[columns[1].property_definition_id])
        .await
        .unwrap();

    let colors: Vec<Option<&str>> = definitions[0]
        .property_options
        .iter()
        .map(|option| option.color.as_deref())
        .collect();
    assert_eq!(colors, [Some("#0091FF"), Some("#46A758"), Some("#8E4EC6")]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn starter_never_resurrects_trashed_or_deleted_content(pool: PgPool) {
    insert_user(&pool).await;
    let service = service(&pool);
    let id = service
        .ensure_starter(viewer())
        .await
        .unwrap()
        .database_id
        .unwrap();
    let data = data(&pool);
    data.trash_database(id, chrono::Utc::now()).await.unwrap();
    assert_eq!(service.ensure_starter(viewer()).await.unwrap(), NOT_GIVEN);
    data.delete_database(id).await.unwrap();
    assert_eq!(service.ensure_starter(viewer()).await.unwrap(), NOT_GIVEN);
    assert_eq!(database_count(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_database_skips_the_starter_even_after_it_is_deleted(pool: PgPool) {
    insert_user(&pool).await;
    let service = service(&pool);
    let database = service
        .create_database(CreateDatabase {
            name: "Already mine".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    assert_eq!(service.ensure_starter(viewer()).await.unwrap(), NOT_GIVEN);
    data(&pool).delete_database(database.id).await.unwrap();
    assert_eq!(service.ensure_starter(viewer()).await.unwrap(), NOT_GIVEN);
    assert_eq!(database_count(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_view_rolls_back_content_and_claim_then_a_retry_succeeds(pool: PgPool) {
    insert_user(&pool).await;
    // The views are the template's last ops, so failing them proves
    // everything before rolls back with them.
    sqlx::raw_sql(
        "CREATE FUNCTION refuse_views() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected view failure'; END $$;
         CREATE TRIGGER refuse_views BEFORE INSERT ON database_views
         FOR EACH ROW EXECUTE FUNCTION refuse_views();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let service = service(&pool);
    assert!(service.ensure_starter(viewer()).await.is_err());
    assert_eq!(database_count(&pool).await, 0);
    let leftovers = sqlx::query_scalar!(
        r#"SELECT (SELECT COUNT(*) FROM property_definitions WHERE database_id IS NOT NULL)
                + (SELECT COUNT(*) FROM database_starter_seeds) AS "count!""#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(leftovers, 0);
    sqlx::raw_sql("DROP TRIGGER refuse_views ON database_views")
        .execute(&pool)
        .await
        .unwrap();
    let retried = service.ensure_starter(viewer()).await.unwrap();
    assert!(retried.created);
    assert_eq!(database_count(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_cell_rolls_back_the_whole_starter(pool: PgPool) {
    insert_user(&pool).await;
    sqlx::raw_sql(
        "CREATE FUNCTION refuse_cells() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected cell failure'; END $$;
         CREATE TRIGGER refuse_cells BEFORE INSERT ON entity_properties
         FOR EACH ROW EXECUTE FUNCTION refuse_cells();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let service = service(&pool);
    assert!(service.ensure_starter(viewer()).await.is_err());
    assert_eq!(database_count(&pool).await, 0);
    sqlx::raw_sql("DROP TRIGGER refuse_cells ON entity_properties")
        .execute(&pool)
        .await
        .unwrap();
    assert!(service.ensure_starter(viewer()).await.unwrap().created);
}
