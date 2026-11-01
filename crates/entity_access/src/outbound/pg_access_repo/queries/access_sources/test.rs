use std::collections::HashSet;

use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|owner@corp.test";
const CHANNEL_MEMBER: &str = "macro|channel-member@corp.test";
const DEPARTED: &str = "macro|departed@corp.test";
const TEAM_MEMBER: &str = "macro|team-member@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_uuid = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");
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

async fn grant(pool: &PgPool, document: Uuid, source_type: &str, source_id: &str) {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $2, $3::text::entity_access_source_type, 'view')
        "#,
        document,
        source_id,
        source_type,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn user(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(user_id)
        .unwrap()
        .into_owned()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recorded_grants_still_reach_current_members_after_they_are_deleted(pool: PgPool) {
    for user_id in [OWNER, CHANNEL_MEMBER, DEPARTED, TEAM_MEMBER] {
        insert_user(&pool, user_id).await;
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        TEAM_MEMBER
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Channel', 'public', $2)",
        channel,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    for (member, departed) in [(CHANNEL_MEMBER, false), (DEPARTED, true)] {
        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
            VALUES ($1, 'member', $2, CASE WHEN $3 THEN now() ELSE NULL END)
            "#,
            channel,
            member,
            departed,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let document = Uuid::now_v7();
    grant(&pool, document, "user", OWNER).await;
    grant(&pool, document, "channel", &channel.to_string()).await;
    grant(&pool, document, "team", &team.to_string()).await;
    grant(
        &pool,
        document,
        "bot",
        "bot|00000000-0000-0000-0000-000000000001",
    )
    .await;

    let sources = get_entity_access_sources(&pool, &document, EntityType::Document)
        .await
        .unwrap();
    assert_eq!(
        sources.iter().cloned().collect::<HashSet<_>>(),
        HashSet::from([
            EntityAccessSource {
                source_type: EntityAccessSourceType::User,
                source_id: OWNER.to_owned(),
            },
            EntityAccessSource {
                source_type: EntityAccessSourceType::Channel,
                source_id: channel.to_string(),
            },
            EntityAccessSource {
                source_type: EntityAccessSourceType::Team,
                source_id: team.to_string(),
            },
        ])
    );

    sqlx::query!("DELETE FROM entity_access WHERE entity_id = $1", document)
        .execute(&pool)
        .await
        .unwrap();
    let reached = get_users_for_sources(&pool, &sources).await.unwrap();
    assert_eq!(reached.len(), 3);
    assert_eq!(
        reached.into_iter().collect::<HashSet<_>>(),
        HashSet::from([user(OWNER), user(CHANNEL_MEMBER), user(TEAM_MEMBER)])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_sources_reach_no_one(pool: PgPool) {
    assert!(get_users_for_sources(&pool, &[]).await.unwrap().is_empty());
}
