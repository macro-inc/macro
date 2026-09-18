use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::team_share::{TeamShareRequest, authorize_team_share};
use sqlx::PgPool;

fn project() -> Entity<'static> {
    EntityType::Project.with_entity_string("20000000-0000-0000-0000-000000000001".to_string())
}

fn document() -> Entity<'static> {
    EntityType::Document.with_entity_string("20000000-0000-0000-0000-000000000002".to_string())
}

fn initiative() -> Entity<'static> {
    EntityType::Initiative.with_entity_string("20000000-0000-0000-0000-000000000007".to_string())
}

fn chat() -> Entity<'static> {
    EntityType::Chat.with_entity_string("20000000-0000-0000-0000-000000000003".to_string())
}

fn active_call() -> Entity<'static> {
    EntityType::Call.with_entity_string("20000000-0000-0000-0000-000000000005".to_string())
}

fn archived_call() -> Entity<'static> {
    EntityType::Call.with_entity_string("20000000-0000-0000-0000-000000000006".to_string())
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
    entity_id: &Uuid,
    entity_type: EntityType,
    team_id: Uuid,
) -> sqlx::Result<Vec<AccessLevel>> {
    sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
          AND source_id = $3 AND granted_from_project_id IS NULL
        ORDER BY access_level"#,
        entity_id,
        entity_type.as_ref(),
        team_id.to_string(),
    )
    .fetch_all(tx.as_mut())
    .await
}

async fn apply_comment_view_and_clear(
    tx: &mut Transaction<'_, Postgres>,
    entity: &Entity<'_>,
) -> rootcause::Result<()> {
    let uuid = Uuid::parse_str(&entity.entity_id)?;
    let facts = load_facts(tx, entity).await?;
    let team_id = facts
        .owner_team_id
        .expect("fixture owner belongs to a team");

    apply(tx, &command(&facts, Some(AccessLevel::Comment))).await?;
    assert_eq!(
        direct_team_rows(tx, &uuid, entity.entity_type, team_id).await?,
        vec![AccessLevel::Comment]
    );

    let facts = load_facts(tx, entity).await?;
    apply(tx, &command(&facts, Some(AccessLevel::View))).await?;
    assert_eq!(
        direct_team_rows(tx, &uuid, entity.entity_type, team_id).await?,
        vec![AccessLevel::View]
    );

    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, $2, $3, 'team', 'edit', '20000000-0000-0000-0000-000000000001')"#,
        uuid,
        entity.entity_type.as_ref(),
        team_id.to_string(),
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(tx, entity).await?;
    apply(tx, &command(&facts, None)).await?;
    assert!(
        direct_team_rows(tx, &uuid, entity.entity_type, team_id)
            .await?
            .is_empty()
    );
    let inherited = sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
          AND granted_from_project_id IS NOT NULL"#,
        uuid,
        entity.entity_type.as_ref(),
    )
    .fetch_one(tx.as_mut())
    .await?;
    assert_eq!(inherited, AccessLevel::Edit);
    assert_eq!(load_facts(tx, entity).await?.current, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_inserts_updates_and_deletes_direct_team_entity_access(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    apply_comment_view_and_clear(&mut tx, &document()).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_inserts_updates_and_deletes_direct_team_entity_access_for_initiative(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    apply_comment_view_and_clear(&mut tx, &initiative()).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_inserts_updates_and_deletes_direct_team_entity_access_for_chat(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    apply_comment_view_and_clear(&mut tx, &chat()).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_inserts_updates_and_deletes_direct_team_entity_access_for_calls(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    apply_comment_view_and_clear(&mut tx, &active_call()).await?;
    apply_comment_view_and_clear(&mut tx, &archived_call()).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn load_facts_prefers_active_call_over_archived_record_with_same_id(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    // Model the archive hand-off: an archived row with the active call's id and
    // permission, but a different creator, exists at the same time.
    sqlx::query!(
        r#"INSERT INTO call_records
            (id, channel_id, room_name, created_by, started_at, duration_ms, share_permission_id)
        VALUES ('20000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001',
            'active', 'macro|other@example.com', now(), 0, 'active-call')"#
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(&mut tx, &active_call()).await?;

    assert_eq!(facts.owner.as_ref(), "macro|owner@example.com");
    assert_eq!(facts.current, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn initialize_call_grants_view_to_creator_team_or_nothing(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;

    // A creator on a team: View, attributed to that team, revision 1.
    let entity = active_call();
    let uuid = Uuid::parse_str(&entity.entity_id)?;
    let team_id = load_facts(&mut tx, &entity)
        .await?
        .owner_team_id
        .expect("fixture owner belongs to a team");
    initialize(&mut tx, &entity, TeamShareCreation::Call).await?;
    let facts = load_facts(&mut tx, &entity).await?;
    assert_eq!(
        facts.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::View,
        })
    );
    assert_eq!(facts.revision, 1);
    assert_eq!(
        direct_team_rows(&mut tx, &uuid, EntityType::Call, team_id).await?,
        vec![AccessLevel::View]
    );

    // A creator without a team: nothing is promised, revision stays 0.
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@example.com'")
        .execute(tx.as_mut())
        .await?;
    let entity = archived_call();
    initialize(&mut tx, &entity, TeamShareCreation::Call).await?;
    let facts = load_facts(&mut tx, &entity).await?;
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn initialize_grants_comment_to_owner_team_for_initiative(
    pool: PgPool,
) -> rootcause::Result<()> {
    let entity = initiative();
    let uuid = Uuid::parse_str(&entity.entity_id)?;
    let mut tx = pool.begin().await?;

    let facts = load_facts(&mut tx, &entity).await?;
    let team_id = facts
        .owner_team_id
        .expect("fixture owner belongs to a team");
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);

    initialize(&mut tx, &entity, TeamShareCreation::ExplicitTask).await?;

    let facts = load_facts(&mut tx, &entity).await?;
    assert_eq!(
        facts.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::Comment,
        })
    );
    assert_eq!(facts.revision, 1);
    assert_eq!(
        direct_team_rows(&mut tx, &uuid, EntityType::Initiative, team_id).await?,
        vec![AccessLevel::Comment]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn apply_project_team_share_copies_and_clears_nested_contents(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    let entity = project();
    let project_id = entity.entity_id.as_ref();
    let nested_document = document();
    let document_id = Uuid::parse_str(&nested_document.entity_id)?;
    let nested_id = Uuid::from_u128(0x20000000_0000_0000_0000_000000000010);
    sqlx::query!(
        r#"UPDATE "Document" SET "projectId" = $1 WHERE id = $2"#,
        project_id,
        nested_document.entity_id.as_ref(),
    )
    .execute(tx.as_mut())
    .await?;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "projectId")
        VALUES ($1, 'Later', 'macro|owner@example.com', $2)"#,
        nested_id.to_string(),
        project_id,
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(&mut tx, &entity).await?;
    let team_id = facts
        .owner_team_id
        .expect("fixture owner belongs to a team");
    apply(&mut tx, &command(&facts, Some(AccessLevel::Edit))).await?;

    let inherited = sqlx::query!(
        r#"SELECT entity_id, entity_type, access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE granted_from_project_id = $1 AND source_type = 'team' AND source_id = $2
        ORDER BY entity_id"#,
        project_id,
        team_id.to_string(),
    )
    .fetch_all(tx.as_mut())
    .await?;
    assert_eq!(inherited.len(), 2);
    assert_eq!(inherited[0].entity_id, document_id);
    assert_eq!(inherited[0].entity_type, "document");
    assert_eq!(inherited[0].access_level, AccessLevel::Edit);
    assert_eq!(inherited[1].entity_id, nested_id);
    assert_eq!(inherited[1].access_level, AccessLevel::Edit);

    let stale_id = Uuid::from_u128(0x20000000_0000_0000_0000_000000000099);
    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, 'email_thread', $2, 'team', 'edit', $3)"#,
        stale_id,
        team_id.to_string(),
        project_id,
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(&mut tx, &entity).await?;
    apply(&mut tx, &command(&facts, Some(AccessLevel::View))).await?;
    let inherited = sqlx::query!(
        r#"SELECT entity_id, entity_type, access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE granted_from_project_id = $1 AND source_type = 'team'
        ORDER BY entity_id"#,
        project_id,
    )
    .fetch_all(tx.as_mut())
    .await?;
    assert_eq!(inherited.len(), 2);
    assert_eq!(inherited[0].entity_id, document_id);
    assert_eq!(inherited[0].access_level, AccessLevel::View);
    assert_eq!(inherited[1].entity_id, nested_id);
    assert_eq!(inherited[1].access_level, AccessLevel::View);

    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, 'chat', $2, 'team', 'view', $3)"#,
        Uuid::parse_str(&chat().entity_id)?,
        team_id.to_string(),
        project_id,
    )
    .execute(tx.as_mut())
    .await?;

    let facts = load_facts(&mut tx, &entity).await?;
    apply(&mut tx, &command(&facts, None)).await?;
    let remaining = sqlx::query_scalar!(
        r#"SELECT count(*) FROM entity_access
        WHERE granted_from_project_id = $1 AND source_type = 'team'"#,
        project_id,
    )
    .fetch_one(tx.as_mut())
    .await?;
    assert_eq!(remaining, Some(0));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn load_facts_rejects_unsupported_entity_type(pool: PgPool) -> rootcause::Result<()> {
    let entity =
        EntityType::User.with_entity_string("20000000-0000-0000-0000-000000000001".to_string());
    let mut tx = pool.begin().await?;
    let error = load_facts(&mut tx, &entity).await.unwrap_err();
    assert_eq!(*error.current_context(), TeamShareError::InvalidEntity);
    Ok(())
}
