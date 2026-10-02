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
        let owner = sqlx::query_scalar!(r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access WHERE entity_id = $1 AND source_type = 'user' AND source_id = $2"#, table.database_id.into_uuid(), USER).fetch_one(&pool).await.unwrap();
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
    let mut transaction = pool.begin().await.unwrap();
    entity_access_db_utils::channel_share::insert_if_absent(
        &mut transaction,
        table.database_id.as_uuid(),
        EntityType::Database,
        &channel_id,
        AccessLevel::View,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    assert_eq!(
        repo.channel_grants(table.database_id).await.unwrap()[0].access_level,
        AccessLevel::Edit
    );
}
