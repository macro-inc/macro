use super::*;

const AGENT_RUNTIME: ShareEntity = ShareEntity {
    entity_type: ShareEntityType::Harness,
    entity_id: Uuid::from_u128(0x50),
};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("agent_harness"))
)]
async fn agent_runtime_requests_and_direct_grants_cannot_escalate_teammates(pool: PgPool) {
    let (service, _) = setup(pool.clone());
    for reviewer in ["owner", "teamowner", "admin"] {
        let state = service
            .state(user(reviewer), AGENT_RUNTIME, 0)
            .await
            .unwrap();
        assert!(state.can_review);
        assert_eq!(state.owner.as_deref(), Some("macro|owner@requests.test"));
        assert_eq!(state.supported_levels, [AccessLevel::View]);
    }
    for non_reviewer in ["member", "agent"] {
        assert!(
            !service
                .state(user(non_reviewer), AGENT_RUNTIME, 0)
                .await
                .unwrap()
                .can_review
        );
    }
    assert!(matches!(
        service
            .submit(
                user("member"),
                AGENT_RUNTIME,
                ask(AccessLevel::Edit, None),
                None
            )
            .await,
        Err(RequestError::InvalidLevel)
    ));
    let requested = service
        .submit(
            user("member"),
            AGENT_RUNTIME,
            ask(AccessLevel::View, None),
            None,
        )
        .await
        .unwrap();
    assert_eq!(requested.requested_level, AccessLevel::View);
    assert!(matches!(
        service
            .set_direct_access(
                user("admin"),
                AGENT_RUNTIME,
                user("recipient"),
                Some(AccessLevel::Edit)
            )
            .await,
        Err(RequestError::InvalidLevel)
    ));
    assert!(matches!(
        service
            .set_direct_access(
                user("member"),
                AGENT_RUNTIME,
                user("recipient"),
                Some(AccessLevel::View)
            )
            .await,
        Err(RequestError::Forbidden)
    ));
    assert!(matches!(
        service
            .set_direct_access(
                user("agent"),
                AGENT_RUNTIME,
                user("recipient"),
                Some(AccessLevel::View)
            )
            .await,
        Err(RequestError::Forbidden)
    ));
    // Sharing a different team with the runtime owner does not qualify.
    assert!(matches!(
        service
            .set_direct_access(
                user("owner"),
                AGENT_RUNTIME,
                user("outsider"),
                Some(AccessLevel::View)
            )
            .await,
        Err(RequestError::Forbidden)
    ));
    assert!(matches!(
        service
            .submit(
                user("outsider"),
                AGENT_RUNTIME,
                ask(AccessLevel::View, None),
                None
            )
            .await,
        Err(RequestError::Forbidden)
    ));
    service
        .set_direct_access(
            user("teamowner"),
            AGENT_RUNTIME,
            user("recipient"),
            Some(AccessLevel::View),
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .direct_access(user("owner"), AGENT_RUNTIME)
            .await
            .unwrap()[0]
            .access_level,
        AccessLevel::View
    );
    service
        .set_direct_access(user("owner"), AGENT_RUNTIME, user("recipient"), None)
        .await
        .unwrap();
    assert!(
        service
            .direct_access(user("owner"), AGENT_RUNTIME)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("agent_harness"))
)]
async fn a_pending_request_cannot_be_approved_as_user_on_an_agent_computer(pool: PgPool) {
    // A request can predate the computer acquiring its agent binding.
    let id = Uuid::now_v7();
    let requester = user("member");
    sqlx::query!("INSERT INTO entity_access_request (id, entity_type, entity_id, requester_id, requested_level, status, revision, created_at, updated_at) VALUES ($1, 'harness', $2, $3, 'view', 'pending', 1, now(), now())", id, AGENT_RUNTIME.entity_id, requester.as_ref()).execute(&pool).await.unwrap();
    let (service, _) = setup(pool.clone());
    assert!(matches!(
        service
            .resolve(
                user("admin"),
                AGENT_RUNTIME,
                id,
                ResolveRequest {
                    revision: 1,
                    granted_level: Some(AccessLevel::Edit)
                }
            )
            .await,
        Err(RequestError::InvalidLevel)
    ));
    assert!(matches!(
        service
            .resolve(
                user("member"),
                AGENT_RUNTIME,
                id,
                ResolveRequest {
                    revision: 1,
                    granted_level: Some(AccessLevel::View)
                }
            )
            .await,
        Err(RequestError::Forbidden)
    ));
    let approved = service
        .resolve(
            user("admin"),
            AGENT_RUNTIME,
            id,
            ResolveRequest {
                revision: 1,
                granted_level: Some(AccessLevel::View),
            },
        )
        .await
        .unwrap();
    assert_eq!(approved.granted_level, Some(AccessLevel::View));
    assert_eq!(approved.status, RequestStatus::Granted);
    assert_eq!(
        service
            .direct_access(user("owner"), AGENT_RUNTIME)
            .await
            .unwrap()[0]
            .access_level,
        AccessLevel::View
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("agent_harness"))
)]
async fn either_persona_or_agent_binding_keeps_the_view_cap(pool: PgPool) {
    let (service, _) = setup(pool.clone());
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = NULL WHERE id = $1",
        Uuid::from_u128(0x40)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        service
            .state(user("owner"), AGENT_RUNTIME, 0)
            .await
            .unwrap()
            .supported_levels,
        [AccessLevel::View]
    );
    assert!(matches!(
        service
            .set_direct_access(
                user("admin"),
                AGENT_RUNTIME,
                user("member"),
                Some(AccessLevel::Edit)
            )
            .await,
        Err(RequestError::InvalidLevel)
    ));
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = '{}'::jsonb WHERE id = $1",
        Uuid::from_u128(0x40)
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM team_agents WHERE computer_id = $1",
        Uuid::from_u128(0x40)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        service
            .state(user("owner"), AGENT_RUNTIME, 0)
            .await
            .unwrap()
            .supported_levels,
        [AccessLevel::View]
    );
    assert!(matches!(
        service
            .set_direct_access(
                user("admin"),
                AGENT_RUNTIME,
                user("member"),
                Some(AccessLevel::Edit)
            )
            .await,
        Err(RequestError::InvalidLevel)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("agent_harness"))
)]
async fn invited_automatic_grants_use_the_shared_view_cap(pool: PgPool) {
    let invite_id = Uuid::now_v7();
    sqlx::query!("INSERT INTO team_invite (id, email, team_id, invited_by) VALUES ($1, 'member@requests.test', $2, 'macro|owner@requests.test')", invite_id, Uuid::from_u128(0x20)).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO team_invite_harness_grant (team_invite_id, harness_id) VALUES ($1, $2)",
        invite_id,
        AGENT_RUNTIME.entity_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::grant_invited_harnesses(
        &mut tx,
        &invite_id,
        &user("owner"),
        &user("member"),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let (service, _) = setup(pool);
    assert_eq!(
        service
            .direct_access(user("owner"), AGENT_RUNTIME)
            .await
            .unwrap()[0]
            .access_level,
        AccessLevel::View
    );
}
