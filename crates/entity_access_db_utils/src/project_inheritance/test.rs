use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const ROOT: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000001);
const DOCUMENT: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000002);
const CHILD: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000003);
const TEAM: Uuid = Uuid::from_u128(0x10000000_0000_0000_0000_000000000001);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn scoped_propagation_preserves_overlapping_and_direct_grants(pool: PgPool) {
    let mut tx = pool.begin().await.unwrap();
    let other_team = Uuid::from_u128(0x10000000_0000_0000_0000_000000000002);
    synchronize_project_team_share(&mut tx, &ROOT, other_team, Some(AccessLevel::Edit))
        .await
        .unwrap();
    synchronize_project_team_share(&mut tx, &CHILD, TEAM, Some(AccessLevel::Comment))
        .await
        .unwrap();
    for level in [AccessLevel::Edit, AccessLevel::View, AccessLevel::View] {
        synchronize_project_team_share(&mut tx, &ROOT, TEAM, Some(level))
            .await
            .unwrap();
        let rows = sqlx::query!("SELECT access_level AS \"level: AccessLevel\" FROM entity_access WHERE granted_from_project_id = $1 AND source_id = $2", ROOT.to_string(), TEAM.to_string()).fetch_all(tx.as_mut()).await.unwrap();
        assert_eq!(rows.len(), 4); // child project, document, chat, thread
        assert!(rows.iter().all(|r| r.level == level));
    }
    synchronize_project_team_share(&mut tx, &ROOT, TEAM, None)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1 AND source_id = $2 AND access_level = 'edit'", ROOT.to_string(), other_team.to_string()).fetch_one(tx.as_mut()).await.unwrap(), Some(4));
    let rows = sqlx::query!("SELECT granted_from_project_id, access_level AS \"level: AccessLevel\" FROM entity_access WHERE entity_id = $1 AND source_id = $2", DOCUMENT, TEAM.to_string()).fetch_all(tx.as_mut()).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert!(
        rows.iter()
            .any(|r| r.granted_from_project_id.is_none() && r.level == AccessLevel::Edit)
    );
    assert!(
        rows.iter()
            .any(|r| r.granted_from_project_id == Some(CHILD.to_string())
                && r.level == AccessLevel::Comment)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn topology_sync_is_repeatable_and_rolls_back_with_parent_change(pool: PgPool) {
    let mut tx = pool.begin().await.unwrap();
    crate::team_share::acquire_guard(&mut tx).await.unwrap();
    crate::team_share::upsert_direct(
        tx.as_mut(),
        &ROOT,
        EntityType::Project,
        TEAM,
        AccessLevel::View,
    )
    .await
    .unwrap();
    crate::team_share::upsert_direct(
        tx.as_mut(),
        &CHILD,
        EntityType::Project,
        TEAM,
        AccessLevel::Comment,
    )
    .await
    .unwrap();
    synchronize_entity(&mut tx, &CHILD, EntityType::Project)
        .await
        .unwrap();
    synchronize_entity(&mut tx, &CHILD, EntityType::Project)
        .await
        .unwrap();
    // Refresh an existing inherited row rather than leaving its old higher level.
    crate::team_share::upsert_direct(
        tx.as_mut(),
        &CHILD,
        EntityType::Project,
        TEAM,
        AccessLevel::View,
    )
    .await
    .unwrap();
    synchronize_entity(&mut tx, &CHILD, EntityType::Project)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1 AND access_level = 'view'", CHILD.to_string()).fetch_one(tx.as_mut()).await.unwrap(), Some(3));
    assert!(
        synchronize_entity(&mut tx, &DOCUMENT, EntityType::Call)
            .await
            .is_err()
    );
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = NULL WHERE id = $1"#,
        CHILD.to_string()
    )
    .execute(tx.as_mut())
    .await
    .unwrap();
    synchronize_entity(&mut tx, &CHILD, EntityType::Project)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1",
            ROOT.to_string()
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1",
            CHILD.to_string()
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap(),
        Some(3)
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT "parentId" FROM "Project" WHERE id = $1"#,
            CHILD.to_string()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(ROOT.to_string())
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1",
            ROOT.to_string()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(1)
    );
}
