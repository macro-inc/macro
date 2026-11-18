use super::*;

#[tokio::test]
async fn channel_owner_can_delete_every_channel_type() {
    for channel_type in [
        ChannelType::Private,
        ChannelType::Public,
        ChannelType::Team,
        ChannelType::DirectMessage,
    ] {
        let channel_id = Uuid::now_v7();
        let repo = FakeMutationRepo::new(channel_id, "macro|owner@example.com");
        repo.state.lock().unwrap().channel_type = channel_type;
        let events = FakeEvents::default();
        let svc = mutation_service(
            repo.clone(),
            events.clone(),
            FakeReferenceSharing::default(),
        );

        svc.delete_channel(sender("macro|owner@example.com"), channel_id)
            .await
            .unwrap();

        assert_eq!(repo.state.lock().unwrap().deleted_channels, [channel_id]);
        assert!(
            matches!(events.events.lock().unwrap().as_slice(), [ChannelEvent::ChannelDeleted { channel_id: id, .. }] if *id == channel_id)
        );
    }
}

#[tokio::test]
async fn only_admins_of_the_channels_own_team_can_delete_without_ownership() {
    let channel_team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    let actor = "macro|member@example.com";
    for (channel_type, team_id, role_team, role, allowed) in [
        (
            ChannelType::Team,
            Some(channel_team),
            channel_team,
            TeamRole::Admin,
            true,
        ),
        (
            ChannelType::Team,
            Some(channel_team),
            channel_team,
            TeamRole::Owner,
            true,
        ),
        (
            ChannelType::Team,
            Some(channel_team),
            channel_team,
            TeamRole::Member,
            false,
        ),
        (
            ChannelType::Team,
            Some(channel_team),
            other_team,
            TeamRole::Admin,
            false,
        ),
        (
            ChannelType::Team,
            Some(channel_team),
            other_team,
            TeamRole::Owner,
            false,
        ),
        (
            ChannelType::Team,
            None,
            channel_team,
            TeamRole::Admin,
            false,
        ),
        (
            ChannelType::Private,
            None,
            channel_team,
            TeamRole::Admin,
            false,
        ),
        (
            ChannelType::Public,
            None,
            channel_team,
            TeamRole::Owner,
            false,
        ),
        (
            ChannelType::DirectMessage,
            None,
            channel_team,
            TeamRole::Owner,
            false,
        ),
    ] {
        let channel_id = Uuid::now_v7();
        let repo = FakeMutationRepo::new(channel_id, "macro|owner@example.com");
        {
            let mut state = repo.state.lock().unwrap();
            state.channel_type = channel_type;
            state.participants[1].user_id = actor.to_string();
            state.channel_team_id = team_id;
            state
                .team_roles
                .insert((actor.to_string(), role_team), role);
        }
        let events = FakeEvents::default();
        let svc = mutation_service(
            repo.clone(),
            events.clone(),
            FakeReferenceSharing::default(),
        );

        let result = svc.delete_channel(sender(actor), channel_id).await;

        assert_eq!(
            result.is_ok(),
            allowed,
            "{channel_type:?} {team_id:?} {role_team} {role:?}"
        );
        if allowed {
            assert_eq!(repo.state.lock().unwrap().deleted_channels, [channel_id]);
            assert_eq!(events.events.lock().unwrap().len(), 1);
        } else {
            assert!(matches!(result, Err(ChannelMutationErr::Forbidden(_))));
            assert!(repo.state.lock().unwrap().deleted_channels.is_empty());
            assert!(events.events.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn channel_admin_is_not_a_team_admin() {
    let channel_id = Uuid::now_v7();
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@example.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_type = ChannelType::Team;
        state.channel_team_id = Some(Uuid::now_v7());
        state.participants[1].role = ParticipantRole::Admin;
        state.participants[1].user_id = "macro|member@example.com".to_string();
    }
    let svc = mutation_service(
        repo.clone(),
        FakeEvents::default(),
        FakeReferenceSharing::default(),
    );

    let result = svc
        .delete_channel(sender("macro|member@example.com"), channel_id)
        .await;

    assert!(matches!(result, Err(ChannelMutationErr::Forbidden(_))));
    assert!(repo.state.lock().unwrap().deleted_channels.is_empty());
}

#[cfg(feature = "entity_mutation")]
#[tokio::test]
async fn permanent_delete_checks_team_authority_after_view_access() {
    use entity_access::domain::models::{Entity, EntityPermission, ViewOnly};
    use entity_mutation::DeleteEntityPermanently;

    for allowed in [true, false] {
        let channel_id = Uuid::now_v7();
        let team_id = Uuid::now_v7();
        let actor = "macro|member@example.com";
        let repo = FakeMutationRepo::new(channel_id, "macro|owner@example.com");
        {
            let mut state = repo.state.lock().unwrap();
            state.channel_type = ChannelType::Team;
            state.channel_team_id = Some(team_id);
            if allowed {
                state
                    .team_roles
                    .insert((actor.to_string(), team_id), TeamRole::Admin);
            }
        }
        let svc = mutation_service(
            repo.clone(),
            FakeEvents::default(),
            FakeReferenceSharing::default(),
        );
        let entity = Entity {
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
        };
        let receipt = EntityAccessReceipt::<ViewOnly>::try_new_authenticated_user(
            macro_id(actor),
            entity.clone(),
            EntityPermission::ChannelViewOnly,
        )
        .unwrap();

        let entity = EntityType::Channel.with_entity_string(channel_id.to_string());
        let result = svc.delete_entity_permanently(entity, receipt).await;

        assert_eq!(result.is_ok(), allowed);
        assert_eq!(
            repo.state.lock().unwrap().deleted_channels.len(),
            usize::from(allowed)
        );
    }
}
