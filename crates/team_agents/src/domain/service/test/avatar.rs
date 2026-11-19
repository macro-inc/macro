use super::*;

#[tokio::test]
async fn invalid_avatar_recipes_never_start_an_invite() {
    for face in [
        serde_json::json!({"v":2,"seed":"avatar","pins":{}}),
        serde_json::json!({"v":1,"seed":"x".repeat(65),"pins":{}}),
        serde_json::json!({"v":1,"seed":"","pins":{}}),
        serde_json::json!({"v":1,"seed":"avatar","pins":{"hair":-1}}),
        serde_json::json!({"v":1,"seed":"avatar","pins":{"hair":"bun"}}),
        serde_json::json!({"v":1,"seed":"avatar","pins":{"x".repeat(1024):1}}),
    ] {
        let (service, journal) = service(true, FakeComputers::default());
        let parsed = serde_json::from_value::<CreateTeamAgent>(serde_json::json!({
            "purchaseKey":"invite-face", "name":"Agent", "size":"standard", "avatarFace":face,
        }));
        if let Ok(request) = parsed {
            assert!(
                service.create(receipt(), request).await.is_err(),
                "invalid face accepted: {face}"
            );
        }
        assert!(
            journal.entries().is_empty(),
            "invalid face must not create accounts or buy computers"
        );
    }
}

#[tokio::test]
async fn an_admin_saves_a_face_before_notifying_clients() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    let before = journal.entries().len();
    let avatar = serde_json::from_value(serde_json::json!({
        "face":{"v":1,"seed":"portrait","pins":{"hair":2}}, "url":null,
    }))
    .unwrap();
    service
        .set_avatar(receipt(), &created.user_id, avatar)
        .await
        .unwrap();
    assert_eq!(
        &journal.entries()[before..],
        &["avatar.save", "picture.changed"]
    );
}

#[tokio::test]
async fn avatar_edits_refuse_other_teams_disabled_rollout_and_invalid_recipes() {
    let (service, journal, flags) = service_with_flags(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    let before = journal.entries().len();
    let other_team = EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(ADMIN),
        "00000000-0000-0000-0000-000000000000",
        EntityType::Team,
    );
    assert!(matches!(
        service
            .set_avatar(
                other_team,
                &created.user_id,
                AgentAvatar {
                    face: None,
                    url: Some("https://static.example/photo.png".to_owned())
                }
            )
            .await,
        Err(TeamAgentError::NotFound)
    ));
    let invalid = serde_json::from_value(serde_json::json!({
        "face":{"v":2,"seed":"portrait","pins":{}},"url":null,
    }))
    .unwrap();
    assert!(matches!(
        service
            .set_avatar(receipt(), &created.user_id, invalid)
            .await,
        Err(TeamAgentError::InvalidAvatarFace)
    ));
    assert!(matches!(
        service
            .set_avatar(
                receipt(),
                &created.user_id,
                AgentAvatar {
                    face: None,
                    url: Some("javascript:bad".to_owned())
                }
            )
            .await,
        Err(TeamAgentError::InvalidAvatar)
    ));
    flags.set(false);
    assert!(matches!(
        service
            .set_avatar(
                receipt(),
                &created.user_id,
                AgentAvatar {
                    face: None,
                    url: None
                }
            )
            .await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert_eq!(journal.entries().len(), before);
}
