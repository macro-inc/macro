use super::*;
use crate::domain::ports::AgentSessionRepo;
use crate::outbound::postgres::test::{
    OWNER, create_session, create_test_bot, insert_originating_thread_fixture, new_session,
    test_repo,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{PgPool, Row};

async fn migrate_for_test(pool: &PgPool) {
    // Keep both colliding migration bodies in the isolated test database,
    // remapping only the mailbox migration's in-memory version.
    let migrations = MACRO_DB_MIGRATIONS
        .iter()
        .map(|migration| {
            let mut migration = migration.clone();
            if migration.version == 20261110150956 && migration.description == "rox mailbox handles"
            {
                migration.version = 20261110150959;
            }
            migration
        })
        .collect::<Vec<_>>();
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(migrations),
        ..sqlx::migrate::Migrator::DEFAULT
    }
    .run(pool)
    .await
    .unwrap();
}

fn request() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: None,
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()
}

#[sqlx::test(migrations = false)]
async fn share_link_enable_writes_one_audit_and_repeated_enable_does_not_duplicate(pool: PgPool) {
    migrate_for_test(&pool).await;
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    let enable_link = || UpdateSharePermissionRequestV2 {
        link_share: Some(Some(LinkShare::Public)),
        link_share_access_level: Some(Some(AccessLevel::Edit)),
        ..request()
    };

    repo.update_permissions(session.id, actor(), enable_link(), None)
        .await
        .unwrap();
    repo.update_permissions(session.id, actor(), enable_link(), None)
        .await
        .unwrap();

    let audits = sqlx::query(
        "SELECT actor_id, action, resource_id, result FROM enterprise_audit WHERE resource_id = $1 AND action = 'share_link_create'",
    )
    .bind(session.id.to_string())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].get::<String, _>("actor_id"), OWNER);
    assert_eq!(audits[0].get::<String, _>("action"), "share_link_create");
    assert_eq!(
        audits[0].get::<String, _>("resource_id"),
        session.id.to_string()
    );
    assert_eq!(audits[0].get::<String, _>("result"), "success");
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
            actor(),
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
            actor(),
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
            actor(),
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
                    actor(),
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
            actor(),
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
