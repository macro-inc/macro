use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, ensure_user, matrix_viewers, user_in_channel},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(feature = "explain_binary")]
const OWNER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";
/// A member of the session owner's team.
const SAME_TEAM: &str = "macro|session-teammate@example.com";
/// A member of the other team.
const OTHER_TEAM: &str = "macro|session-other-team@example.com";
/// In no team; a member of the channel granted edit on `PUBLIC_SESSION`.
const CHANNEL_MEMBER: &str = "macro|session-channel-member@example.com";
const PUBLIC_SESSION: uuid::Uuid = uuid::Uuid::from_u128(0x60000000_0000_0000_0000_000000000003);
const TEAM_SESSION: uuid::Uuid = uuid::Uuid::from_u128(0x60000000_0000_0000_0000_000000000005);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("user_team", "agent_session_sharing")
    )
)]
async fn session_links_require_public_consent_or_owner_team_membership(pool: PgPool) {
    for (session_id, anonymous, same_team, other_team) in [
        (0x60000000_0000_0000_0000_000000000001, None, None, None),
        (0x60000000_0000_0000_0000_000000000002, None, None, None),
        (
            PUBLIC_SESSION.as_u128(),
            Some(AccessLevel::View),
            Some(AccessLevel::View),
            Some(AccessLevel::View),
        ),
        (0x60000000_0000_0000_0000_000000000004, None, None, None),
        (
            TEAM_SESSION.as_u128(),
            None,
            Some(AccessLevel::Comment),
            None,
        ),
    ] {
        for (viewer, expected) in [
            (Viewer::Anonymous, anonymous),
            (Viewer::User(SAME_TEAM), same_team),
            (Viewer::User(OTHER_TEAM), other_team),
        ] {
            assert_eq!(
                get_agent_session_access(&pool, &uuid::Uuid::from_u128(session_id), viewer)
                    .await
                    .unwrap(),
                expected,
                "session {session_id}",
            );
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("user_team", "agent_session_sharing")
    )
)]
async fn session_links_preserve_stronger_grants_and_revoke_immediately(pool: PgPool) {
    let owner = sqlx::query_scalar!(
        "SELECT owner_id FROM agent_session WHERE id = $1",
        PUBLIC_SESSION
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    for (viewer, expected) in [
        (owner.as_str(), AccessLevel::Owner),
        (CHANNEL_MEMBER, AccessLevel::Edit),
    ] {
        assert_eq!(
            get_agent_session_access(&pool, &PUBLIC_SESSION, Viewer::User(viewer))
                .await
                .unwrap(),
            Some(expected),
        );
    }

    sqlx::query!(
        r#"UPDATE "SharePermission" SET "linkShare" = NULL, "linkShareAccessLevel" = NULL
        WHERE id = 'session-public'"#
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_agent_session_access(&pool, &PUBLIC_SESSION, Viewer::Anonymous)
            .await
            .unwrap(),
        None,
    );

    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@team.com'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get_agent_session_access(&pool, &TEAM_SESSION, Viewer::User(SAME_TEAM))
            .await
            .unwrap(),
        None,
    );
}

#[cfg(feature = "explain_binary")]
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("user_team", "agent_session_sharing")
    )
)]
async fn explanation_includes_public_and_team_links(pool: PgPool) {
    let grants = explain_agent_session_access(&pool, &PUBLIC_SESSION, &SourceIds(vec![]))
        .await
        .unwrap();
    assert!(matches!(
        grants.as_slice(),
        [AccessGrant::PublicLink {
            access_level: AccessLevel::View
        }]
    ));
    let grants = explain_agent_session_access(
        &pool,
        &TEAM_SESSION,
        &SourceIds(vec![OWNER_TEAM.to_string()]),
    )
    .await
    .unwrap();
    assert!(
        matches!(grants.as_slice(), [AccessGrant::TeamLink { access_level: AccessLevel::Comment, owner_team_id }] if *owner_team_id == uuid::Uuid::parse_str(OWNER_TEAM).unwrap())
    );
}

fn user(user_id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(user_id).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn session_allowlist_matches_grants_and_respects_requested_ids(pool: PgPool) {
    const OWNER: &str = "macro|session-owner@example.com";
    const MEMBER: &str = "macro|session-channel-member@example.com";
    const OUTSIDER: &str = "macro|session-outsider@example.com";
    let session = uuid::Uuid::now_v7();
    let unrelated = uuid::Uuid::now_v7();
    let channel = uuid::Uuid::now_v7();
    user_in_channel(&pool, OWNER, channel).await.unwrap();
    user_in_channel(&pool, MEMBER, channel).await.unwrap();
    ensure_user(&pool, OUTSIDER).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', $3, 'user', 'owner'),
               ($1, 'agent_session', $4, 'channel', 'view'),
               ($2, 'chat', $4, 'channel', 'view')
        "#,
        session,
        unrelated,
        OWNER,
        channel.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    // The owner holds a user grant and the channel; the member only the channel.
    for viewer in [OWNER, MEMBER] {
        assert_eq!(
            accessible_session_ids(&pool, &user(viewer), &[])
                .await
                .unwrap(),
            vec![session]
        );
    }
    assert!(
        accessible_session_ids(&pool, &user(OUTSIDER), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        accessible_session_ids(&pool, &user(MEMBER), &[unrelated])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        accessible_session_ids(&pool, &user(MEMBER), &[session])
            .await
            .unwrap(),
        vec![session]
    );
    // Revocation must be reflected by the next allowlist query.
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = $2",
        session,
        channel.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        accessible_session_ids(&pool, &user(MEMBER), &[])
            .await
            .unwrap()
            .is_empty()
    );
}

/// Search's allowlist drops an inline session unless the caller names its id.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn hidden_sessions_leave_the_allowlist_unless_named(pool: PgPool) {
    let session = uuid::Uuid::now_v7();
    let viewer = "macro|agent-session-list-viewer@example.com";
    let macro_user_id = uuid::Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        viewer,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" ("id", "email", "macro_user_id") VALUES ($1, $1, $2)"#,
        viewer,
        macro_user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (
            id, owner_id, bot_id, model, harness, repo_url, workspace, visibility
        )
        VALUES ($1, $2, '00000000-0000-0000-0000-00000000a9e7', 'model', 'harness', NULL, '/workspace', 'hidden')
        "#,
        session,
        viewer,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', $2, 'user', 'owner')
        "#,
        session,
        viewer,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(
        accessible_session_ids(&pool, &user(viewer), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        accessible_session_ids(&pool, &user(viewer), &[session])
            .await
            .unwrap(),
        vec![session]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_session")
    )
)]
async fn session_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let sessions = sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM agent_session
           UNION
           SELECT entity_id FROM entity_access WHERE entity_type = 'agent_session'
           ORDER BY 1"#
    )
    .fetch_all(&pool)
    .await?;

    assert_matrix_agrees(&viewers, &sessions, async |viewer, session_id| {
        Ok((
            source_list_oracle::get_agent_session_access(&pool, session_id, &viewer.sources)
                .await?,
            get_agent_session_access(&pool, session_id, viewer.viewer()).await?,
        ))
    })
    .await?;

    // Search lists sessions for signed-in users only.
    let users: Vec<_> = viewers
        .into_iter()
        .filter(|viewer| viewer.user_id().is_some())
        .collect();
    let every_id = "every id requested";
    assert_matrix_agrees(
        &users,
        &["no ids requested", every_id],
        async |viewer, request| {
            let requested: &[Uuid] = if *request == every_id { &sessions } else { &[] };
            let user_id = viewer
                .user_id()
                .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
            let mut old =
                source_list_oracle::accessible_session_ids(&pool, &viewer.sources, requested)
                    .await?;
            let mut new = accessible_session_ids(&pool, &user_id, requested).await?;
            old.sort();
            new.sort();
            Ok((old, new))
        },
    )
    .await
}
