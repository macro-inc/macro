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

const PHOTO: &str = "0192a8f0-1c2d-7e3f-8a9b-0c1d2e3f4a5b";

#[tokio::test]
async fn an_invite_with_a_picture_from_another_host_never_starts() {
    let (refusing, journal) = service(true, FakeComputers::default());
    let elsewhere = CreateTeamAgent {
        avatar_url: Some(format!("https://tracker.example/file/{PHOTO}")),
        ..request()
    };
    assert!(matches!(
        refusing.create(receipt(), elsewhere).await,
        Err(TeamAgentError::InvalidAvatar)
    ));
    assert!(journal.entries().is_empty());

    let (accepting, _) = service(true, FakeComputers::default());
    let uploaded = CreateTeamAgent {
        avatar_url: Some(format!("{PICTURES}/file/{PHOTO}")),
        ..request()
    };
    assert!(accepting.create(receipt(), uploaded).await.is_ok());
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
                    url: Some(format!("{PICTURES}/file/{PHOTO}"))
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
    // Only Macro's own static files: no other host, and no other path there.
    for url in [
        format!("https://tracker.example/file/{PHOTO}"),
        format!("{PICTURES}/file/not-a-uuid"),
        format!("{PICTURES}/file/{PHOTO}?track=1"),
        format!("{PICTURES}.example/file/{PHOTO}"),
    ] {
        assert!(
            matches!(
                service
                    .set_avatar(
                        receipt(),
                        &created.user_id,
                        AgentAvatar {
                            face: None,
                            url: Some(url.clone())
                        }
                    )
                    .await,
                Err(TeamAgentError::InvalidAvatar)
            ),
            "accepted {url}"
        );
    }
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
