use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn project_grant_skips_legacy_children_and_preserves_modern_grants(pool: PgPool) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "projectId")
        VALUES ('legacy-document-id', 'Legacy document', 'macro|owner@example.com',
            '20000000-0000-0000-0000-000000000003')"#
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    set(
        &mut tx,
        &macro_uuid::Uuid::from_u128(0x20000000000000000000000000000001),
        EntityType::Project,
        &MacroUserIdStr::parse_from_str("macro|reader@example.com").unwrap(),
        Some(AccessLevel::Comment),
        true,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let grants = sqlx::query!(
        r#"SELECT entity_id, entity_type, access_level AS "access_level: AccessLevel"
        FROM entity_access WHERE source_type = 'user' AND source_id = 'macro|reader@example.com'
        ORDER BY entity_id"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(grants.len(), 5);
    assert!(
        grants
            .iter()
            .all(|grant| grant.access_level == AccessLevel::Comment)
    );
    assert!(grants.iter().any(|grant| grant.entity_id
        == macro_uuid::Uuid::from_u128(0x20000000000000000000000000000002)
        && grant.entity_type == "document"));
}

/// Nobody shares a computer's harness directly, its buyer included: it
/// belongs to the computer's team.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_harness_has_no_direct_sharing_facts(pool: PgPool) {
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
        VALUES
            ('00000000-0000-0000-0000-0000000000a1', 'Laptop', 'macro|owner@example.com',
                'macro|owner@example.com', NULL),
            ('00000000-0000-0000-0000-0000000000a2', 'Computer', 'macro|owner@example.com',
                'macro|owner@example.com', '00000000-0000-0000-0000-0000000000c1')
        "#
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(
        facts(
            &mut tx,
            &macro_uuid::Uuid::from_u128(0xa1),
            EntityType::Harness,
        )
        .await
        .unwrap()
        .is_some()
    );
    assert!(
        facts(
            &mut tx,
            &macro_uuid::Uuid::from_u128(0xa2),
            EntityType::Harness,
        )
        .await
        .unwrap()
        .is_none()
    );
}
