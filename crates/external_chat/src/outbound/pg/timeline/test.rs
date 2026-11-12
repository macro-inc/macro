use super::*;
use crate::domain::timeline::TimelineRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::Row;

const OWNER: &str = "macro|external-chat-owner@example.com";

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

#[sqlx::test(migrations = false)]
async fn share_link_enable_writes_one_audit_and_repeated_enable_does_not_duplicate(pool: PgPool) {
    migrate_for_test(&pool).await;
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)"#,
        macro_user_id,
        OWNER,
        "external-chat-owner@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        OWNER,
        "external-chat-owner@example.com",
        macro_user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let permission_id = "external-chat-share-permission";
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "createdAt", "updatedAt") VALUES ($1, NOW(), NOW())"#,
        permission_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let chat_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO external_chat (
            id, provider, remote_id, kind, name, user_id, state, share_permission_id
        ) VALUES ($1, 'whatsapp', '12345@g.us', 'group', 'Private chat', $2, 'active', $3)"#,
        chat_id,
        OWNER,
        permission_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgExternalChatRepository::new(pool.clone());
    let actor = MacroUserIdStr::try_from(OWNER.to_owned()).unwrap();
    let update = UpdateSharePermissionRequestV2 {
        link_share: Some(Some(LinkShare::Public)),
        link_share_access_level: Some(Some(AccessLevel::View)),
        team_share_access_level: None,
        channel_share_permissions: None,
    };

    repo.update_permissions(chat_id, &actor, &update, None)
        .await
        .unwrap();
    repo.update_permissions(chat_id, &actor, &update, None)
        .await
        .unwrap();

    let audits = sqlx::query(
        "SELECT actor_id, action, resource_id, result FROM enterprise_audit WHERE resource_id = $1",
    )
    .bind(chat_id.to_string())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].get::<String, _>("actor_id"), OWNER);
    assert_eq!(audits[0].get::<String, _>("action"), "share_link_create");
    assert_eq!(
        audits[0].get::<String, _>("resource_id"),
        chat_id.to_string()
    );
    assert_eq!(audits[0].get::<String, _>("result"), "success");
}
