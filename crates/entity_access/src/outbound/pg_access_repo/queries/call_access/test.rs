use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER_WITH_TEAM: &str = "macro|call-owner@corp.test";
const OWNER_WITHOUT_TEAM: &str = "macro|call-owner-no-team@corp.test";
const REQUESTER: &str = "macro|call-requester@corp.test";
const DIRECT_SOURCE_ID: &str = "macro|direct-grantee@corp.test";
const CHANNEL_SOURCE_ID: &str = "00000000-0000-0000-0000-00000000ca11";
const TEAM_SOURCE_ID: &str = "00000000-0000-0000-0000-000000007ea1";
const OWNER_TEAM: Uuid = Uuid::from_u128(0x000000000000000000000000000ca101);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x000000000000000000000000000ca102);

#[derive(Clone, Copy, Debug)]
enum CallTable {
    Calls,
    CallRecords,
}

impl CallTable {
    const ALL: [Self; 2] = [Self::Calls, Self::CallRecords];
}

#[derive(Clone, Copy)]
struct LinkAccessCase {
    link_share: Option<&'static str>,
    link_access_level: Option<&'static str>,
    anonymous: Option<AccessLevel>,
    other_team: Option<AccessLevel>,
    same_team: Option<AccessLevel>,
}

const LINK_ACCESS_CASES: [LinkAccessCase; 4] = [
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
        link_share: Some("PUBLIC"),
        link_access_level: None,
        anonymous: None,
        other_team: None,
        same_team: None,
    },
    LinkAccessCase {
        link_share: Some("TEAM"),
        link_access_level: Some("comment"),
        anonymous: None,
        other_team: None,
        same_team: Some(AccessLevel::Comment),
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
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Call Owner Team', $2)"#,
        team_id,
        owner_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'owner')
        "#,
        owner_id,
        team_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_channel(pool: &PgPool, channel_id: Uuid, owner_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
        VALUES ($1, 'Call Access Test', 'public', NULL, $2)
        "#,
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_share_permission(
    pool: &PgPool,
    link_share: Option<&str>,
    link_access_level: Option<&str>,
) -> anyhow::Result<String> {
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            id,
            "linkShare",
            "linkShareAccessLevel"
        )
        VALUES ($1, $2, $3::text::"AccessLevel")
        "#,
        share_permission_id,
        link_share,
        link_access_level,
    )
    .execute(pool)
    .await?;

    Ok(share_permission_id)
}

async fn insert_link_shared_call(
    pool: &PgPool,
    call_table: CallTable,
    owner_id: &str,
    link_share: Option<&str>,
    link_access_level: Option<&str>,
) -> anyhow::Result<Uuid> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let share_permission_id = insert_share_permission(pool, link_share, link_access_level).await?;
    insert_channel(pool, channel_id, owner_id).await?;

    match call_table {
        CallTable::Calls => {
            sqlx::query!(
                r#"
                INSERT INTO calls (
                    id,
                    channel_id,
                    room_name,
                    created_by,
                    share_permission_id
                )
                VALUES ($1, $2, 'call-access-test', $3, $4)
                "#,
                call_id,
                channel_id,
                owner_id,
                share_permission_id,
            )
            .execute(pool)
            .await?;
        }
        CallTable::CallRecords => {
            sqlx::query!(
                r#"
                INSERT INTO call_records (
                    id,
                    channel_id,
                    room_name,
                    created_by,
                    started_at,
                    ended_at,
                    duration_ms,
                    share_permission_id
                )
                VALUES (
                    $1,
                    $2,
                    'call-access-test',
                    $3,
                    NOW() - INTERVAL '1 hour',
                    NOW(),
                    3600000,
                    $4
                )
                "#,
                call_id,
                channel_id,
                owner_id,
                share_permission_id,
            )
            .execute(pool)
            .await?;
        }
    }

    Ok(call_id)
}

async fn insert_entity_access(
    pool: &PgPool,
    call_id: Uuid,
    source_id: &str,
    source_type: &str,
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
        VALUES (
            $1,
            'call',
            $2,
            $3::text::entity_access_source_type,
            $4::text::"AccessLevel"
        )
        "#,
        call_id,
        source_id,
        source_type,
        access_level.to_string(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_call_does_not_exist(pool: PgPool) -> anyhow::Result<()> {
    let access = get_call_access(
        &pool,
        &Uuid::new_v4(),
        &SourceIds(vec![REQUESTER.to_string()]),
    )
    .await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enforces_link_access_for_calls_and_call_records(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, OWNER_TEAM).await?;

    let anonymous = SourceIds(vec![]);
    let other_team = SourceIds(vec![REQUESTER.to_string(), OTHER_TEAM.to_string()]);
    let same_team = SourceIds(vec![REQUESTER.to_string(), OWNER_TEAM.to_string()]);

    for call_table in CallTable::ALL {
        for case in LINK_ACCESS_CASES {
            let call_id = insert_link_shared_call(
                &pool,
                call_table,
                OWNER_WITH_TEAM,
                case.link_share,
                case.link_access_level,
            )
            .await?;

            assert_eq!(
                get_call_access(&pool, &call_id, &anonymous).await?,
                case.anonymous,
                "anonymous access for {call_table:?} with {:?}",
                case.link_share,
            );
            assert_eq!(
                get_call_access(&pool, &call_id, &other_team).await?,
                case.other_team,
                "other-team access for {call_table:?} with {:?}",
                case.link_share,
            );
            assert_eq!(
                get_call_access(&pool, &call_id, &same_team).await?,
                case.same_team,
                "same-team access for {call_table:?} with {:?}",
                case.link_share,
            );
        }
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_when_call_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let requester = SourceIds(vec![REQUESTER.to_string(), OWNER_TEAM.to_string()]);

    for call_table in CallTable::ALL {
        let call_id = insert_link_shared_call(
            &pool,
            call_table,
            OWNER_WITHOUT_TEAM,
            Some("TEAM"),
            Some("edit"),
        )
        .await?;

        assert_eq!(
            get_call_access(&pool, &call_id, &requester).await?,
            None,
            "TEAM access for {call_table:?}",
        );
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preserves_user_channel_and_team_entity_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let grants = [
        (DIRECT_SOURCE_ID, "user", AccessLevel::View),
        (CHANNEL_SOURCE_ID, "channel", AccessLevel::Comment),
        (TEAM_SOURCE_ID, "team", AccessLevel::Edit),
    ];

    for call_table in CallTable::ALL {
        let call_id =
            insert_link_shared_call(&pool, call_table, OWNER_WITHOUT_TEAM, None, None).await?;

        for (source_id, source_type, access_level) in grants {
            insert_entity_access(&pool, call_id, source_id, source_type, access_level).await?;
        }

        for (source_id, _, access_level) in grants {
            let source_ids = SourceIds(vec![source_id.to_string()]);
            assert_eq!(
                get_call_access(&pool, &call_id, &source_ids).await?,
                Some(access_level),
                "{source_id} grant for {call_table:?}",
            );
        }

        let all_sources = SourceIds(
            grants
                .iter()
                .map(|(source_id, _, _)| source_id.to_string())
                .collect(),
        );
        assert_eq!(
            get_call_access(&pool, &call_id, &all_sources).await?,
            Some(AccessLevel::Edit),
            "highest explicit grant for {call_table:?}",
        );
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_highest_link_or_explicit_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let requester = SourceIds(vec![DIRECT_SOURCE_ID.to_string()]);

    for call_table in CallTable::ALL {
        let explicit_wins = insert_link_shared_call(
            &pool,
            call_table,
            OWNER_WITHOUT_TEAM,
            Some("PUBLIC"),
            Some("view"),
        )
        .await?;
        insert_entity_access(
            &pool,
            explicit_wins,
            DIRECT_SOURCE_ID,
            "user",
            AccessLevel::Edit,
        )
        .await?;

        let link_wins = insert_link_shared_call(
            &pool,
            call_table,
            OWNER_WITHOUT_TEAM,
            Some("PUBLIC"),
            Some("edit"),
        )
        .await?;
        insert_entity_access(
            &pool,
            link_wins,
            DIRECT_SOURCE_ID,
            "user",
            AccessLevel::View,
        )
        .await?;

        assert_eq!(
            get_call_access(&pool, &explicit_wins, &requester).await?,
            Some(AccessLevel::Edit),
            "explicit access for {call_table:?}",
        );
        assert_eq!(
            get_call_access(&pool, &link_wins, &requester).await?,
            Some(AccessLevel::Edit),
            "link access for {call_table:?}",
        );
    }

    Ok(())
}
