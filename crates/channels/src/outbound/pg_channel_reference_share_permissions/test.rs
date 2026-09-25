use super::*;
use entity_access_db_utils::{EntityAccessSourceType, insert_entity_access_row};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn session_references_grant_view_and_preserve_existing_channel_access(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    for existing in [
        None,
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
    ] {
        let session_id = Uuid::now_v7();
        let item = ReferencedShareItem::new(
            session_id.to_string(),
            ReferencedShareItemType::AgentSession,
        );
        if let Some(level) = existing {
            let mut tx = pool.begin().await.unwrap();
            insert_entity_access_row(
                &mut tx,
                &session_id,
                EntityType::AgentSession,
                &channel_id.to_string(),
                EntityAccessSourceType::Channel,
                level,
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }
        let automatic_level = grant_level(item.entity_type(), Some(AccessLevel::Owner)).unwrap();
        for _ in 0..2 {
            ensure_referenced_item_visible_to_channel(&pool, channel_id, &item, automatic_level)
                .await
                .unwrap();
        }
        let levels = sqlx::query_scalar!(
            r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'agent_session' AND source_id = $2
                AND source_type = 'channel' AND granted_from_project_id IS NULL"#,
            session_id,
            channel_id.to_string(),
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(levels, vec![existing.unwrap_or(AccessLevel::View)]);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_event_references_grant_the_channel_view_without_a_share_permission(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    let event_id = Uuid::now_v7();
    let item = ReferencedShareItem::from_raw(event_id.to_string(), "calendar_event").unwrap();
    let level = grant_level(item.entity_type(), Some(AccessLevel::Owner)).unwrap();
    for _ in 0..2 {
        ensure_referenced_item_visible_to_channel(&pool, channel_id, &item, level)
            .await
            .unwrap();
    }
    let levels: Vec<AccessLevel> = sqlx::query_scalar(
        r#"SELECT access_level FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'calendar_event' AND source_id = $2
            AND source_type = 'channel' AND granted_from_project_id IS NULL"#,
    )
    .bind(event_id)
    .bind(channel_id.to_string())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(levels, vec![AccessLevel::View]);
}
