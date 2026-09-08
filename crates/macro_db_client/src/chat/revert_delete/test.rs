use super::*;
use entity_access_db_utils::project_inheritance::synchronize_entity;
use model_entity::EntityType;
use models_permissions::share_permission::{
    access_level::AccessLevel,
    team_share::{TeamShareLevel, TeamShareMaintenance, TeamShareRequest, authorize_team_share},
};
use share_permission_db_utils::team_share::{apply, load_facts, maintain};
use sqlx::PgPool;
use uuid::Uuid;

const PROJECT: &str = "20000000-0000-0000-0000-000000000001";
const CHAT: &str = "20000000-0000-0000-0000-000000000003";

async fn setup(pool: &PgPool) {
    let mut tx = pool.begin().await.unwrap();
    for (kind, id, level) in [
        (EntityType::Chat, CHAT, AccessLevel::Comment),
        (EntityType::Project, PROJECT, AccessLevel::Edit),
    ] {
        let facts = load_facts(&mut tx, &kind.with_entity_string(id.to_string()))
            .await
            .unwrap();
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
    }
    sqlx::query!(
        r#"UPDATE "Chat" SET "projectId" = $1 WHERE id = $2"#,
        PROJECT,
        CHAT
    )
    .execute(tx.as_mut())
    .await
    .unwrap();
    synchronize_entity(&mut tx, &Uuid::parse_str(CHAT).unwrap(), EntityType::Chat)
        .await
        .unwrap();
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'chat', 'macro|other@example.com', 'user', 'view')"#,
        Uuid::parse_str(CHAT).unwrap()
    )
    .execute(tx.as_mut())
    .await
    .unwrap();
    tx.commit().await.unwrap();
    crate::chat::delete::soft_delete_chat(pool, CHAT)
        .await
        .unwrap();
}

async fn delete_parent(pool: &PgPool) {
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1"#,
        PROJECT
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn legacy_restore_preserves_consent_but_never_recreates_cleaned_share(pool: PgPool) {
    setup(&pool).await;
    delete_parent(&pool).await;
    let entity = EntityType::Chat.with_entity_string(CHAT.to_string());
    for (cleaned, hint) in [(false, Some(PROJECT)), (true, None)] {
        let mut tx = pool.begin().await.unwrap();
        let facts = load_facts(&mut tx, &entity).await.unwrap();
        if cleaned {
            // T15 cleanup clears consent even if the owner later rejoins a team.
            maintain(&mut tx, &TeamShareMaintenance::Clear { expected: facts })
                .await
                .unwrap();
            sqlx::query!(
                r#"UPDATE "Chat" SET "projectId" = $1, "deletedAt" = NOW() WHERE id = $2"#,
                PROJECT,
                CHAT
            )
            .execute(tx.as_mut())
            .await
            .unwrap();
            synchronize_entity(&mut tx, &Uuid::parse_str(CHAT).unwrap(), EntityType::Chat)
                .await
                .unwrap();
        }
        let before = load_facts(&mut tx, &entity).await.unwrap();
        tx.commit().await.unwrap();
        revert_delete_chat(&pool, CHAT, hint).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(load_facts(&mut tx, &entity).await.unwrap(), before);
        assert_eq!(before.current.is_none(), cleaned);
        let row = sqlx::query!(
            r#"SELECT "projectId" as project_id, "deletedAt" as deleted_at FROM "Chat" WHERE id = $1"#,
            CHAT
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap();
        assert!(row.project_id.is_none());
        assert!(row.deleted_at.is_none());
        let grants = sqlx::query!("SELECT source_type::text AS source_type, granted_from_project_id FROM entity_access WHERE entity_id = $1", Uuid::parse_str(CHAT).unwrap())
            .fetch_all(tx.as_mut()).await.unwrap();
        assert!(grants.iter().all(|r| r.granted_from_project_id.is_none()));
        assert_eq!(
            grants
                .iter()
                .filter(|r| r.source_type.as_deref() == Some("team"))
                .count(),
            usize::from(!cleaned)
        );
        assert_eq!(
            grants
                .iter()
                .filter(|r| r.source_type.as_deref() == Some("user"))
                .count(),
            1
        );
        tx.commit().await.unwrap();
    }
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn legacy_restore_uses_current_parent_not_stale_hint(pool: PgPool) {
    setup(&pool).await;
    sqlx::query!(r#"INSERT INTO "Project" (id, name, "userId", "deletedAt") VALUES ('stale-parent', 'Stale', 'macro|owner@example.com', NOW())"#)
        .execute(&pool).await.unwrap();
    revert_delete_chat(&pool, CHAT, Some("stale-parent"))
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT "projectId" as project_id FROM "Chat" WHERE id = $1"#,
            CHAT
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .as_deref(),
        Some(PROJECT)
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE entity_id = $1 AND granted_from_project_id = $2", Uuid::parse_str(CHAT).unwrap(), PROJECT)
        .fetch_one(&pool).await.unwrap(), Some(1));
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn legacy_restore_rolls_back_when_inheritance_cleanup_fails(pool: PgPool) {
    setup(&pool).await;
    delete_parent(&pool).await;
    sqlx::raw_sql("CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.granted_from_project_id IS NOT NULL THEN RAISE EXCEPTION 'injected cleanup failure'; END IF; RETURN OLD; END $$; CREATE TRIGGER reject_cleanup BEFORE DELETE ON entity_access FOR EACH ROW EXECUTE FUNCTION reject_cleanup();")
        .execute(&pool).await.unwrap();
    assert!(
        revert_delete_chat(&pool, CHAT, Some(PROJECT))
            .await
            .is_err()
    );
    let row = sqlx::query!(
        r#"SELECT "projectId" as project_id, "deletedAt" as deleted_at FROM "Chat" WHERE id = $1"#,
        CHAT
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.project_id.as_deref(), Some(PROJECT));
    assert!(row.deleted_at.is_some());
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) FROM "UserHistory" WHERE "itemId" = $1"#,
            CHAT
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(fixtures(
    path = "../../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn permanent_deletion_removes_canonical_bookkeeping_and_all_grants(pool: PgPool) {
    setup(&pool).await;
    crate::chat::delete::delete_chat(&pool, CHAT).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "SharePermission" WHERE id = 'chat'"#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE entity_id = $1",
            Uuid::parse_str(CHAT).unwrap()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) FROM "ChatPermission" WHERE "chatId" = $1"#,
            CHAT
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
}
