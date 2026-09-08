use std::collections::HashSet;

use super::*;
use crate::domain::models::AccessLevel;
use bot_id::BotId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::Entity;
use models_permissions::share_permission::team_share::{
    TeamShareLevel, TeamShareMaintenance, TeamShareRequest, authorize_team_share,
};
use share_permission_db_utils::team_share;
use sqlx::PgPool;
use uuid::Uuid;

const SHARE_OWNER: &str = "macro|owner@share.test";
const SHARE_VIEWER: &str = "macro|viewer@share.test";
const SHARE_OTHER: &str = "macro|other@share.test";
const SHARE_TEAM: &str = "10000000-0000-0000-0000-000000000001";

fn shared_entities() -> Vec<Entity<'static>> {
    [
        (EntityType::Project, 1),
        (EntityType::Document, 2),
        (EntityType::Chat, 3),
        (EntityType::EmailThread, 4),
        (EntityType::Call, 5),
        (EntityType::Call, 6),
        (EntityType::Document, 7), // Task
        (EntityType::Document, 8), // Snippet
    ]
    .into_iter()
    .map(|(kind, index)| kind.with_entity_string(format!("20000000-0000-0000-0000-{index:012}")))
    .collect()
}

async fn set_canonical_share(pool: &PgPool, entity: &Entity<'_>, level: Option<AccessLevel>) {
    let mut tx = pool.begin().await.unwrap();
    let facts = team_share::load_facts(&mut tx, entity).await.unwrap();
    let owner = MacroUserIdStr::parse_from_str(SHARE_OWNER).unwrap();
    let command = authorize_team_share(
        Some(&owner),
        &facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    team_share::apply(&mut tx, &command).await.unwrap();
    tx.commit().await.unwrap();
}

async fn shared_entity_access(
    pool: &PgPool,
    entity: &Entity<'_>,
    user: Option<&str>,
    sources: Option<&SourceIds>,
) -> Option<AccessLevel> {
    let user = user.map(|id| MacroUserId::parse_from_str(id).unwrap().lowercase());
    let fresh_sources = get_user_source_ids(pool, user.as_ref()).await.unwrap();
    let sources = sources.unwrap_or(&fresh_sources);
    let id = Uuid::parse_str(&entity.entity_id).unwrap();
    match entity.entity_type {
        EntityType::Document => {
            document_access::get_document_access(pool, &id, sources, user.as_ref()).await
        }
        EntityType::Project => project_access::get_project_access(pool, &id, sources).await,
        EntityType::Chat => chat_access::get_chat_access(pool, &id, sources).await,
        EntityType::EmailThread => {
            thread_access::get_thread_access(pool, &id, sources, user.as_ref()).await
        }
        EntityType::Call => call_access::get_call_access(pool, &id, sources).await,
        _ => panic!("unsupported fixture kind"),
    }
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_share"))
)]
async fn canonical_team_share_access_matrix(pool: PgPool) {
    for entity in shared_entities() {
        assert_eq!(
            shared_entity_access(&pool, &entity, Some(SHARE_OWNER), None).await,
            Some(AccessLevel::Owner)
        );
        assert_eq!(
            shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
            None
        );
        for level in [
            AccessLevel::View,
            AccessLevel::Comment,
            AccessLevel::Edit,
            AccessLevel::View,
        ] {
            set_canonical_share(&pool, &entity, Some(level)).await;
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_OWNER), None).await,
                Some(AccessLevel::Owner)
            );
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                Some(level),
                "{entity:?}"
            );
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_OTHER), None).await,
                None
            );
            assert_eq!(shared_entity_access(&pool, &entity, None, None).await, None);
        }
        for _ in 0..2 {
            set_canonical_share(&pool, &entity, None).await;
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                None
            );
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_OWNER), None).await,
                Some(AccessLevel::Owner)
            );
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_share"))
)]
async fn viewer_departure_and_owner_cleanup_with_retained_source_ids(pool: PgPool) {
    let entities = shared_entities();
    for entity in &entities {
        set_canonical_share(&pool, entity, Some(AccessLevel::Edit)).await;
    }
    let viewer = MacroUserId::parse_from_str(SHARE_VIEWER)
        .unwrap()
        .lowercase();
    let retained_sources = get_user_source_ids(&pool, Some(&viewer)).await.unwrap();
    assert!(retained_sources.0.contains(&SHARE_TEAM.to_owned()));
    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", SHARE_VIEWER)
        .execute(&pool)
        .await
        .unwrap();
    for entity in &entities {
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), None).await,
            None
        );
        // Model a stale source list explicitly. cfg(test) disables the production
        // 30-second cache: this assertion does not exercise expiry or invalidation.
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), Some(&retained_sources)).await,
            Some(AccessLevel::Edit)
        );
    }
    let mut tx = pool.begin().await.unwrap();
    team_share::acquire_guard(&mut tx).await.unwrap();
    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", SHARE_OWNER)
        .execute(tx.as_mut())
        .await
        .unwrap();
    for entity in &entities {
        let expected = team_share::load_facts(&mut tx, entity).await.unwrap();
        assert_eq!(expected.owner_team_id, None);
        team_share::maintain(&mut tx, &TeamShareMaintenance::Clear { expected })
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    for entity in &entities {
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), Some(&retained_sources)).await,
            None
        );
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_OWNER), None).await,
            Some(AccessLevel::Owner)
        );
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(
            team_share::load_facts(&mut tx, entity)
                .await
                .unwrap()
                .current,
            None
        );
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_share"))
)]
async fn clearing_preserves_independent_user_channel_and_link_access(pool: PgPool) {
    sqlx::query!("INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ('40000000-0000-0000-0000-000000000001', $1, 'member')", SHARE_VIEWER).execute(&pool).await.unwrap();
    for entity in shared_entities() {
        let id = Uuid::parse_str(&entity.entity_id).unwrap();
        for (source_type, source_id) in [
            ("user", SHARE_VIEWER),
            ("channel", "40000000-0000-0000-0000-000000000001"),
        ] {
            sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, $2, $3, $4::text::entity_access_source_type, 'comment')", id, entity.entity_type.as_ref(), source_id, source_type).execute(&pool).await.unwrap();
            set_canonical_share(&pool, &entity, Some(AccessLevel::Edit)).await;
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                Some(AccessLevel::Edit)
            );
            set_canonical_share(&pool, &entity, None).await;
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                Some(AccessLevel::Comment)
            );
            sqlx::query!(
                "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = $2",
                id,
                source_id
            )
            .execute(&pool)
            .await
            .unwrap();
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                None
            );
        }
        for link in ["PUBLIC", "TEAM"] {
            // All fixture policies are private between iterations, so a single
            // update exercises each entity's own permission association.
            sqlx::query!(
                r#"UPDATE "SharePermission" SET "linkShare" = $1, "linkShareAccessLevel" = 'view'"#,
                link
            )
            .execute(&pool)
            .await
            .unwrap();
            set_canonical_share(&pool, &entity, Some(AccessLevel::Edit)).await;
            set_canonical_share(&pool, &entity, None).await;
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                Some(AccessLevel::View)
            );
            let public_access = if link == "PUBLIC" {
                Some(AccessLevel::View)
            } else {
                None
            };
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_OTHER), None).await,
                public_access
            );
            assert_eq!(
                shared_entity_access(&pool, &entity, None, None).await,
                public_access
            );
            sqlx::query!(
                r#"UPDATE "SharePermission" SET "linkShare" = NULL, "linkShareAccessLevel" = NULL"#
            )
            .execute(&pool)
            .await
            .unwrap();
            assert_eq!(
                shared_entity_access(&pool, &entity, Some(SHARE_VIEWER), None).await,
                None
            );
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("team_share"))
)]
async fn clearing_one_project_preserves_other_project_and_direct_contributions(pool: PgPool) {
    sqlx::query!(r#"UPDATE "Project" SET "parentId" = '20000000-0000-0000-0000-000000000009' WHERE id = '20000000-0000-0000-0000-000000000001'"#).execute(&pool).await.unwrap();
    sqlx::query!(r#"UPDATE "Document" SET "projectId" = '20000000-0000-0000-0000-000000000001'"#)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(r#"UPDATE "Chat" SET "projectId" = '20000000-0000-0000-0000-000000000001'"#)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!("UPDATE email_threads SET project_id = '20000000-0000-0000-0000-000000000001'")
        .execute(&pool)
        .await
        .unwrap();
    let entities: Vec<_> = shared_entities()
        .into_iter()
        .filter(|e| e.entity_type != EntityType::Call)
        .collect();
    let root = &entities[0];
    let ancestor =
        EntityType::Project.with_entity_string("20000000-0000-0000-0000-000000000009".to_owned());
    set_canonical_share(&pool, &ancestor, Some(AccessLevel::Comment)).await;
    set_canonical_share(&pool, root, Some(AccessLevel::Edit)).await;
    set_canonical_share(&pool, &entities[1], Some(AccessLevel::View)).await;
    for entity in &entities {
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), None).await,
            Some(AccessLevel::Edit)
        );
    }
    set_canonical_share(&pool, root, None).await;
    for entity in &entities {
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), None).await,
            Some(AccessLevel::Comment)
        );
    }
    set_canonical_share(&pool, &ancestor, None).await;
    for entity in &entities {
        let expected = if entity == &entities[1] {
            Some(AccessLevel::View)
        } else {
            None
        };
        assert_eq!(
            shared_entity_access(&pool, entity, Some(SHARE_VIEWER), None).await,
            expected
        );
    }
}

const OWNER: &str = "macro|sharedbox@corp.test";
const DELEGATE: &str = "macro|primary@corp.test";
const BOT_OWNER: &str = "macro|bot-owner@corp.test";

/// macro_user + "User" rows so macro_user_links FKs resolve.
async fn insert_user(pool: &PgPool, user_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        user_id,
        email,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_team(pool: &PgPool, team_id: Uuid) {
    insert_user(pool, BOT_OWNER, "bot-owner@corp.test").await;
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Bot Team', $2)"#,
        team_id,
        BOT_OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_owned_bot(
    pool: &PgPool,
    bot_id: BotId,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
) {
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle)
        VALUES ($1, 'owned', $2, $3, 'Test Bot', 'test-bot')
        "#,
        bot_id.as_uuid(),
        owner_user_id,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_channel(pool: &PgPool, channel_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'Bot Channel', 'public', $2)
        "#,
        channel_id,
        BOT_OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_team_channel(pool: &PgPool, channel_id: Uuid, team_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id)
        VALUES ($1, 'Bot Team Channel', 'team', $2, $3)
        "#,
        channel_id,
        BOT_OWNER,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_bot_participant(pool: &PgPool, channel_id: Uuid, bot_id: BotId, departed: bool) {
    let principal = bot_id.into_storage_id();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES (
            $1,
            'member',
            $2,
            CASE WHEN $3 THEN now() ELSE NULL END
        )
        "#,
        channel_id,
        principal.as_ref(),
        departed,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn source_id_set(source_ids: SourceIds) -> HashSet<String> {
    source_ids.0.into_iter().collect()
}

/// An empty link + thread owned by `owner_macro_id`. Returns `(link_id, thread_id)`.
async fn insert_thread(pool: &PgPool, owner_macro_id: &str, email: &str) -> (Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        owner_macro_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    (link_id, thread_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_scope_source_ids_include_only_owning_team_and_active_bot_sources(
    pool: PgPool,
) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let team_id = Uuid::new_v4();
    let other_team_id = Uuid::new_v4();
    let team_channel_id = Uuid::new_v4();
    let other_team_channel_id = Uuid::new_v4();
    let private_channel_id = Uuid::new_v4();
    let departed_channel_id = Uuid::new_v4();

    insert_team(&pool, team_id).await;
    let other_owner_id = format!("macro|{other_team_id}@corp.test");
    let other_owner_email = format!("{other_team_id}@corp.test");
    insert_user(&pool, &other_owner_id, &other_owner_email).await;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Other Bot Team', $2)",
        other_team_id,
        other_owner_id,
    )
    .execute(&pool)
    .await?;
    insert_owned_bot(&pool, bot_id, None, Some(team_id)).await;
    insert_team_channel(&pool, team_channel_id, team_id).await;
    insert_team_channel(&pool, other_team_channel_id, other_team_id).await;
    insert_channel(&pool, private_channel_id).await;
    insert_channel(&pool, departed_channel_id).await;
    insert_bot_participant(&pool, team_channel_id, bot_id, false).await;
    insert_bot_participant(&pool, private_channel_id, bot_id, false).await;
    insert_bot_participant(&pool, departed_channel_id, bot_id, true).await;

    let source_ids = get_team_scope_source_ids(&pool, &bot_principal, &team_id).await?;
    let source_count = source_ids.0.len();
    let actual = source_id_set(source_ids);
    let expected = HashSet::from([
        team_id.to_string(),
        team_channel_id.to_string(),
        private_channel_id.to_string(),
        bot_principal.to_string(),
    ]);

    assert_eq!(actual, expected);
    assert_eq!(
        source_count,
        actual.len(),
        "source ids must be deduplicated"
    );
    assert!(!actual.contains(&other_team_channel_id.to_string()));
    assert!(!actual.contains(&departed_channel_id.to_string()));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_scope_source_ids_reject_mismatched_team(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let owning_team_id = Uuid::new_v4();
    let supplied_team_id = Uuid::new_v4();

    insert_team(&pool, owning_team_id).await;
    insert_owned_bot(&pool, bot_id, None, Some(owning_team_id)).await;

    let source_ids = get_team_scope_source_ids(&pool, &bot_principal, &supplied_team_id).await?;

    assert!(source_ids.0.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_scope_source_ids_reject_soft_deleted_bot(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let team_id = Uuid::new_v4();
    let team_channel_id = Uuid::new_v4();

    insert_team(&pool, team_id).await;
    insert_owned_bot(&pool, bot_id, None, Some(team_id)).await;
    insert_team_channel(&pool, team_channel_id, team_id).await;
    insert_bot_participant(&pool, team_channel_id, bot_id, false).await;
    sqlx::query!(
        "UPDATE bots SET deleted_at = now() WHERE id = $1",
        bot_id.as_uuid(),
    )
    .execute(&pool)
    .await?;

    let source_ids = get_team_scope_source_ids(&pool, &bot_principal, &team_id).await?;

    assert!(source_ids.0.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_users_includes_inbox_delegate(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "sharedbox@corp.test").await;
    insert_user(&pool, DELEGATE, "primary@corp.test").await;
    let (link_id, thread_id) = insert_thread(&pool, OWNER, "sharedbox@corp.test").await;

    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        DELEGATE,
        OWNER,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let users = get_entity_users(&pool, &thread_id, EntityType::EmailThread).await?;
    let ids: std::collections::HashSet<String> = users.iter().map(|u| u.to_string()).collect();

    assert!(ids.contains(OWNER), "inbox owner must be included");
    assert!(ids.contains(DELEGATE), "inbox delegate must be included");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_users_excludes_delegate_scoped_to_other_link(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "sharedbox@corp.test").await;
    insert_user(&pool, DELEGATE, "primary@corp.test").await;
    let (granted_link_id, _) = insert_thread(&pool, OWNER, "sharedbox@corp.test").await;
    let (_, other_thread_id) = insert_thread(&pool, OWNER, "other@corp.test").await;

    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        DELEGATE,
        OWNER,
        granted_link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let users = get_entity_users(&pool, &other_thread_id, EntityType::EmailThread).await?;
    let ids: std::collections::HashSet<String> = users.iter().map(|u| u.to_string()).collect();

    assert!(ids.contains(OWNER), "inbox owner must be included");
    assert!(
        !ids.contains(DELEGATE),
        "delegate scoped to a different link must be excluded"
    );
    Ok(())
}
