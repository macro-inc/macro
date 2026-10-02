//! Templates over Postgres: every template's ops batch builds its database,
//! and a database whose template fails to commit is never there.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::apply_ops::{insert_user, service, viewer};
use crate::domain::models::{ColumnConfig, CreateDatabase};
use crate::domain::ports::{DatabasesRepo, DatabasesService};
use crate::domain::templates::{TEMPLATES, TemplateId};
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;

/// Each table a database holds, in tab order, with how many columns and
/// rows it has.
async fn tables(
    pool: &PgPool,
    database: crate::domain::models::DatabaseId,
) -> Vec<(String, usize, usize)> {
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (_, mut tables) = repo.get_database(database).await.unwrap().unwrap();
    tables.sort_by(|left, right| left.position.cmp(&right.position));
    let mut shown = Vec::new();
    for table in tables {
        let columns = repo.columns_for_tables(&[table.id]).await.unwrap().len();
        let rows = repo.row_refs(table.id).await.unwrap().len();
        shown.push((table.name, columns, rows));
    }
    shown
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_template_builds_its_database(pool: PgPool) {
    insert_user(&pool).await;
    let service = service(&pool);
    let mut built = Vec::new();
    for template in &TEMPLATES {
        let database = service
            .create_database(CreateDatabase {
                name: template.name.into(),
                owner_id: viewer().user_id,
                acting_bot: None,
                template: Some(template.id),
            })
            .await
            .unwrap();
        built.push((template.id, tables(&pool, database.id).await));
    }
    let named = |tables: &[(&str, usize, usize)]| -> Vec<(String, usize, usize)> {
        tables
            .iter()
            .map(|(name, columns, rows)| ((*name).to_owned(), *columns, *rows))
            .collect()
    };
    assert_eq!(
        built,
        vec![
            (TemplateId::ProjectTracker, named(&[("Tasks", 5, 4)])),
            (
                TemplateId::Crm,
                named(&[("Companies", 3, 3), ("Contacts", 4, 3), ("Deals", 5, 3)])
            ),
            (
                TemplateId::EventPlanner,
                named(&[("Parties", 4, 2), ("Invites", 5, 4)])
            ),
            (TemplateId::ContentCalendar, named(&[("Posts", 5, 4)])),
            (TemplateId::ReadingList, named(&[("Books", 5, 3)])),
            (TemplateId::GettingStarted, named(&[("Ideas", 2, 3)])),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_template_relation_points_at_its_own_database(pool: PgPool) {
    insert_user(&pool).await;
    let database = service(&pool)
        .create_database(CreateDatabase {
            name: "Events".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            template: Some(TemplateId::EventPlanner),
        })
        .await
        .unwrap();
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (_, tables) = repo.get_database(database.id).await.unwrap().unwrap();
    let parties = tables.iter().find(|table| table.name == "Parties").unwrap();
    let invites = tables.iter().find(|table| table.name == "Invites").unwrap();
    let configs: Vec<Option<ColumnConfig>> = repo
        .columns_for_tables(&[invites.id])
        .await
        .unwrap()
        .into_iter()
        .map(|column| column.config)
        .collect();
    assert_eq!(
        configs,
        vec![
            None,
            None,
            None,
            None,
            Some(ColumnConfig::Link {
                database_id: database.id,
                table_id: parties.id,
            }),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_template_that_fails_to_commit_leaves_no_database(pool: PgPool) {
    insert_user(&pool).await;
    sqlx::raw_sql(
        "CREATE FUNCTION refuse_rows() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected row failure'; END $$;
         CREATE TRIGGER refuse_rows BEFORE INSERT ON database_rows
         FOR EACH ROW EXECUTE FUNCTION refuse_rows();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let failed = service(&pool)
        .create_database(CreateDatabase {
            name: "Launch".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
            template: Some(TemplateId::ProjectTracker),
        })
        .await;
    assert!(failed.is_err());
    let left = sqlx::query_scalar!(
        r#"SELECT (SELECT COUNT(*) FROM databases)
                + (SELECT COUNT(*) FROM database_tables)
                + (SELECT COUNT(*) FROM property_definitions WHERE database_id IS NOT NULL)
                + (SELECT COUNT(*) FROM entity_access WHERE entity_type = 'database') AS "count!""#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}
