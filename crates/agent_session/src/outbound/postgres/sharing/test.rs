use super::*;
use crate::domain::ports::AgentSessionRepo;
use crate::outbound::postgres::test::{
    create_session, create_test_bot, insert_originating_thread_fixture, new_session, test_repo,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::PgPool;

fn request() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_channel_grants_are_visible_before_settings_are_created(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let (channel, thread, message) = insert_originating_thread_fixture(&pool).await;
    let session = create_session(&repo, new_session(bot, Some(thread), Some(message))).await;
    let settings = repo.permissions(session.id).await.unwrap();
    assert_eq!(settings.link_share, None);
    assert_eq!(
        settings.channel_share_permissions,
        Some(vec![ChannelSharePermission {
            channel_id: channel.to_string(),
            // `create_test_bot` is a private agent.
            access_level: AccessLevel::View
        }])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settings_and_channel_grants_round_trip_without_promoting_viewers(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let channel = macro_uuid::generate_uuid_v7().to_string();
    let initial = repo.permissions(session.id).await.unwrap();
    assert_eq!(initial.link_share, None);
    assert_eq!(initial.channel_share_permissions, Some(vec![]));
    let shared = repo
        .update_permissions(
            session.id,
            UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Public)),
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    channel_id: channel.clone(),
                    operation: UpdateOperation::Add,
                    access_level: Some(AccessLevel::Edit),
                }]),
                ..request()
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(shared.link_share_access_level, Some(AccessLevel::View));
    let downgraded = repo
        .update_permissions(
            session.id,
            UpdateSharePermissionRequestV2 {
                link_share_access_level: Some(Some(AccessLevel::Comment)),
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    channel_id: channel.clone(),
                    operation: UpdateOperation::Replace,
                    access_level: Some(AccessLevel::View),
                }]),
                ..request()
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(downgraded.link_share, Some(LinkShare::Public));
    assert_eq!(
        downgraded.link_share_access_level,
        Some(AccessLevel::Comment)
    );
    assert_eq!(
        downgraded.channel_share_permissions.unwrap()[0].access_level,
        AccessLevel::View
    );
    let revoked = repo
        .update_permissions(
            session.id,
            UpdateSharePermissionRequestV2 {
                link_share: Some(None),
                link_share_access_level: Some(Some(AccessLevel::Edit)),
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    channel_id: channel,
                    operation: UpdateOperation::Remove,
                    access_level: None,
                }]),
                ..request()
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(revoked.link_share, None);
    assert_eq!(revoked.link_share_access_level, None);
    assert_eq!(revoked.channel_share_permissions, Some(vec![]));
    assert_eq!(repo.permissions(session.id).await.unwrap(), revoked);
    AgentSessionRepo::delete(&repo, session.id).await.unwrap();
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM "SharePermission" WHERE id = $1) AS "exists!""#,
            shared.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_scopes_levels_and_resets_persist(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    for scope in [LinkShare::Public, LinkShare::Team] {
        for level in [AccessLevel::View, AccessLevel::Edit] {
            let saved = repo
                .update_permissions(
                    session.id,
                    UpdateSharePermissionRequestV2 {
                        link_share: Some(Some(scope)),
                        link_share_access_level: Some(Some(level)),
                        ..request()
                    },
                    None,
                )
                .await
                .unwrap();
            assert_eq!(saved.link_share, Some(scope));
            assert_eq!(saved.link_share_access_level, Some(level));
            assert_eq!(repo.permissions(session.id).await.unwrap(), saved);
        }
    }
    let reset = repo
        .update_permissions(
            session.id,
            UpdateSharePermissionRequestV2 {
                link_share_access_level: Some(None),
                ..request()
            },
            None,
        )
        .await
        .unwrap();
    assert_eq!(reset.link_share, Some(LinkShare::Team));
    assert_eq!(reset.link_share_access_level, Some(AccessLevel::View));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn private_thread_sessions_retain_their_audience_and_cannot_be_shared(pool: PgPool) {
    let bot_id = create_test_bot(&pool).await;
    let (_, root, _) = insert_originating_thread_fixture(&pool).await;
    // The trigger enforces immutable audiences; create a separate private root.
    let private_root = macro_uuid::Uuid::now_v7();
    let params = new_session(bot_id, Some(private_root), Some(private_root));
    let owner = params.owner_id.principal_id();
    sqlx::query!(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content, visibility) SELECT $1, parent_entity_type, parent_entity_id, sender_id, content, jsonb_build_object('type','private','user_id',$3::text,'bot_ids',jsonb_build_array()) FROM comms_messages WHERE id = $2",
        private_root, root, owner
    ).execute(&pool).await.unwrap();
    let repo = test_repo(&pool);
    let session = create_session(&repo, params).await;
    assert!(!session.thread_visibility.as_ref().unwrap().is_public());
    let loaded = repo.get(session.id).await.unwrap();
    assert_eq!(loaded.thread_visibility, session.thread_visibility);
    assert!(repo.is_private_conversation(session.id).await.unwrap());
    let mut tx = pool.begin().await.unwrap();
    assert!(
        entity_access_db_utils::direct_share::facts(
            &mut tx,
            &session.id.as_uuid(),
            model_entity::EntityType::AgentSession
        )
        .await
        .unwrap()
        .is_none()
    );
    tx.rollback().await.unwrap();
    // Root deletion clears the FK but must retain the immutable audience.
    sqlx::query!("DELETE FROM comms_messages WHERE id = $1", private_root)
        .execute(&pool)
        .await
        .unwrap();
    let orphan = repo.get(session.id).await.unwrap();
    assert!(orphan.thread_id.is_none());
    assert_eq!(orphan.thread_visibility, session.thread_visibility);
    assert!(repo.is_private_conversation(session.id).await.unwrap());
    let mut tx = pool.begin().await.unwrap();
    assert!(
        entity_access_db_utils::direct_share::set(
            &mut tx,
            &session.id.as_uuid(),
            model_entity::EntityType::AgentSession,
            &macro_user_id::user_id::MacroUserIdStr::try_from_email("other@example.com").unwrap(),
            Some(AccessLevel::Edit),
            false
        )
        .await
        .is_err()
    );
}
