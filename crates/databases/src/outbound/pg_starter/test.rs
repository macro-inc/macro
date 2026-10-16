use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::views::LaneKey;
use models_databases::views::{Lane, ViewLayout, ViewQuery};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;

use super::*;
use crate::{
    domain::{
        models::{CreateDatabase, FirstTable},
        ports::{CellStore, ColumnDefinitionStore, DatabasesRepo},
    },
    outbound::pg_databases_repo::PgDatabasesRepo,
};

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

fn repo(pool: &PgPool) -> PgDatabaseStarterRepo<PropertiesPgRepo> {
    PgDatabaseStarterRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_starter_records_initial_values_in_history(pool: PgPool) {
    insert_user(&pool).await;
    let blueprint = StarterBlueprint::default();
    let created = repo(&pool)
        .ensure_starter(&viewer(), &blueprint)
        .await
        .unwrap();
    let database = created.database_id.unwrap();
    let table = created.table_id.unwrap();
    let data = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let columns = data.columns_for_tables(&[table]).await.unwrap();
    let definitions = crate::outbound::pg_definition_store::PgDefinitionStore::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
    )
    .definitions(&[columns[1].property_definition_id])
    .await
    .unwrap();
    let rows = data.row_refs(table).await.unwrap();
    assert_eq!(rows.len(), blueprint.rows.len());
    for (row, (name, stage_index)) in rows.iter().zip(blueprint.rows) {
        let changes = data.row_history(database, table, row.id).await.unwrap();
        let history = crate::domain::journal::row_history(row.id, changes);
        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0].kind,
            crate::domain::journal::RowChangeKind::Insert
        );
        assert!(history[0].before.is_empty());
        assert_eq!(
            history[0].after,
            std::collections::BTreeMap::from([
                (
                    columns[0].id,
                    models_databases::CellValue::Text(name.into())
                ),
                (
                    columns[1].id,
                    models_databases::CellValue::Options(vec![models_databases::OptionRef::Id(
                        OptionId::from_uuid(definitions[0].property_options[stage_index].id),
                    )]),
                ),
            ])
        );
    }
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
    let data = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (database, tables) = data.get_database(id).await.unwrap().unwrap();
    assert_eq!(database.name, "Getting started");
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "Ideas");
    let columns = data.columns_for_tables(&[table]).await.unwrap();
    assert_eq!(columns.len(), 2);
    let rows = data.row_refs(table).await.unwrap();
    assert_eq!(rows.len(), 3);
    let cells = crate::outbound::pg_cell_store::PgCellStore::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
    )
    .cells(&rows.iter().map(|row| row.id).collect::<Vec<_>>())
    .await
    .unwrap();
    assert!(rows.iter().all(|row| cells[&row.id].len() == 2));
    let views = data.views_for_tables(&[table]).await.unwrap();
    let stages: Vec<_> = crate::outbound::pg_definition_store::PgDefinitionStore::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
    )
    .definitions(&[columns[1].property_definition_id])
    .await
    .unwrap()
    .remove(0)
    .property_options
    .iter()
    .map(|option| option.id)
    .collect();
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
                "7f80",
                &ViewQuery::default(),
                &ViewLayout::Table { columns: vec![] }
            ),
            (
                "Board",
                "80",
                &ViewQuery::default(),
                &ViewLayout::Board {
                    group_by: columns[1].id,
                    title: columns[0].id,
                    lanes: stages
                        .iter()
                        .map(|option| Lane {
                            key: LaneKey::Option(OptionId::from_uuid(*option)),
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
    let positions: Vec<&str> = rows.iter().map(|row| row.position.as_str()).collect();
    assert_eq!(positions, ["7f80", "80", "8180"]);
    let owner = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND access_level = 'owner'",
        id.into_uuid()
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
    assert_eq!(data.row_refs(table).await.unwrap().len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_starter_stages_are_coloured_in_palette_order(pool: PgPool) {
    insert_user(&pool).await;
    let created = repo(&pool)
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap();
    let columns = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .columns_for_tables(&[created.table_id.unwrap()])
        .await
        .unwrap();
    let definitions = crate::outbound::pg_definition_store::PgDefinitionStore::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
    )
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
    let repo = repo(&pool);
    let id = repo
        .ensure_starter(&viewer(), &StarterBlueprint::default())
        .await
        .unwrap()
        .database_id
        .unwrap();
    let data = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
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
    let data = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let database = data
        .create_database(
            &CreateDatabase {
                name: "Already mine".into(),
                owner_id: viewer().user_id,
                acting_bot: None,
            },
            FirstTable {
                name: "Tasks",
                title_column: "Name",
            },
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_dependency_rolls_back_content_and_marker_then_retry_succeeds(pool: PgPool) {
    insert_user(&pool).await;
    // The views are the seed's last write before the marker, so failing them
    // proves everything before rolls back with them.
    sqlx::raw_sql(
        "CREATE FUNCTION refuse_views() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected view failure'; END $$;
         CREATE TRIGGER refuse_views BEFORE INSERT ON database_views
         FOR EACH ROW EXECUTE FUNCTION refuse_views();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let blueprint = StarterBlueprint::default();
    assert!(
        repo(&pool)
            .ensure_starter(&viewer(), &blueprint)
            .await
            .is_err()
    );
    assert!(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .get_database(blueprint.database_id)
            .await
            .unwrap()
            .is_none()
    );
    let definitions = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_definitions WHERE database_id = $1",
        blueprint.database_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(definitions, Some(0));
    sqlx::raw_sql("DROP TRIGGER refuse_views ON database_views")
        .execute(&pool)
        .await
        .unwrap();
    let success = repo(&pool)
        .ensure_starter(&viewer(), &blueprint)
        .await
        .unwrap();
    assert!(success.created);
    assert_eq!(success.database_id, Some(blueprint.database_id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_cell_rolls_back_the_whole_seed(pool: PgPool) {
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
    let blueprint = StarterBlueprint::default();
    assert!(
        repo(&pool)
            .ensure_starter(&viewer(), &blueprint)
            .await
            .is_err()
    );
    assert!(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .get_database(blueprint.database_id)
            .await
            .unwrap()
            .is_none()
    );
    sqlx::raw_sql("DROP TRIGGER refuse_cells ON entity_properties")
        .execute(&pool)
        .await
        .unwrap();
    let retried = repo(&pool)
        .ensure_starter(&viewer(), &blueprint)
        .await
        .unwrap();
    assert!(retried.created);
}
