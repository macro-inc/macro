use std::collections::{BTreeMap, BTreeSet};

use super::*;
use crate::outbound::pg_access_repo::queries::get_entity_users;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|owner@corp.test";
const TEAM_MEMBER: &str = "macro|member@corp.test";
const PARTICIPANT: &str = "macro|participant@corp.test";
const DEPARTED: &str = "macro|departed@corp.test";
const GUEST: &str = "macro|guest@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_uuid = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_uuid,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn grant(pool: &PgPool, entity_id: Uuid, source_type: &str, source_id: &str) {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $2, $3::text::entity_access_source_type, 'view')
        "#,
        entity_id,
        source_id,
        source_type,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A folder's documents share the folder's grants, one also has its own share, and
/// one has nothing but its owner: each must reach exactly the users a per-entity
/// lookup finds, with documents of equal grants sharing one audience.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grouped_audiences_match_each_entitys_own_users(pool: PgPool) {
    for user_id in [OWNER, TEAM_MEMBER, PARTICIPANT, DEPARTED, GUEST] {
        insert_user(&pool, user_id).await;
    }
    let team_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        TEAM_MEMBER,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Channel', 'public', $2)",
        channel_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES ($1, 'member', $2, NULL), ($1, 'member', $3, now())
        "#,
        channel_id,
        PARTICIPANT,
        DEPARTED,
    )
    .execute(&pool)
    .await
    .unwrap();

    let folder_document = Uuid::now_v7();
    let folder_document_with_bot = Uuid::now_v7();
    let shared_document = Uuid::now_v7();
    let private_document = Uuid::now_v7();
    let ungranted_document = Uuid::now_v7();
    for document in [folder_document, folder_document_with_bot, shared_document] {
        grant(&pool, document, "user", OWNER).await;
        grant(&pool, document, "team", &team_id.to_string()).await;
        grant(&pool, document, "channel", &channel_id.to_string()).await;
    }
    grant(
        &pool,
        folder_document_with_bot,
        "bot",
        &Uuid::now_v7().to_string(),
    )
    .await;
    grant(&pool, shared_document, "user", GUEST).await;
    grant(&pool, private_document, "user", OWNER).await;

    let documents = [
        folder_document,
        folder_document_with_bot,
        shared_document,
        private_document,
        ungranted_document,
    ];
    let audiences = get_entity_audiences(&pool, &documents, EntityType::Document)
        .await
        .unwrap();

    let grouped: BTreeSet<BTreeSet<String>> = audiences
        .iter()
        .map(|audience| audience.entity_ids.iter().cloned().collect())
        .collect();
    assert_eq!(
        grouped,
        BTreeSet::from([
            BTreeSet::from([
                folder_document.to_string(),
                folder_document_with_bot.to_string()
            ]),
            BTreeSet::from([shared_document.to_string()]),
            BTreeSet::from([private_document.to_string()]),
        ])
    );

    let mut users_by_entity = BTreeMap::new();
    for audience in &audiences {
        for entity_id in &audience.entity_ids {
            let users: BTreeSet<String> = audience.users.iter().map(ToString::to_string).collect();
            users_by_entity.insert(entity_id.clone(), users);
        }
    }
    for document in documents {
        let expected: BTreeSet<String> = get_entity_users(&pool, &document, EntityType::Document)
            .await
            .unwrap()
            .iter()
            .map(ToString::to_string)
            .collect();
        let actual = users_by_entity
            .get(&document.to_string())
            .cloned()
            .unwrap_or_default();
        assert_eq!(actual, expected, "users of {document}");
    }
    assert_eq!(
        users_by_entity[&shared_document.to_string()],
        BTreeSet::from([
            OWNER.to_string(),
            TEAM_MEMBER.to_string(),
            PARTICIPANT.to_string(),
            GUEST.to_string()
        ])
    );
}

const FOLDER_GUEST: &str = "macro|folder-guest@corp.test";
const MAILBOX_OWNER: &str = "macro|mailbox@corp.test";

/// For every kind the grouped lookup serves, entities that are owner-only,
/// inherited from a shared folder, team-shared, channel-shared, shared separately
/// on top of the folder, and ungranted must each get exactly the users a
/// per-entity `get_users_by_entity` returns. Every entity also has an email
/// thread row in a mailbox owned by someone without a grant, so a kind that adds
/// users beyond its grants (as email threads do) fails here if it is listed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grouped_audiences_equal_per_entity_users_for_every_grouped_kind(pool: PgPool) {
    use crate::domain::{
        ports::{EntityAccessService, EntityAudienceLookup},
        service::{EntityAccessServiceImpl, GRANT_AUDIENCE_KINDS},
    };
    use crate::outbound::pg_access_repo::PgAccessRepository;

    for user_id in [
        OWNER,
        TEAM_MEMBER,
        PARTICIPANT,
        DEPARTED,
        GUEST,
        FOLDER_GUEST,
        MAILBOX_OWNER,
    ] {
        insert_user(&pool, user_id).await;
    }
    let team_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        TEAM_MEMBER,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Channel', 'public', $2)",
        channel_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES ($1, 'member', $2, NULL), ($1, 'member', $3, now())
        "#,
        channel_id,
        PARTICIPANT,
        DEPARTED,
    )
    .execute(&pool)
    .await
    .unwrap();
    let folder_id = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Folder', $2)"#,
        folder_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mailbox_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, 'mailbox@corp.test', 'GMAIL')"#,
        mailbox_id,
        MAILBOX_OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    for entity_type in GRANT_AUDIENCE_KINDS {
        let owner_only = Uuid::now_v7();
        let first_in_folder = Uuid::now_v7();
        let second_in_folder = Uuid::now_v7();
        let team_shared = Uuid::now_v7();
        let channel_shared = Uuid::now_v7();
        let shared_separately = Uuid::now_v7();
        let ungranted = Uuid::now_v7();
        let entities = [
            owner_only,
            first_in_folder,
            second_in_folder,
            team_shared,
            channel_shared,
            shared_separately,
            ungranted,
        ];
        let grants = [
            (owner_only, "user", OWNER.to_string(), None),
            (first_in_folder, "user", OWNER.to_string(), Some(&folder_id)),
            (
                first_in_folder,
                "user",
                FOLDER_GUEST.to_string(),
                Some(&folder_id),
            ),
            (
                second_in_folder,
                "user",
                OWNER.to_string(),
                Some(&folder_id),
            ),
            (
                second_in_folder,
                "user",
                FOLDER_GUEST.to_string(),
                Some(&folder_id),
            ),
            (team_shared, "user", OWNER.to_string(), None),
            (team_shared, "team", team_id.to_string(), None),
            (channel_shared, "user", OWNER.to_string(), None),
            (channel_shared, "channel", channel_id.to_string(), None),
            (
                shared_separately,
                "user",
                OWNER.to_string(),
                Some(&folder_id),
            ),
            (
                shared_separately,
                "user",
                FOLDER_GUEST.to_string(),
                Some(&folder_id),
            ),
            (shared_separately, "user", GUEST.to_string(), None),
        ];
        for (entity_id, source_type, source_id, granted_from) in grants {
            sqlx::query!(
                r#"
                INSERT INTO entity_access
                    (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
                VALUES ($1, $2, $3, $4::text::entity_access_source_type, 'view', $5)
                "#,
                entity_id,
                entity_type.as_ref(),
                source_id,
                source_type,
                granted_from.map(String::as_str),
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        for entity_id in entities {
            sqlx::query!(
                "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
                entity_id,
                mailbox_id,
            )
            .execute(&pool)
            .await
            .unwrap();
        }

        let entity_ids = entities.map(|entity_id| entity_id.to_string());
        let entity_id_refs = entity_ids.iter().map(String::as_str).collect::<Vec<_>>();
        let audiences = service
            .get_entity_audiences(entity_type, &entity_id_refs)
            .await
            .unwrap();

        let mut grouped_users: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for audience in &audiences {
            for entity_id in &audience.entity_ids {
                let users = audience.users.iter().map(ToString::to_string).collect();
                grouped_users.insert(entity_id.clone(), users);
            }
        }
        for entity_id in &entity_ids {
            let expected: BTreeSet<String> = service
                .get_users_by_entity(entity_id, entity_type)
                .await
                .unwrap()
                .iter()
                .map(ToString::to_string)
                .collect();
            let actual = grouped_users.get(entity_id).cloned().unwrap_or_default();
            assert_eq!(actual, expected, "{entity_type} {entity_id}");
        }
        assert!(
            audiences.iter().any(|audience| {
                audience.entity_ids.contains(&first_in_folder.to_string())
                    && audience.entity_ids.contains(&second_in_folder.to_string())
            }),
            "{entity_type}: entities with the same grants share one audience"
        );
    }
}
