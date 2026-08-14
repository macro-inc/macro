use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER_WITH_TEAM: &str = "macro|chat-owner@corp.test";
const OWNER_WITHOUT_TEAM: &str = "macro|chat-owner-no-team@corp.test";
const REQUESTER: &str = "macro|chat-requester@corp.test";
const OWNER_TEAM: Uuid = Uuid::from_u128(0x000000000000000000000000000c4a01);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x000000000000000000000000000c4a02);

#[derive(Clone, Copy)]
struct LinkAccessCase {
    link_share: Option<&'static str>,
    link_access_level: Option<&'static str>,
    anonymous: Option<AccessLevel>,
    other_team: Option<AccessLevel>,
    same_team: Option<AccessLevel>,
}

// Complete link-only access matrix. Explicit grants are tested separately.
const LINK_ACCESS_CASES: [LinkAccessCase; 3] = [
    LinkAccessCase {
        link_share: None,
        link_access_level: None,
        anonymous: None,
        other_team: None,
        same_team: None,
    },
    LinkAccessCase {
        link_share: Some("PUBLIC"),
        link_access_level: Some("view"),
        anonymous: Some(AccessLevel::View),
        other_team: Some(AccessLevel::View),
        same_team: Some(AccessLevel::View),
    },
    LinkAccessCase {
        link_share: Some("TEAM"),
        link_access_level: Some("view"),
        anonymous: None,
        other_team: None,
        same_team: Some(AccessLevel::View),
    },
];

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $2)
        "#,
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn add_owner_to_team(pool: &PgPool, owner_id: &str, team_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Chat Owner Team', $2)"#,
        team_id,
        owner_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role)
           VALUES ($1, $2, 'owner')"#,
        owner_id,
        team_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_chat(
    pool: &PgPool,
    owner_id: &str,
    link_share: Option<&str>,
    link_access_level: Option<&str>,
) -> anyhow::Result<Uuid> {
    let chat_id = Uuid::new_v4();
    let chat_id_string = chat_id.to_string();
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
        VALUES ($1, $2, $3::text::"AccessLevel")
        "#,
        share_permission_id,
        link_share,
        link_access_level,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, $2, 'Test Chat')"#,
        chat_id_string,
        owner_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "ChatPermission" ("chatId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        chat_id_string,
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(chat_id)
}

async fn insert_explicit_access(
    pool: &PgPool,
    chat_id: Uuid,
    source_id: &str,
    access_level: AccessLevel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES ($1, 'chat', $2, 'user', $3)
        "#,
        chat_id,
        source_id,
        access_level as AccessLevel,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enforces_complete_link_access_matrix(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, OWNER_TEAM).await?;

    let anonymous = SourceIds(vec![]);
    let other_team = SourceIds(vec![REQUESTER.to_string(), OTHER_TEAM.to_string()]);
    let same_team = SourceIds(vec![REQUESTER.to_string(), OWNER_TEAM.to_string()]);

    for case in LINK_ACCESS_CASES {
        let chat_id = insert_chat(
            &pool,
            OWNER_WITH_TEAM,
            case.link_share,
            case.link_access_level,
        )
        .await?;

        assert_eq!(
            get_chat_access(&pool, &chat_id, &anonymous).await?,
            case.anonymous,
            "anonymous access for {:?}",
            case.link_share,
        );
        assert_eq!(
            get_chat_access(&pool, &chat_id, &other_team).await?,
            case.other_team,
            "other-team access for {:?}",
            case.link_share,
        );
        assert_eq!(
            get_chat_access(&pool, &chat_id, &same_team).await?,
            case.same_team,
            "same-team access for {:?}",
            case.link_share,
        );
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_access_when_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let chat_id = insert_chat(&pool, OWNER_WITHOUT_TEAM, Some("TEAM"), Some("view")).await?;
    let requester = SourceIds(vec![REQUESTER.to_string(), OWNER_TEAM.to_string()]);

    let access = get_chat_access(&pool, &chat_id, &requester).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn takes_maximum_of_link_and_explicit_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, OWNER_TEAM).await?;
    let requester = SourceIds(vec![REQUESTER.to_string(), OWNER_TEAM.to_string()]);

    let explicit_wins_chat =
        insert_chat(&pool, OWNER_WITH_TEAM, Some("PUBLIC"), Some("view")).await?;
    insert_explicit_access(&pool, explicit_wins_chat, REQUESTER, AccessLevel::Edit).await?;

    let link_wins_chat = insert_chat(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("edit")).await?;
    insert_explicit_access(&pool, link_wins_chat, REQUESTER, AccessLevel::View).await?;

    assert_eq!(
        get_chat_access(&pool, &explicit_wins_chat, &requester).await?,
        Some(AccessLevel::Edit),
    );
    assert_eq!(
        get_chat_access(&pool, &link_wins_chat, &requester).await?,
        Some(AccessLevel::Edit),
    );
    Ok(())
}
