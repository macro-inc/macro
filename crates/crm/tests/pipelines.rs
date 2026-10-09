//! Pipeline policy and access boundaries, exercised through real domain services.
#![cfg(feature = "outbound")]

use crm::domain::{auth::CrmTeamReceipt, model::CrmError, pipelines::*, stages::*};
use crm::outbound::pipelines::PgPipelineRepo;
use databases::domain::models::DatabaseError;
use databases::outbound::{
    gateway_event_publisher::NoOpTableEventPublisher, pg_cell_store::PgCellStore,
};
use databases::wiring::{PgDatabasesService, build_service};
use entity_access::{
    domain::{
        models::*,
        ports::{AccessibleDatabases, EntityAccessService},
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::*;
use properties::PropertiesPgRepo;
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

const OWNER: &str = "macro|pipeline-owner@macro.com";
const MEMBER: &str = "macro|pipeline-member@macro.com";
const OUTSIDER: &str = "macro|pipeline-outsider@macro.com";
type Access = EntityAccessServiceImpl<PgAccessRepository>;
type DatabaseService = PgDatabasesService<NoOpTableEventPublisher, NoopMacroEventBroker, Access>;
type Service = PipelineServiceImpl<
    PgPipelineRepo<PgCellStore<PropertiesPgRepo>>,
    DatabaseService,
    Access,
    Stages,
>;

// A customized team template: the pipeline must copy it without sharing option IDs.
struct Stages;
impl StageDefinitionStore for Stages {
    async fn get_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamStageSet>, CrmError> {
        Ok(Some(TeamStageSet {
            definition_id: Uuid::nil(),
            stages: vec![
                TeamStage {
                    id: Uuid::nil(),
                    label: "Prospect".into(),
                    display_order: 0,
                },
                TeamStage {
                    id: Uuid::nil(),
                    label: "Won".into(),
                    display_order: 1,
                },
            ],
        }))
    }
    async fn create_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: &[String],
    ) -> Result<TeamStageSet, CrmError> {
        panic!("pipeline creation must not edit the template")
    }
    async fn replace_stages(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
        _: StageReplacePlan,
    ) -> Result<TeamStageSet, CrmError> {
        panic!("must not edit the template")
    }
    async fn delete_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
    ) -> Result<(), CrmError> {
        panic!("must not edit the template")
    }
}
fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}
fn team_receipt(team: Uuid, id: &str) -> CrmTeamReceipt<MemberTeamRole> {
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::try_new_authenticated_user(
            user(id),
            Entity {
                entity_id: team.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole {
                role: TeamRole::Member,
            },
        )
        .unwrap(),
    )
    .unwrap()
}
async fn access<T: RequiredPermission>(
    a: &Access,
    id: Uuid,
    kind: EntityType,
    actor: &str,
) -> EntityAccessReceipt<T> {
    a.generate_entity_access_receipt(&user(actor), None, &id.to_string(), kind)
        .await
        .unwrap()
}
async fn fixture(pool: &PgPool) -> (Service, Arc<DatabaseService>, Arc<Access>, Uuid, Uuid) {
    for id in [OWNER, MEMBER, OUTSIDER] {
        let uid = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
            uid,
            id
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#,
            id,
            uid
        )
        .execute(pool)
        .await
        .unwrap();
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1,'Sales',$2)"#,
        team,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    for id in [OWNER, MEMBER] {
        sqlx::query!(
            r#"INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'member')"#,
            team,
            id
        )
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"INSERT INTO team_crm_settings (team_id,crm_enabled) VALUES ($1,true)"#,
        team
    )
    .execute(pool)
    .await
    .unwrap();
    let company = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO crm_companies (id,team_id,first_interaction,last_interaction) VALUES ($1,$2,now(),now())"#, company, team).execute(pool).await.unwrap();
    let a = Arc::new(Access::new(PgAccessRepository::new(pool.clone())));
    let db = Arc::new(build_service(
        pool.clone(),
        a.clone(),
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    ));
    let svc = Service::new(
        PgPipelineRepo::new(
            pool.clone(),
            PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
        ),
        db.clone(),
        a.clone(),
        Stages,
    );
    (svc, db, a, team, company)
}
async fn create(s: &Service, team: Uuid, record_type: PipelineRecordType) -> Pipeline {
    s.create(
        team_receipt(team, OWNER),
        CreatePipeline {
            name: "  Renewals  ".into(),
            record_type,
            sharing: PipelineSharing::Private,
        },
    )
    .await
    .unwrap()
    .pipeline
}
fn insert(p: &Pipeline, entity: Uuid) -> DatabaseOp {
    serde_json::from_value(json!({"kind":"rows", "table":p.table_id, "change":{"kind":"insert", "rows":[[{"column":p.primary_column_id, "value":{"type":"entities","value":[{"entityType":p.record_type.as_str().to_uppercase(),"entityId":entity.to_string()}]}}]]}})).unwrap()
}
async fn write(
    s: &Service,
    a: &Access,
    p: &Pipeline,
    ops: Vec<DatabaseOp>,
) -> Result<Vec<OpResult>, PipelineError> {
    s.apply_ops(
        access(a, p.id, EntityType::CrmPipeline, OWNER).await,
        ops.into(),
    )
    .await
    .map(|applied| applied.results)
}

fn inserted(result: &[OpResult]) -> RowId {
    match &result[0] {
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        } => rows[0],
        other => panic!("{other:?}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn private_defaults_team_sharing_and_revocation_cover_database_and_rows(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    assert_eq!(p.name, "Renewals");
    assert_eq!(p.sharing, PipelineSharing::Private);
    assert!(s.list(team_receipt(team, MEMBER)).await.unwrap().is_empty());
    let detail = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    assert_eq!(detail.columns.len(), 4);
    let columns = &detail.columns;
    assert_eq!(
        columns
            .iter()
            .map(|c| c.definition.definition.display_name.as_str())
            .collect::<Vec<_>>(),
        vec!["Company", "Stage", "Owner", "Revenue"]
    );
    let stage = &columns[1].definition;
    assert_eq!(
        stage
            .property_options
            .iter()
            .filter_map(|option| option.value.as_string())
            .collect::<Vec<_>>(),
        vec!["Prospect", "Won"]
    );
    assert!(
        stage
            .property_options
            .iter()
            .all(|option| option.id != Uuid::nil())
    );
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    for actor in [MEMBER, OUTSIDER] {
        for (id, kind) in [
            (p.id, EntityType::CrmPipeline),
            (p.database_id.into_uuid(), EntityType::Database),
            (row.into_uuid(), EntityType::DatabaseRow),
        ] {
            assert_eq!(
                a.get_access_level(Some(&user(actor)), &id.to_string(), kind)
                    .await
                    .unwrap(),
                None
            );
        }
    }
    s.share(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    assert_eq!(s.list(team_receipt(team, MEMBER)).await.unwrap().len(), 1);
    assert_eq!(
        a.get_access_level(
            Some(&user(MEMBER)),
            &p.id.to_string(),
            EntityType::CrmPipeline
        )
        .await
        .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert!(
        a.generate_entity_access_receipt::<OwnerAccessLevel>(
            &user(MEMBER),
            None,
            &p.id.to_string(),
            EntityType::CrmPipeline
        )
        .await
        .is_err()
    );
    assert_eq!(
        s.rows(
            access(&a, p.id, EntityType::CrmPipeline, MEMBER).await,
            None
        )
        .await
        .unwrap()
        .rows
        .len(),
        1
    );
    for actor in [OWNER, MEMBER] {
        for (id, kind) in [
            (p.database_id.into_uuid(), EntityType::Database),
            (row.into_uuid(), EntityType::DatabaseRow),
        ] {
            assert_eq!(
                a.get_access_level(Some(&user(actor)), &id.to_string(), kind)
                    .await
                    .unwrap(),
                None
            );
        }
        assert!(
            a.accessible_databases(&user(actor))
                .await
                .unwrap()
                .is_empty()
        );
    }
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM database_entities")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    s.share(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        PipelineSharing::Private,
    )
    .await
    .unwrap();
    assert!(
        a.accessible_databases(&user(MEMBER))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        a.get_access_level(
            Some(&user(MEMBER)),
            &row.to_string(),
            EntityType::DatabaseRow
        )
        .await
        .unwrap(),
        None
    );
    assert_eq!(
        a.get_access_level(
            Some(&user(OWNER)),
            &p.id.to_string(),
            EntityType::CrmPipeline
        )
        .await
        .unwrap(),
        Some(AccessLevel::Owner)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn primary_record_is_required_and_protected_but_can_repeat(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    let duplicate = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    assert_ne!(row, duplicate);
    let blank = serde_json::from_value(
        json!({"kind":"rows","table":p.table_id,"change":{"kind":"insert","rows":[[]]}}),
    )
    .unwrap();
    assert!(matches!(
        write(&s, &a, &p, vec![blank]).await,
        Err(PipelineError::Database(DatabaseError::InvalidOp(_))) | Err(PipelineError::Invalid(_))
    ));
    let clear = serde_json::from_value(json!({"kind":"rows","table":p.table_id,"change":{"kind":"update","changes":{"kind":"uniform","rows":[row],"cells":[{"column":p.primary_column_id,"value":{"type":"clear"}}]}}})).unwrap();
    assert!(matches!(
        write(&s, &a, &p, vec![clear]).await,
        Err(PipelineError::Database(DatabaseError::InvalidOp(_))) | Err(PipelineError::Invalid(_))
    ));
    let delete_column = serde_json::from_value(json!({"kind":"column","table":p.table_id,"column":p.primary_column_id,"change":{"kind":"delete"}})).unwrap();
    assert!(matches!(
        write(&s, &a, &p, vec![delete_column]).await,
        Err(PipelineError::Database(DatabaseError::InvalidOp(_))) | Err(PipelineError::Invalid(_))
    ));
    assert!(matches!(
        write(&s, &a, &p, vec![insert(&p, Uuid::now_v7())]).await,
        Err(PipelineError::Access(_))
    ));
    for value in [
        json!({"type": "entities", "value": []}),
        json!({"type": "entities", "value": [
            {"entityType": "COMPANY", "entityId": company},
            {"entityType": "COMPANY", "entityId": company}
        ]}),
        json!({"type": "entities", "value": [{"entityType": "CONTACT", "entityId": company}]}),
        json!({"type": "text", "value": "not a reference"}),
    ] {
        let operation = serde_json::from_value(json!({"kind": "rows", "table": p.table_id,
            "change": {"kind": "insert", "rows": [[{"column": p.primary_column_id, "value": value}]]}})).unwrap();
        assert!(matches!(
            write(&s, &a, &p, vec![operation]).await,
            Err(PipelineError::Database(DatabaseError::InvalidOp(_)))
                | Err(PipelineError::Invalid(_))
        ));
    }
    let second = create(&s, team, PipelineRecordType::Company).await;
    // A receipt for one pipeline must never write another pipeline's storage.
    assert!(matches!(
        write(&s, &a, &p, vec![insert(&second, company)]).await,
        Err(PipelineError::NotFound)
    ));
    let change_primary = DatabaseOp::Column {
        table: second.table_id,
        column: second.primary_column_id,
        change: ColumnChange::ChangeType {
            to: ColumnKind::Text,
        },
    };
    assert!(matches!(
        write(&s, &a, &second, vec![change_primary]).await,
        Err(PipelineError::Database(DatabaseError::InvalidOp(_))) | Err(PipelineError::Invalid(_))
    ));
    write(&s, &a, &second, vec![insert(&second, company)])
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM database_rows WHERE table_id=$1"#,
        p.table_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);
    // Removing one entry keeps the other entry and its CRM record.
    let remove = DatabaseOp::Rows {
        table: p.table_id,
        change: RowsChange::Delete { rows: vec![row] },
    };
    write(&s, &a, &p, vec![remove]).await.unwrap();
    let remaining = s
        .rows(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, None)
        .await
        .unwrap();
    assert_eq!(remaining.rows.len(), 1);
    assert_eq!(remaining.rows[0].row_id, duplicate);
    write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn references_can_cross_teams_only_when_the_editor_has_record_access(pool: PgPool) {
    let (s, _, a, team, _) = fixture(&pool).await;
    let other_team = Uuid::now_v7();
    let company = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Other CRM', $2)",
        other_team,
        OUTSIDER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        other_team
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", company, other_team).execute(&pool).await.unwrap();
    let contact = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction) VALUES ($1, $2, 'cross-team@example.com', now(), now())", contact, company).execute(&pool).await.unwrap();
    let companies = create(&s, team, PipelineRecordType::Company).await;
    let contacts = create(&s, team, PipelineRecordType::Contact).await;
    for (pipeline, record) in [(&companies, company), (&contacts, contact)] {
        assert!(matches!(
            write(&s, &a, pipeline, vec![insert(pipeline, record)]).await,
            Err(PipelineError::Access(_))
        ));
    }
    // Membership is currently limited to one team. Moving the editor preserves
    // their pipeline owner grant while giving them access to the other CRM.
    sqlx::query!(
        "UPDATE team_user SET team_id = $1 WHERE user_id = $2",
        other_team,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    for (pipeline, record) in [(&companies, company), (&contacts, contact)] {
        write(&s, &a, pipeline, vec![insert(pipeline, record)])
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn custom_columns_use_core_validation_and_preserve_values(pool: PgPool) {
    let (s, _, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    let column = ColumnId::new();
    let op = |value| serde_json::from_value::<DatabaseOp>(value).unwrap();
    write(&s, &a, &p, vec![op(json!({
        "kind": "column", "table": p.table_id, "column": column,
        "change": {"kind": "create", "definition": {"source": "new", "name": "Notes", "type": {"type": "text"}}}
    })), op(json!({
        "kind": "rows", "table": p.table_id,
        "change": {"kind": "update", "changes": {"kind": "uniform", "rows": [row], "cells": [{"column": column, "value": {"type": "text", "value": "Call next week"}}]}}
    }))]).await.unwrap();
    let rows = s
        .rows(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, None)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&rows.rows[0].cells[&column]).unwrap(),
        json!({"type": "String", "value": "Call next week"})
    );
    assert!(matches!(
        write(
            &s,
            &a,
            &p,
            vec![op(json!({
                "kind": "column", "table": p.table_id, "column": column,
                "change": {"kind": "change_type", "to": {"type": "number"}}
            }))]
        )
        .await,
        Err(PipelineError::Database(DatabaseError::InvalidOp(_)))
    ));
    let table = s
        .table(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    assert_eq!(
        table
            .columns
            .last()
            .unwrap()
            .definition
            .definition
            .data_type,
        models_properties::DataType::String
    );
    // A consumer cannot bind another resource's property definition to bypass access.
    assert!(matches!(write(&s, &a, &p, vec![op(json!({
        "kind": "column", "table": p.table_id, "column": ColumnId::new(),
        "change": {"kind": "create", "definition": {"source": "existing", "property": table.columns[0].column.property_definition_id}}
    }))]).await, Err(PipelineError::Database(DatabaseError::InvalidOp(_)))));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contact_pipelines_and_lifecycle_preserve_crm_records(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let contact = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO crm_contacts (id,company_id,email,first_interaction,last_interaction) VALUES ($1,$2,'person@example.com',now(),now())"#, contact, company).execute(&pool).await.unwrap();
    let p = create(&s, team, PipelineRecordType::Contact).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, contact)]).await.unwrap());
    let duplicate = inserted(&write(&s, &a, &p, vec![insert(&p, contact)]).await.unwrap());
    assert_ne!(row, duplicate);
    let rows = s
        .rows(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, None)
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 2);
    assert!(write(&s, &a, &p, vec![insert(&p, company)]).await.is_err());
    s.rename(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        "Hiring".into(),
    )
    .await
    .unwrap();
    assert_eq!(
        s.get(access(&a, p.id, EntityType::CrmPipeline, OWNER).await)
            .await
            .unwrap()
            .pipeline
            .name,
        "Hiring"
    );
    s.set_trashed(access(&a, p.id, EntityType::CrmPipeline, OWNER).await, true)
        .await
        .unwrap();
    assert!(s.list(team_receipt(team, OWNER)).await.unwrap().is_empty());
    assert!(write(&s, &a, &p, vec![insert(&p, contact)]).await.is_err());
    s.set_trashed(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        false,
    )
    .await
    .unwrap();
    assert_eq!(s.list(team_receipt(team, OWNER)).await.unwrap().len(), 1);
    sqlx::query!(r#"DELETE FROM crm_pipeline_entities WHERE id=$1"#, p.id)
        .execute(&pool)
        .await
        .unwrap();
    let exists: bool = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM crm_contacts WHERE id=$1) AS "exists!""#,
        contact
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(exists);
    let exists: bool = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM databases WHERE id=$1) AS "exists!""#,
        p.database_id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!exists);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM database_changes WHERE database_id = $1",
            p.database_id.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disabled_crm_cannot_create_pipeline_storage(pool: PgPool) {
    let (s, _, _, team, _) = fixture(&pool).await;
    sqlx::query!(
        r#"UPDATE team_crm_settings SET crm_enabled=false WHERE team_id=$1"#,
        team
    )
    .execute(&pool)
    .await
    .unwrap();
    let result = s
        .create(
            team_receipt(team, OWNER),
            CreatePipeline {
                name: "Sales".into(),
                record_type: PipelineRecordType::Company,
                sharing: PipelineSharing::Team,
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(PipelineError::Crm(CrmError::CrmDisabledForTeam))
    ));
    let count: i64 = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM databases"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn migration_rollback_preserves_records_and_grants(pool: PgPool) {
    let (s, _db, a, team, company) = fixture(&pool).await;
    let p = create(&s, team, PipelineRecordType::Company).await;
    let row = inserted(&write(&s, &a, &p, vec![insert(&p, company)]).await.unwrap());
    s.share(
        access(&a, p.id, EntityType::CrmPipeline, OWNER).await,
        PipelineSharing::Team,
    )
    .await
    .unwrap();
    // Execute the actual rollback DDL in this disposable test database.
    sqlx::raw_sql(include_str!(
        "../../macro_db_client/migrations/20261007172434_crm_pipeline_entities.down.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM database_rows WHERE id = $1) AS "exists!""#,
            row.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
    let grants = sqlx::query!(
        "SELECT source_id, access_level::text AS level FROM entity_access WHERE entity_id = $1 AND entity_type = 'database' ORDER BY source_id",
        p.database_id.into_uuid()
    ).fetch_all(&pool).await.unwrap();
    assert_eq!(grants.len(), 2);
    assert!(
        grants
            .iter()
            .any(|grant| grant.source_id == OWNER && grant.level.as_deref() == Some("owner"))
    );
    assert!(
        grants
            .iter()
            .any(|grant| grant.source_id == team.to_string()
                && grant.level.as_deref() == Some("edit"))
    );
}

#[cfg(feature = "inbound")]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn http_creation_listing_schema_and_records_use_pipeline_access(pool: PgPool) {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use crm::inbound::pipelines::{PipelineRouterState, router};
    use macro_authorization::{
        InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
        MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
    };
    use tower::ServiceExt;
    #[derive(Clone)]
    struct Token;
    impl JwtValidator for Token {
        fn validate(
            &self,
            jwt: &str,
        ) -> Result<ValidatedIdentity, rootcause::Report<MacroAuthorizationError>> {
            if jwt != "owner" && jwt != "outsider" {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
            Ok(ValidatedIdentity {
                user_id: if jwt == "owner" { OWNER } else { OUTSIDER }.into(),
                fusion_user_id: "test-fusion-user".into(),
                organization_id: None,
                permissions: None,
            })
        }
    }
    let (service, _, access, _, company) = fixture(&pool).await;
    let app = Router::new().nest(
        "/crm/pipelines",
        router(PipelineRouterState {
            service: Arc::new(service),
            access,
            authorization: MacroAuthorizationState::new(Arc::new(
                MacroAuthorizationServiceImpl::new(
                    Token,
                    InternalAuthConfig {
                        api_key: "test-only".into(),
                        default_user_id: None,
                    },
                    NoBotAuthorizer,
                    NoUserApiKeyAuthorizer,
                ),
            )),
        }),
    );
    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/crm/pipelines")
                .header("authorization", "Bearer owner")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"Renewals","recordType":"company"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(created.into_body(), 16384).await.unwrap()).unwrap();
    assert_eq!(body["sharing"], "private");
    assert_eq!(body["grant"], "owner");
    assert_eq!(body["userId"], OWNER);
    let pipeline_id = body["id"].as_str().unwrap();
    let primary = body["primaryColumnId"].as_str().unwrap();
    let table = body["tableId"].as_str().unwrap();
    let operation = json!({"ops": [{"kind": "rows", "table": table, "change": {"kind": "insert", "rows": [[{"column": primary, "value": {"type": "entities", "value": [{"entityType": "COMPANY", "entityId": company}]}}]]}}]});
    for (token, expected) in [
        ("outsider", StatusCode::UNAUTHORIZED),
        ("owner", StatusCode::OK),
        ("owner", StatusCode::OK),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/crm/pipelines/{pipeline_id}/ops"))
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(operation.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    for route in ["table", "rows"] {
        for (token, expected) in [
            ("outsider", StatusCode::UNAUTHORIZED),
            ("owner", StatusCode::OK),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/crm/pipelines/{pipeline_id}/{route}"))
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            if route == "rows" && expected == StatusCode::OK {
                let rows: serde_json::Value =
                    serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap())
                        .unwrap();
                let rows = rows["rows"].as_array().unwrap();
                assert_eq!(rows.len(), 2);
                assert_ne!(rows[0]["rowId"], rows[1]["rowId"]);
                for row in rows {
                    assert_eq!(
                        row["cells"][primary]["value"][0]["entity_id"],
                        company.to_string()
                    );
                }
            }
        }
    }
    let listed = app
        .oneshot(
            Request::builder()
                .uri("/crm/pipelines")
                .header("authorization", "Bearer owner")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(listed.into_body(), 16384).await.unwrap()).unwrap();
    assert_eq!(body.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn queried_rows_filter_and_sort_before_paging_and_retain_hidden_records(pool: PgPool) {
    use databases::domain::storage::StorageRowsQuery;
    use models_properties::service::property_value::PropertyValue;
    let (service, _, access_service, team, company) = fixture(&pool).await;
    let pipeline = create(&service, team, PipelineRecordType::Company).await;
    let schema = service
        .table(access(&access_service, pipeline.id, EntityType::CrmPipeline, OWNER).await)
        .await
        .unwrap();
    let revenue = schema
        .columns
        .iter()
        .find(|column| column.definition.definition.display_name == "Revenue")
        .unwrap()
        .column
        .id;
    for range in [0..500, 500..502] {
        let rows: Vec<_> = range.map(|number| json!([
            {"column": pipeline.primary_column_id, "value": {"type":"entities", "value":[{"entityType":"COMPANY", "entityId":company.to_string()}]}},
            {"column": revenue, "value": {"type":"number", "value":number}}
        ])).collect();
        let op = serde_json::from_value(json!({"kind":"rows", "table":pipeline.table_id, "change":{"kind":"insert", "rows":rows}})).unwrap();
        write(&service, &access_service, &pipeline, vec![op])
            .await
            .unwrap();
    }
    let query = json!({"filter":{"conjunction":"and", "conditions":[{"kind":"condition", "column":revenue, "test":{"kind":"number","operator":"greaterThan", "value":0}}]}, "sort":[{"column":revenue, "direction":"descending"}]});
    let first = service
        .query_rows(
            access(&access_service, pipeline.id, EntityType::CrmPipeline, OWNER).await,
            serde_json::from_value(json!({"query":query})).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.rows.len(), 500);
    assert_eq!(first.rows[0].cells[&revenue], PropertyValue::Num(501.0));
    assert_eq!(
        first.rows.last().unwrap().cells[&revenue],
        PropertyValue::Num(2.0)
    );
    let second = service
        .query_rows(
            access(&access_service, pipeline.id, EntityType::CrmPipeline, OWNER).await,
            serde_json::from_value(json!({"query":query,"after":first.next})).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.rows.len(), 1);
    assert_eq!(second.rows[0].cells[&revenue], PropertyValue::Num(1.0));
    assert_eq!(second.version, first.version);
    assert!(second.next.is_none());
    let all = service
        .query_rows(
            access(&access_service, pipeline.id, EntityType::CrmPipeline, OWNER).await,
            StorageRowsQuery::default(),
        )
        .await
        .unwrap();
    let hidden = all
        .rows
        .iter()
        .find(|row| row.cells[&revenue] == PropertyValue::Num(0.0))
        .unwrap()
        .row_id;
    let retained = service
        .query_rows(
            access(&access_service, pipeline.id, EntityType::CrmPipeline, OWNER).await,
            serde_json::from_value(json!({"query":query,"rowIds":[hidden]})).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(retained.rows.len(), 1);
    assert_eq!(retained.rows[0].row_id, hidden);
}
