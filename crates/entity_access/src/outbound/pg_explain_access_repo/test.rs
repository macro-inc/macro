use super::*;
use crate::domain::{
    explain::ExplainAccessServiceImpl,
    models::{AccessLevel, EntityAccessSourceType},
    ports::ExplainAccessService,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn database_explanation_isolates_grants_and_tracks_team_membership(pool: PgPool) {
    let database_id = Uuid::now_v7();
    let other_database_id = Uuid::now_v7();
    let member = MacroUserIdStr::try_from_email("member@team.com").unwrap();
    let outsider = MacroUserIdStr::try_from_email("noteam@team.com").unwrap();
    let team_id = "00000000-0000-0000-0000-0000000ea001";

    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $3, 'user', 'view'),
               ($1, 'database', $4, 'team', 'edit'),
               ($1, 'database', '00000000-0000-0000-0000-0000000ea002', 'team', 'owner'),
               ($1, 'chat', $3, 'user', 'owner'),
               ($2, 'database', $3, 'user', 'owner')
        "#,
        database_id,
        other_database_id,
        member.as_ref(),
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let service = ExplainAccessServiceImpl::new(PgExplainAccessRepository::new(pool.clone()));
    let explanation = service
        .explain_access(&member, &database_id.to_string(), EntityType::Database)
        .await
        .unwrap();
    assert_eq!(
        explanation.effective_access_level(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(explanation.grants.len(), 2);
    let direct_grant = AccessGrant::EntityAccess {
        source_type: EntityAccessSourceType::User,
        source_id: member.as_ref().to_string(),
        access_level: AccessLevel::View,
        granted_from_project_id: None,
    };
    assert!(explanation.grants.contains(&direct_grant));
    assert!(explanation.grants.contains(&AccessGrant::EntityAccess {
        source_type: EntityAccessSourceType::Team,
        source_id: team_id.to_string(),
        access_level: AccessLevel::Edit,
        granted_from_project_id: None,
    }));

    let denied = service
        .explain_access(&outsider, &database_id.to_string(), EntityType::Database)
        .await
        .unwrap();
    assert_eq!(denied.effective_access_level(), None);
    assert!(denied.grants.is_empty());

    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", member.as_ref())
        .execute(&pool)
        .await
        .unwrap();
    let after_leaving_team = service
        .explain_access(&member, &database_id.to_string(), EntityType::Database)
        .await
        .unwrap();
    assert_eq!(
        after_leaving_team.effective_access_level(),
        Some(AccessLevel::View)
    );
    assert_eq!(after_leaving_team.grants, vec![direct_grant]);
}

#[tokio::test]
async fn database_explanation_rejects_invalid_ids_before_querying() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let repository = PgExplainAccessRepository::new(pool);
    let user = MacroUserIdStr::try_from_email("member@team.com").unwrap();
    let error = repository
        .list_access_grants(&user, "not-a-uuid", EntityType::Database)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        AccessError::BadRequest("Invalid database ID format")
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn database_row_explanation_is_its_database_grants(pool: PgPool) {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let row_id = Uuid::now_v7();
    let member = MacroUserIdStr::try_from_email("member@team.com").unwrap();

    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'db', 'macro|owner@team.com' FROM storage"#,
        database_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 't', 'a')"#,
        table_id,
        database_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, 'a')"#,
        row_id,
        table_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $2, 'user', 'edit')
        "#,
        database_id,
        member.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let service = ExplainAccessServiceImpl::new(PgExplainAccessRepository::new(pool.clone()));
    let explanation = service
        .explain_access(&member, &row_id.to_string(), EntityType::DatabaseRow)
        .await
        .unwrap();
    assert_eq!(
        explanation.effective_access_level(),
        Some(AccessLevel::Edit)
    );

    let unknown_row = service
        .explain_access(
            &member,
            &Uuid::now_v7().to_string(),
            EntityType::DatabaseRow,
        )
        .await
        .unwrap();
    assert!(unknown_row.grants.is_empty());
}

/// A database with one table and a form over it; returns `(database_id, form_id)`.
async fn insert_database_with_form(pool: &PgPool, audience: &str) -> (Uuid, Uuid) {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let form_id = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'db', 'macro|owner@team.com' FROM storage"#,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 't', 'a')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id, audience)
        VALUES ($1, 'RSVP', 'macro|owner@team.com', $2, $3, $4)
        "#,
        form_id,
        database_id,
        table_id,
        audience,
    )
    .execute(pool)
    .await
    .unwrap();
    (database_id, form_id)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn database_explanation_names_the_form_a_form_editor_reaches_it_through(pool: PgPool) {
    let (database_id, edited_form) = insert_database_with_form(&pool, "members").await;
    let member = MacroUserIdStr::try_from_email("member@team.com").unwrap();
    let viewed_form = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id)
        SELECT $1, 'Viewed', owner_id, database_id, table_id FROM forms WHERE id = $2
        "#,
        viewed_form,
        edited_form,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $3, 'user', 'edit'),
               ($2, 'form', $3, 'user', 'view'),
               ($4, 'database', $3, 'user', 'view')
        "#,
        edited_form,
        viewed_form,
        member.as_ref(),
        database_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let service = ExplainAccessServiceImpl::new(PgExplainAccessRepository::new(pool.clone()));
    let explanation = service
        .explain_access(&member, &database_id.to_string(), EntityType::Database)
        .await
        .unwrap();
    assert_eq!(
        explanation.effective_access_level(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        explanation.grants,
        vec![
            AccessGrant::EntityAccess {
                source_type: EntityAccessSourceType::User,
                source_id: member.as_ref().to_string(),
                access_level: AccessLevel::View,
                granted_from_project_id: None,
            },
            AccessGrant::ViaForm {
                form_id: edited_form
            },
        ]
    );

    let row_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO database_rows (id, table_id, position)
        SELECT $1, table_id, 'a' FROM forms WHERE id = $2
        "#,
        row_id,
        edited_form,
    )
    .execute(&pool)
    .await
    .unwrap();
    let row_explanation = service
        .explain_access(&member, &row_id.to_string(), EntityType::DatabaseRow)
        .await
        .unwrap();
    assert_eq!(row_explanation.grants, explanation.grants);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn form_explanation_lists_grants_and_the_public_audience(pool: PgPool) {
    let (_, public_form) = insert_database_with_form(&pool, "public").await;
    let (_, members_form) = insert_database_with_form(&pool, "members").await;
    let member = MacroUserIdStr::try_from_email("member@team.com").unwrap();
    let team_id = "00000000-0000-0000-0000-0000000ea001";
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $2, 'team', 'edit')
        "#,
        public_form,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let service = ExplainAccessServiceImpl::new(PgExplainAccessRepository::new(pool.clone()));
    let public = service
        .explain_access(&member, &public_form.to_string(), EntityType::Form)
        .await
        .unwrap();
    assert_eq!(public.effective_access_level(), Some(AccessLevel::Edit));
    assert_eq!(
        public.grants,
        vec![
            AccessGrant::EntityAccess {
                source_type: EntityAccessSourceType::Team,
                source_id: team_id.to_string(),
                access_level: AccessLevel::Edit,
                granted_from_project_id: None,
            },
            AccessGrant::PublicForm,
        ]
    );

    let members = service
        .explain_access(&member, &members_form.to_string(), EntityType::Form)
        .await
        .unwrap();
    assert_eq!(members.effective_access_level(), None);
    assert!(members.grants.is_empty());
}
