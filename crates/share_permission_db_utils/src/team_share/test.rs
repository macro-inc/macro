use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::team_share::{TeamShareRequest, authorize_team_share};
use sqlx::PgPool;

fn document() -> Entity<'static> {
    EntityType::Document.with_entity_string("20000000-0000-0000-0000-000000000002".to_string())
}

fn command(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        Some(&facts.owner),
        facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::Edit,
    )
    .unwrap()
    .unwrap()
}

async fn direct_team_rows(
    tx: &mut Transaction<'_, Postgres>,
    document_id: &Uuid,
    team_id: Uuid,
) -> sqlx::Result<Vec<AccessLevel>> {
    sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document' AND source_type = 'team'
          AND source_id = $2 AND granted_from_project_id IS NULL
        ORDER BY access_level"#,
        document_id,
        team_id.to_string(),
    )
    .fetch_all(tx.as_mut())
    .await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_inserts_updates_and_deletes_direct_team_entity_access(
    pool: PgPool,
) -> rootcause::Result<()> {
    let entity = document();
    let uuid = Uuid::parse_str(&entity.entity_id)?;
    let mut tx = pool.begin().await?;
    let facts = load_facts(&mut tx, &entity).await?;
    let team_id = facts
        .owner_team_id
        .expect("fixture owner belongs to a team");

    apply(&mut tx, &command(&facts, Some(AccessLevel::Comment))).await?;
    assert_eq!(
        direct_team_rows(&mut tx, &uuid, team_id).await?,
        vec![AccessLevel::Comment]
    );

    let facts = load_facts(&mut tx, &entity).await?;
    apply(&mut tx, &command(&facts, Some(AccessLevel::View))).await?;
    assert_eq!(
        direct_team_rows(&mut tx, &uuid, team_id).await?,
        vec![AccessLevel::View]
    );

    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, 'document', $2, 'team', 'edit', '20000000-0000-0000-0000-000000000001')"#,
        uuid,
        team_id.to_string(),
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(&mut tx, &entity).await?;
    apply(&mut tx, &command(&facts, None)).await?;
    assert!(direct_team_rows(&mut tx, &uuid, team_id).await?.is_empty());
    let inherited = sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document' AND source_type = 'team'
          AND granted_from_project_id IS NOT NULL"#,
        uuid,
    )
    .fetch_one(tx.as_mut())
    .await?;
    assert_eq!(inherited, AccessLevel::Edit);
    assert_eq!(load_facts(&mut tx, &entity).await?.current, None);
    Ok(())
}
