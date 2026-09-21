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
