use super::*;
use entity_access_db_utils::{EntityAccessSourceType, insert_entity_access_row};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const PDF_DOCUMENT_ID: &str = "20000000-0000-0000-0000-000000000001";
const MD_DOCUMENT_ID: &str = "20000000-0000-0000-0000-000000000002";

async fn document_channel_levels(
    pool: &PgPool,
    document_id: &str,
    channel_id: Uuid,
) -> (Option<AccessLevel>, Option<AccessLevel>) {
    let share_level = sqlx::query_scalar!(
        r#"SELECT csp.access_level AS "access_level: AccessLevel"
        FROM "ChannelSharePermission" csp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = csp.share_permission_id
        WHERE dp."documentId" = $1 AND csp.channel_id = $2"#,
        document_id,
        channel_id.to_string(),
    )
    .fetch_optional(pool)
    .await
    .unwrap();
    let entity_access_level = sqlx::query_scalar!(
        r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document' AND source_id = $2
            AND source_type = 'channel' AND granted_from_project_id IS NULL"#,
        macro_uuid::string_to_uuid(document_id).unwrap(),
        channel_id.to_string(),
    )
    .fetch_optional(pool)
    .await
    .unwrap();
    (share_level, entity_access_level)
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("reference_share_documents")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn pdf_references_grant_the_channel_comment_access(pool: PgPool) {
    let item = ReferencedShareItem::from_raw(PDF_DOCUMENT_ID, "document").unwrap();
    for sharer_access in [AccessLevel::Comment, AccessLevel::Edit, AccessLevel::Owner] {
        let channel_id = Uuid::now_v7();
        share_referenced_item_with_channel(&pool, channel_id, &item, Some(sharer_access))
            .await
            .unwrap();
        assert_eq!(
            document_channel_levels(&pool, PDF_DOCUMENT_ID, channel_id).await,
            (Some(AccessLevel::Comment), Some(AccessLevel::Comment))
        );
    }
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("reference_share_documents")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn pdf_references_never_grant_more_than_the_sharer_holds(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    let item = ReferencedShareItem::from_raw(PDF_DOCUMENT_ID, "document").unwrap();
    share_referenced_item_with_channel(&pool, channel_id, &item, Some(AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(
        document_channel_levels(&pool, PDF_DOCUMENT_ID, channel_id).await,
        (Some(AccessLevel::View), Some(AccessLevel::View))
    );

    let unshared_channel_id = Uuid::now_v7();
    share_referenced_item_with_channel(&pool, unshared_channel_id, &item, None)
        .await
        .unwrap();
    assert_eq!(
        document_channel_levels(&pool, PDF_DOCUMENT_ID, unshared_channel_id).await,
        (None, None)
    );
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("reference_share_documents")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn non_pdf_document_references_grant_the_channel_view_access(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    let item = ReferencedShareItem::from_raw(MD_DOCUMENT_ID, "document").unwrap();
    share_referenced_item_with_channel(&pool, channel_id, &item, Some(AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        document_channel_levels(&pool, MD_DOCUMENT_ID, channel_id).await,
        (Some(AccessLevel::View), Some(AccessLevel::View))
    );
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("reference_share_documents")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn pdf_references_keep_the_channel_access_the_owner_already_chose(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    let item = ReferencedShareItem::from_raw(PDF_DOCUMENT_ID, "document").unwrap();
    ensure_referenced_item_visible_to_channel(&pool, channel_id, &item, AccessLevel::View)
        .await
        .unwrap();
    share_referenced_item_with_channel(&pool, channel_id, &item, Some(AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        document_channel_levels(&pool, PDF_DOCUMENT_ID, channel_id).await,
        (Some(AccessLevel::View), Some(AccessLevel::View))
    );
}

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
        let automatic_level =
            grant_level(item.entity_type(), None, Some(AccessLevel::Owner)).unwrap();
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
    let level = grant_level(item.entity_type(), None, Some(AccessLevel::Owner)).unwrap();
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn form_references_grant_the_channel_view_and_keep_an_existing_grant(pool: PgPool) {
    let channel_id = Uuid::now_v7();
    for existing in [None, Some(AccessLevel::View), Some(AccessLevel::Edit)] {
        let form_id = Uuid::now_v7();
        let item = ReferencedShareItem::from_raw(form_id.to_string(), "form").unwrap();
        if let Some(level) = existing {
            let mut transaction = pool.begin().await.unwrap();
            insert_entity_access_row(
                &mut transaction,
                &form_id,
                EntityType::Form,
                &channel_id.to_string(),
                EntityAccessSourceType::Channel,
                level,
            )
            .await
            .unwrap();
            transaction.commit().await.unwrap();
        }
        let level = grant_level(item.entity_type(), None, Some(AccessLevel::Owner)).unwrap();
        for _ in 0..2 {
            ensure_referenced_item_visible_to_channel(&pool, channel_id, &item, level)
                .await
                .unwrap();
        }
        let levels = sqlx::query_scalar!(
            r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'form' AND source_id = $2
                AND source_type = 'channel' AND granted_from_project_id IS NULL"#,
            form_id,
            channel_id.to_string(),
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(levels, vec![existing.unwrap_or(AccessLevel::View)]);
    }
}
