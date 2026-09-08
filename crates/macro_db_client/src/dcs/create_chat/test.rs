use super::*;
use models_permissions::share_permission::team_share::{
    TeamShareLevel, TeamShareRequest, authorize_team_share,
};
use share_permission_db_utils::team_share::{apply, load_facts};
use sqlx::PgPool;
use uuid::Uuid;

const PROJECT: &str = "20000000-0000-0000-0000-000000000001";

async fn share_project(pool: &PgPool, level: AccessLevel) {
    let mut tx = pool.begin().await.unwrap();
    let project = EntityType::Project.with_entity_string(PROJECT.to_string());
    let facts = load_facts(&mut tx, &project).await.unwrap();
    let command = authorize_team_share(
        Some(&facts.owner),
        &facts,
        TeamShareRequest {
            access_level: Some(Some(level)),
            legacy_enabled: None,
        },
        TeamShareLevel::Edit,
    )
    .unwrap()
    .unwrap();
    apply(&mut tx, &command).await.unwrap();
    tx.commit().await.unwrap();
}

async fn create(pool: &PgPool, project: Option<&str>) -> anyhow::Result<String> {
    let mut permission = SharePermissionV2::new_chat_share_permission(None);
    permission.team_share_access_level = Some(AccessLevel::Edit);
    create_chat_v2(
        pool,
        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
        "Legacy chat",
        "model",
        project,
        &permission,
        vec![],
        0,
        true,
    )
    .await
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn legacy_creation_inherits_current_level_without_explicit_consent(pool: PgPool) {
    for level in [AccessLevel::Edit, AccessLevel::View, AccessLevel::Comment] {
        share_project(&pool, level).await;
        let id = create(&pool, Some(PROJECT)).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let facts = load_facts(&mut tx, &EntityType::Chat.with_entity_string(id.clone()))
            .await
            .unwrap();
        assert_eq!(facts.current, None);
        assert_eq!(facts.revision, 0);
        let inherited = sqlx::query_scalar!(
            r#"SELECT access_level AS "level: AccessLevel" FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'chat' AND source_type = 'team'
            AND granted_from_project_id = $2"#,
            Uuid::parse_str(&id).unwrap(),
            PROJECT,
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap();
        assert_eq!(inherited, level);
        tx.commit().await.unwrap();
    }
    let id = create(&pool, None).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    let facts = load_facts(&mut tx, &EntityType::Chat.with_entity_string(id.clone()))
        .await
        .unwrap();
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE entity_id = $1 AND source_type = 'team'",
            Uuid::parse_str(&id).unwrap()
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn inheritance_failure_rolls_back_legacy_chat_creation(pool: PgPool) {
    share_project(&pool, AccessLevel::View).await;
    sqlx::raw_sql("CREATE FUNCTION reject_inheritance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.granted_from_project_id IS NOT NULL THEN RAISE EXCEPTION 'injected inheritance failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inheritance BEFORE INSERT ON entity_access FOR EACH ROW EXECUTE FUNCTION reject_inheritance();")
        .execute(&pool).await.unwrap();
    assert!(create(&pool, Some(PROJECT)).await.is_err());
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "Chat" WHERE name = 'Legacy chat'"#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "SharePermission""#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(5)
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "UserHistory""#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}
