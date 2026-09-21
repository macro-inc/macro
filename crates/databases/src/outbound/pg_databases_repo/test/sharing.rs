use super::*;
use crate::domain::sharing::DatabaseSharingRepo;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_channel_grants_can_be_changed_and_revoked_without_touching_owner(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let channel_id = macro_uuid::generate_uuid_v7().to_string();
    for (operation, level) in [
        (UpdateOperation::Add, Some(AccessLevel::View)),
        (UpdateOperation::Replace, Some(AccessLevel::Edit)),
        (UpdateOperation::Remove, None),
    ] {
        assert!(
            repo.update_channel_grants(
                table.database_id,
                &[UpdateChannelSharePermission {
                    channel_id: channel_id.clone(),
                    operation,
                    access_level: level,
                }]
            )
            .await
            .unwrap()
        );
        let grants = repo.channel_grants(table.database_id).await.unwrap();
        assert_eq!(grants.first().map(|grant| grant.access_level), level);
        let owner = sqlx::query_scalar!(r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access WHERE entity_id = $1 AND source_type = 'user' AND source_id = $2"#, table.database_id, USER).fetch_one(&pool).await.unwrap();
        assert_eq!(owner, AccessLevel::Owner);
    }
    repo.trash_database(table.database_id, chrono::Utc::now())
        .await
        .unwrap();
    assert!(
        !repo
            .update_channel_grants(
                table.database_id,
                &[UpdateChannelSharePermission {
                    channel_id,
                    operation: UpdateOperation::Add,
                    access_level: Some(AccessLevel::View),
                }]
            )
            .await
            .unwrap()
    );
    assert!(
        repo.channel_grants(table.database_id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sharing_a_reference_does_not_downgrade_existing_channel_access(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let channel_id = macro_uuid::generate_uuid_v7();
    repo.update_channel_grants(
        table.database_id,
        &[UpdateChannelSharePermission {
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Add,
            access_level: Some(AccessLevel::Edit),
        }],
    )
    .await
    .unwrap();
    entity_access_db_utils::insert_direct_channel_grant_if_absent(
        &pool,
        &table.database_id,
        EntityType::Database,
        &channel_id,
        AccessLevel::View,
    )
    .await
    .unwrap();
    assert_eq!(
        repo.channel_grants(table.database_id).await.unwrap()[0].access_level,
        AccessLevel::Edit
    );
}
