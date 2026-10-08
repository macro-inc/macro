//! Migration coverage with real source properties, database constraints and access.
#![cfg(feature = "outbound")]

use databases::{
    domain::storage::DatabaseStorageService,
    outbound::gateway_event_publisher::NoOpTableEventPublisher, wiring::build_service,
};
use entity_access::{
    domain::{
        models::{EntityType as AccessEntityType, ViewAccessLevel},
        ports::EntityAccessService,
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::{DatabaseId, TableId};
use models_properties::{EntityReference, EntityType, service::property_value::PropertyValue};
use properties::{PropertiesPgRepo, domain::database_cell_writer::DatabaseCellWriter};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use system_properties::{StageOption, SystemPropertyKey};
use uuid::Uuid;

const OWNER: &str = "macro|backfill-owner@macro.com";
const MEMBER: &str = "macro|backfill-member@macro.com";
const OUTSIDER: &str = "macro|backfill-outsider@macro.com";

async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MACRO_DB_MIGRATIONS.run(pool).await
}

async fn fixture(pool: &PgPool) -> Uuid {
    // sqlx::test owns this disposable database; templates may already be migrated.
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(pool)
        .await
        .unwrap();
    let before_copy = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261007172435)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_copy.run(pool).await.unwrap();
    for id in [OWNER, MEMBER, OUTSIDER] {
        let uid = macro_uuid::generate_uuid_v7();
        sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)", uid, id).execute(pool).await.unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
            id,
            uid
        )
        .execute(pool)
        .await
        .unwrap();
    }
    let team = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Migration team', $2)",
        team,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    for id in [OWNER, MEMBER] {
        sqlx::query!(
            "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
            team,
            id
        )
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        team
    )
    .execute(pool)
    .await
    .unwrap();
    team
}

async fn company(pool: &PgPool, team: Uuid, hidden: bool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, hidden, first_interaction, last_interaction) VALUES ($1, $2, $3, now(), now())", id, team, hidden).execute(pool).await.unwrap();
    id
}

async fn value(pool: &PgPool, company: Uuid, definition: Uuid, value: PropertyValue) {
    let mut tx = pool.begin().await.unwrap();
    PropertiesPgRepo::new(pool.clone())
        .upsert_entity_property_in(
            &mut tx,
            &EntityReference {
                entity_type: EntityType::Company,
                entity_id: company.to_string(),
                specific_message_id: None,
            },
            definition,
            Some(value),
        )
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

async fn stage(pool: &PgPool, company: Uuid, option: StageOption) {
    value(
        pool,
        company,
        SystemPropertyKey::Stage.uuid(),
        PropertyValue::SelectOption(vec![option.uuid()]),
    )
    .await;
}

async fn pipeline(pool: &PgPool, team: Uuid) -> (Uuid, Uuid, Uuid) {
    let row = sqlx::query!(
        "SELECT id, database_id, table_id FROM crm_pipeline_entities WHERE team_id = $1",
        team
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.id, row.database_id, row.table_id)
}

async fn other_database_column(pool: &PgPool, position: &str) -> Uuid {
    let [database, table, definition, column] = [(); 4].map(|_| macro_uuid::generate_uuid_v7());
    sqlx::query!("INSERT INTO databases (id) VALUES ($1)", database)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query!("INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Notes', '80')", table, database).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO property_definitions (id, database_id, display_name, data_type, is_multi_select) VALUES ($1, $2, 'Note', 'STRING', false)", definition, database).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO database_columns (id, table_id, property_definition_id, position) VALUES ($1, $2, $3, $4)", column, table, definition, position).execute(pool).await.unwrap();
    column
}

async fn cell(pool: &PgPool, company: Uuid, column: &str) -> Option<serde_json::Value> {
    sqlx::query_scalar!(
        r#"SELECT ep.values FROM crm_pipeline_entities primary_column
           JOIN database_columns primary_definition ON primary_definition.id = primary_column.primary_column_id
           JOIN entity_properties primary_value ON primary_value.property_definition_id = primary_definition.property_definition_id
             AND primary_value.entity_type = 'DATABASE_ROW'
           JOIN database_columns c ON c.table_id = primary_column.table_id
           JOIN property_definitions d ON d.id = c.property_definition_id
           JOIN entity_properties ep ON ep.entity_id = primary_value.entity_id
             AND ep.entity_type = 'DATABASE_ROW' AND ep.property_definition_id = d.id
           WHERE primary_value.values -> 'value' -> 0 ->> 'entity_id' = $1 AND d.display_name = $2"#,
        company.to_string(),
        column,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .flatten()
}

async fn stage_label(pool: &PgPool, company: Uuid) -> Option<String> {
    let value = cell(pool, company, "Stage").await?;
    let id: Uuid = value["value"][0].as_str().unwrap().parse().unwrap();
    sqlx::query_scalar!(
        "SELECT string_value FROM property_options WHERE id = $1",
        id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = false)]
async fn copies_populated_visible_companies_with_values_and_team_access(pool: PgPool) {
    let team = fixture(&pool).await;
    let open = company(&pool, team, false).await;
    let won = company(&pool, team, false).await;
    let lost = company(&pool, team, false).await;
    let unstaged = company(&pool, team, false).await;
    let hidden = company(&pool, team, true).await;
    stage(&pool, open, StageOption::Demo).await;
    stage(&pool, won, StageOption::Customer).await;
    stage(&pool, lost, StageOption::Churned).await;
    stage(&pool, hidden, StageOption::Lead).await;
    let owner = PropertyValue::EntityRef(vec![EntityReference {
        entity_type: EntityType::User,
        entity_id: MEMBER.into(),
        specific_message_id: None,
    }]);
    value(
        &pool,
        open,
        SystemPropertyKey::CompanyOwner.uuid(),
        owner.clone(),
    )
    .await;
    value(
        &pool,
        open,
        SystemPropertyKey::Revenue.uuid(),
        PropertyValue::Num(1250.75),
    )
    .await;
    migrate(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM database_rows")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(3)
    );
    assert_eq!(stage_label(&pool, open).await.as_deref(), Some("Demo"));
    assert_eq!(stage_label(&pool, won).await.as_deref(), Some("Customer"));
    assert_eq!(stage_label(&pool, lost).await.as_deref(), Some("Churned"));
    assert_eq!(stage_label(&pool, unstaged).await, None);
    assert_eq!(cell(&pool, unstaged, "Company").await, None);
    assert_eq!(cell(&pool, hidden, "Company").await, None);
    assert_eq!(
        cell(&pool, open, "Owner").await,
        Some(serde_json::to_value(owner).unwrap())
    );
    assert_eq!(
        cell(&pool, open, "Revenue").await,
        Some(json!({"type":"Number", "value":1250.75}))
    );
    let original = sqlx::query_scalar!("SELECT values FROM entity_properties WHERE entity_type = 'COMPANY' AND entity_id = $1 AND property_definition_id = $2", open.to_string(), SystemPropertyKey::Stage.uuid()).fetch_one(&pool).await.unwrap();
    assert_eq!(
        original,
        Some(json!({"type":"SelectOption", "value":[StageOption::Demo.uuid()]}))
    );
    let (pipeline, database, _) = pipeline(&pool, team).await;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT name FROM crm_pipeline_entities WHERE database_id = $1",
            database
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "Sales"
    );
    let access = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    for actor in [OWNER, MEMBER, OUTSIDER] {
        let user = MacroUserIdStr::parse_from_str(actor).unwrap().into_owned();
        let result = access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user,
                None,
                &pipeline.to_string(),
                AccessEntityType::CrmPipeline,
            )
            .await;
        assert_eq!(result.is_ok(), actor != OUTSIDER);
        let result = access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user,
                None,
                &database.to_string(),
                AccessEntityType::Database,
            )
            .await;
        assert!(
            result.is_err(),
            "core storage must not grant database app access"
        );
    }
}

#[sqlx::test(migrations = false)]
async fn copied_pipelines_open_in_order_and_other_databases_are_untouched(pool: PgPool) {
    let team = fixture(&pool).await;
    company(&pool, team, false).await;
    let other = other_database_column(&pool, "20").await;
    migrate(&pool).await.unwrap();
    let (_, database, table) = pipeline(&pool, team).await;
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let tables = build_service(
        pool.clone(),
        access,
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    )
    .storage_tables(DatabaseId::from_uuid(database))
    .await
    .unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].table.id, TableId::from_uuid(table));
    assert_eq!(
        tables[0]
            .columns
            .iter()
            .map(|column| column.definition.definition.display_name.as_str())
            .collect::<Vec<_>>(),
        ["Company", "Stage", "Owner", "Revenue"]
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT position FROM database_columns WHERE id = $1", other)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "20"
    );
}

#[sqlx::test(migrations = false)]
async fn preserves_custom_stages_and_legacy_rename_mapping(pool: PgPool) {
    let team = fixture(&pool).await;
    let definition = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO property_definitions (id, team_id, display_name, data_type, is_multi_select, is_system) VALUES ($1, $2, 'Deal Stage', 'SELECT_STRING', false, false)", definition, team).execute(&pool).await.unwrap();
    let renamed = macro_uuid::generate_uuid_v7();
    let won = macro_uuid::generate_uuid_v7();
    let demo = macro_uuid::generate_uuid_v7();
    for (order, (id, label)) in [(renamed, "Discovery"), (won, "Won"), (demo, "DEMO")]
        .into_iter()
        .enumerate()
    {
        sqlx::query!("INSERT INTO property_options (id, property_definition_id, string_value, display_order) VALUES ($1, $2, $3, $4)", id, definition, label, order as i32).execute(&pool).await.unwrap();
    }
    sqlx::query!(
        "UPDATE team_crm_settings SET legacy_stage_ids = $2 WHERE team_id = $1",
        team,
        json!({StageOption::Lead.uuid().to_string(): renamed})
    )
    .execute(&pool)
    .await
    .unwrap();
    let direct = company(&pool, team, false).await;
    let mapped = company(&pool, team, false).await;
    let by_label = company(&pool, team, false).await;
    let empty = company(&pool, team, false).await;
    value(
        &pool,
        direct,
        definition,
        PropertyValue::SelectOption(vec![won]),
    )
    .await;
    stage(&pool, direct, StageOption::Lead).await;
    stage(&pool, mapped, StageOption::Lead).await;
    value(
        &pool,
        mapped,
        definition,
        PropertyValue::SelectOption(vec![]),
    )
    .await;
    stage(&pool, by_label, StageOption::Demo).await;
    value(
        &pool,
        empty,
        definition,
        PropertyValue::SelectOption(vec![]),
    )
    .await;
    stage(&pool, empty, StageOption::Trial).await;
    assert!(migrate(&pool).await.is_err());
    value(
        &pool,
        empty,
        SystemPropertyKey::Stage.uuid(),
        PropertyValue::SelectOption(vec![]),
    )
    .await;
    migrate(&pool).await.unwrap();
    assert_eq!(stage_label(&pool, direct).await.as_deref(), Some("Won"));
    assert_eq!(
        stage_label(&pool, mapped).await.as_deref(),
        Some("Discovery")
    );
    assert_eq!(stage_label(&pool, by_label).await.as_deref(), Some("DEMO"));
    assert_eq!(stage_label(&pool, empty).await, None);
    let copied = cell(&pool, direct, "Stage").await.unwrap();
    assert_ne!(copied["value"][0], won.to_string());
}

#[sqlx::test(migrations = false)]
async fn reruns_preserve_user_changes_and_deletions(pool: PgPool) {
    let team = fixture(&pool).await;
    let company = company(&pool, team, false).await;
    migrate(&pool).await.unwrap();
    let (pipeline, database, table) = pipeline(&pool, team).await;
    sqlx::query!(
        "UPDATE crm_pipeline_entities SET name = 'Renamed by user', trashed_at = now() WHERE database_id = $1",
        database
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("DELETE FROM database_rows WHERE table_id = $1", table)
        .execute(&pool)
        .await
        .unwrap();
    stage(&pool, company, StageOption::Customer).await;
    migrate(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT name FROM crm_pipeline_entities WHERE database_id = $1",
            database
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "Renamed by user"
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM database_rows WHERE table_id = $1",
            table
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    sqlx::query!("DELETE FROM crm_pipeline_entities WHERE id = $1", pipeline)
        .execute(&pool)
        .await
        .unwrap();
    migrate(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_pipeline_entities")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrations = false)]
async fn invalid_values_roll_back_the_entire_copy_and_can_retry(pool: PgPool) {
    let team = fixture(&pool).await;
    let ids = (0..251)
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect::<Vec<_>>();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) SELECT id, $1, now(), now() FROM UNNEST($2::uuid[]) AS input(id)", team, &ids).execute(&pool).await.unwrap();
    // Populated rows survive the follow-up migration that removes empty Sales rows.
    for id in &ids {
        stage(&pool, *id, StageOption::Lead).await;
    }
    let last = *ids.iter().max().unwrap();
    // Legacy property writes permit bad types; the migration must detect them.
    value(
        &pool,
        last,
        SystemPropertyKey::Revenue.uuid(),
        PropertyValue::Str("not a number".into()),
    )
    .await;
    assert!(migrate(&pool).await.is_err());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM databases")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    value(
        &pool,
        last,
        SystemPropertyKey::Revenue.uuid(),
        PropertyValue::Num(42.0),
    )
    .await;
    migrate(&pool).await.unwrap();
    let (_, _, table) = pipeline(&pool, team).await;
    let rows = sqlx::query!(
        "SELECT id, position FROM database_rows WHERE table_id = $1 ORDER BY position",
        table
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for row in rows {
        assert_eq!(row.id.get_version_num(), 7);
        row.position
            .parse::<models_databases::position::Position>()
            .unwrap();
    }

    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(DISTINCT position) FROM database_rows WHERE table_id = $1",
            table
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(251)
    );
}

#[sqlx::test(migrations = false)]
async fn disabled_and_empty_teams_are_untouched(pool: PgPool) {
    let team = fixture(&pool).await;
    company(&pool, team, false).await;
    sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled = false WHERE team_id = $1",
        team
    )
    .execute(&pool)
    .await
    .unwrap();
    let empty = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Empty CRM', $2)",
        empty,
        OUTSIDER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        empty
    )
    .execute(&pool)
    .await
    .unwrap();
    migrate(&pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_pipeline_entities")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}
