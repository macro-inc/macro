use super::*;

#[tokio::test]
async fn public_call_permissions_do_not_grant_anonymous_session_access() {
    let repo = MockRepo::new();
    *repo.agent_session_parent.lock().await = Some(AgentSessionParent::Call(Uuid::now_v7()));
    let service = EntityAccessServiceImpl::new(repo.clone());
    for permission in [AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit] {
        *repo.call_access.lock().await = Some(permission);
        assert_eq!(
            service
                .get_access_level(None, "session", EntityType::AgentSession)
                .await
                .unwrap(),
            None
        );
        assert!(matches!(
            service
                .get_entity_permission(None, "session", EntityType::AgentSession, None)
                .await,
            Err(AccessError::Unauthorized)
        ));
    }
}

#[tokio::test]
async fn directly_shared_public_sessions_keep_their_own_access_without_inheriting_call_access() {
    let repo = MockRepo::new().with_call_access(AccessLevel::Comment);
    *repo.agent_session_parent.lock().await = Some(AgentSessionParent::Call(Uuid::now_v7()));
    *repo.agent_session_access.lock().await = Some(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    assert_eq!(
        service
            .get_entity_permission(None, "session", EntityType::AgentSession, None)
            .await
            .unwrap(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        }
    );
}

#[tokio::test]
async fn call_session_access_tracks_current_call_permission_and_preserves_owner_grants() {
    let repo = MockRepo::new();
    let call_id = Uuid::now_v7();
    *repo.agent_session_parent.lock().await = Some(AgentSessionParent::Call(call_id));
    let service = EntityAccessServiceImpl::new(repo.clone());
    let user = test_user_id();
    for (permission, expected) in [
        (Some(AccessLevel::View), Some(AccessLevel::View)),
        (Some(AccessLevel::Comment), Some(AccessLevel::Edit)),
        (Some(AccessLevel::Edit), Some(AccessLevel::Edit)),
        (Some(AccessLevel::Owner), Some(AccessLevel::Edit)),
        (None, None),
    ] {
        *repo.call_access.lock().await = permission;
        assert_eq!(
            service
                .get_access_level(Some(&user), "session", EntityType::AgentSession)
                .await
                .unwrap(),
            expected
        );
        assert_eq!(
            service
                .generate_entity_access_receipt::<EditAccessLevel>(
                    &user,
                    None,
                    "session",
                    EntityType::AgentSession,
                )
                .await
                .is_ok(),
            expected == Some(AccessLevel::Edit)
        );
    }
    *repo.agent_session_access.lock().await = Some(AccessLevel::Owner);
    assert_eq!(
        service
            .get_access_level(Some(&user), "session", EntityType::AgentSession)
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
}

#[tokio::test]
async fn call_session_team_scope_tracks_current_parent_access() {
    let repo = MockRepo::new();
    let call_id = Uuid::now_v7();
    *repo.agent_session_parent.lock().await = Some(AgentSessionParent::Call(call_id));
    let service = EntityAccessServiceImpl::new(repo.clone());
    for (permission, expected) in [
        (Some(AccessLevel::View), Some(AccessLevel::View)),
        (Some(AccessLevel::Comment), Some(AccessLevel::Edit)),
        (Some(AccessLevel::Edit), Some(AccessLevel::Edit)),
        (Some(AccessLevel::Owner), Some(AccessLevel::Edit)),
        (None, None),
    ] {
        *repo.team_entity_access.lock().await = permission;
        repo.team_entity_requests.lock().await.clear();
        let receipt = service
            .generate_bot_entity_access_receipt::<ViewAccessLevel>(
                test_bot_id(),
                test_bot_scope(),
                "session",
                EntityType::AgentSession,
            )
            .await;
        match expected {
            Some(access_level) => {
                let receipt = receipt.unwrap();
                assert_eq!(
                    receipt.entity_permission(),
                    &EntityPermission::AccessLevel { access_level }
                );
                assert_eq!(
                    receipt.get_authenticated_bot_auth().unwrap().scope(),
                    &BotReceiptScope::from(&test_bot_scope())
                );
            }
            None => assert!(matches!(receipt, Err(AccessError::Unauthorized))),
        }
        assert_eq!(
            *repo.team_entity_requests.lock().await,
            vec![
                ("session".into(), EntityType::AgentSession),
                (call_id.to_string(), EntityType::Call),
            ]
        );
    }
    *repo.team_agent_session_access.lock().await = Some(AccessLevel::Owner);
    let owner = service
        .generate_bot_entity_access_receipt::<OwnerAccessLevel>(
            test_bot_id(),
            test_bot_scope(),
            "session",
            EntityType::AgentSession,
        )
        .await
        .unwrap();
    assert_eq!(
        owner.entity_permission(),
        &EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    );
}

#[tokio::test]
async fn a_missing_live_parent_never_inherits_unrelated_call_access() {
    let repo = MockRepo::new()
        .with_call_access(AccessLevel::Comment)
        .with_team_entity_access(AccessLevel::Comment);
    let service = EntityAccessServiceImpl::new(repo.clone());
    assert_eq!(
        service
            .get_access_level(Some(&test_user_id()), "session", EntityType::AgentSession)
            .await
            .unwrap(),
        None
    );
    assert!(matches!(
        service
            .generate_bot_entity_access_receipt::<ViewAccessLevel>(
                test_bot_id(),
                test_bot_scope(),
                "session",
                EntityType::AgentSession,
            )
            .await,
        Err(AccessError::Unauthorized)
    ));
    assert_eq!(
        *repo.team_entity_requests.lock().await,
        vec![("session".into(), EntityType::AgentSession)]
    );
}
