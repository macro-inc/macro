use super::*;

#[tokio::test]
async fn managed_channels_reject_native_rename_conversion_and_unwired_deletion() {
    let channel = Uuid::now_v7();
    let repo = FakeMutationRepo::new(channel, "macro|sender@test.com");
    repo.state.lock().unwrap().messaging_binding =
        crate::domain::models::MessagingBinding::WhatsappGroup;
    let service = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );
    for request in [
        PatchChannelRequest {
            channel_name: Some("Local rename".into()),
            convert_to_team_channel: None,
            auto_join_team: None,
        },
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: Some(true),
            auto_join_team: None,
        },
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(true),
        },
    ] {
        assert!(matches!(
            service
                .patch_channel(
                    patch_receipt("macro|sender@test.com", channel, AccessRole::Owner),
                    request
                )
                .await,
            Err(ChannelMutationErr::Forbidden(_))
        ));
    }
    assert!(repo.state.lock().unwrap().channel_patches.is_empty());
    assert!(matches!(
        service
            .delete_channel(sender("macro|sender@test.com"), channel)
            .await,
        Err(ChannelMutationErr::Forbidden(_))
    ));
}
