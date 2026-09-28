use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";
const OTHER_TEAM: &str = "00000000-0000-0000-0000-0000000ea002";
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
        for (sources, expected) in [
            (vec![], anonymous),
            (vec![OWNER_TEAM.to_string()], same_team),
            (vec![OTHER_TEAM.to_string()], other_team),
        ] {
            assert_eq!(
                get_agent_session_access(
                    &pool,
                    &uuid::Uuid::from_u128(session_id),
                    &SourceIds(sources)
                )
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
    for (sources, expected) in [
        (vec!["macro|owner@team.com".to_string()], AccessLevel::Owner),
        (vec!["channel".to_string()], AccessLevel::Edit),
    ] {
        assert_eq!(
            get_agent_session_access(&pool, &PUBLIC_SESSION, &SourceIds(sources))
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
        get_agent_session_access(&pool, &PUBLIC_SESSION, &SourceIds(vec![]))
            .await
            .unwrap(),
        None,
    );

    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@team.com'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get_agent_session_access(
            &pool,
            &TEAM_SESSION,
            &SourceIds(vec![OWNER_TEAM.to_string()])
        )
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn session_allowlist_matches_grants_and_respects_requested_ids(pool: PgPool) {
    let session = uuid::Uuid::now_v7();
    let unrelated = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', 'owner', 'user', 'owner'),
               ($1, 'agent_session', 'channel', 'channel', 'view'),
               ($2, 'chat', 'channel', 'channel', 'view')
        "#,
        session,
        unrelated,
    )
    .execute(&pool)
    .await
    .unwrap();
    for sources in [
        vec!["owner".into()],
        vec!["channel".into()],
        vec!["owner".into(), "channel".into()],
    ] {
        assert_eq!(
            accessible_session_ids(&pool, &SourceIds(sources), &[])
                .await
                .unwrap(),
            vec![session]
        );
    }
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["outsider".into()]), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec![]), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[unrelated])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[session])
            .await
            .unwrap(),
        vec![session]
    );
    // Revocation must be reflected by the next allowlist query.
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = 'channel'",
        session
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[])
            .await
            .unwrap()
            .is_empty()
    );
}
