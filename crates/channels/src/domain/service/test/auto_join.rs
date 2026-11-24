use super::*;

/// A channel holding an owner and one member.
fn channel_repo(channel_id: Uuid) -> FakeMutationRepo {
    let repo = FakeMutationRepo::new(channel_id, "macro|owner@example.com");
    repo.state.lock().unwrap().participants[1].user_id = "macro|recipient@example.com".to_string();
    repo
}

fn auto_joined(events: &[ChannelEvent]) -> Vec<(Uuid, Vec<String>, Vec<String>)> {
    events
        .iter()
        .filter_map(|event| match event {
            ChannelEvent::MembersAutoJoined {
                channel_id,
                added_user_ids,
                active_participant_user_ids,
            } => {
                let mut active: Vec<String> = active_participant_user_ids
                    .iter()
                    .map(|id| id.as_ref().to_string())
                    .collect();
                active.sort();
                Some((
                    *channel_id,
                    added_user_ids
                        .iter()
                        .map(|id| id.as_ref().to_string())
                        .collect(),
                    active,
                ))
            }
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn joining_a_team_tells_contacts_who_the_joiner_now_shares_a_channel_with() {
    let channel_id = Uuid::now_v7();
    let repo = channel_repo(channel_id);
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.auto_join_by_team_id(&Uuid::now_v7(), &macro_id("macro|joiner@example.com"))
        .await
        .unwrap();

    assert_eq!(
        auto_joined(&events.events.lock().unwrap()),
        vec![(
            channel_id,
            vec!["macro|joiner@example.com".to_string()],
            vec![
                "macro|joiner@example.com".to_string(),
                "macro|owner@example.com".to_string(),
                "macro|recipient@example.com".to_string(),
            ],
        )]
    );
}

#[tokio::test]
async fn joining_a_team_whose_channels_already_hold_the_member_dispatches_nothing() {
    let channel_id = Uuid::now_v7();
    let repo = channel_repo(channel_id);
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.auto_join_by_team_id(&Uuid::now_v7(), &macro_id("macro|recipient@example.com"))
        .await
        .unwrap();

    assert!(events.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn turning_auto_join_on_tells_contacts_which_team_members_it_added() {
    let channel_id = Uuid::now_v7();
    let team_id = Uuid::now_v7();
    let repo = channel_repo(channel_id);
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_type = ChannelType::Team;
        state.channel_team_id = Some(team_id);
        state.team_members = vec![
            "macro|owner@example.com".to_string(),
            "macro|teammate@example.com".to_string(),
        ];
    }
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.patch_channel(
        patch_receipt("macro|owner@example.com", channel_id, AccessRole::Admin),
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        auto_joined(&events.events.lock().unwrap()),
        vec![(
            channel_id,
            vec!["macro|teammate@example.com".to_string()],
            vec![
                "macro|owner@example.com".to_string(),
                "macro|recipient@example.com".to_string(),
                "macro|teammate@example.com".to_string(),
            ],
        )]
    );
}

#[tokio::test]
async fn turning_auto_join_on_when_every_team_member_is_in_dispatches_no_auto_join() {
    let channel_id = Uuid::now_v7();
    let team_id = Uuid::now_v7();
    let repo = channel_repo(channel_id);
    {
        let mut state = repo.state.lock().unwrap();
        state.channel_type = ChannelType::Team;
        state.channel_team_id = Some(team_id);
        state.team_members = vec!["macro|owner@example.com".to_string()];
    }
    let events = FakeEvents::default();
    let svc = mutation_service(repo, events.clone(), FakeReferenceSharing::default());

    svc.patch_channel(
        patch_receipt("macro|owner@example.com", channel_id, AccessRole::Admin),
        PatchChannelRequest {
            channel_name: None,
            convert_to_team_channel: None,
            auto_join_team: Some(true),
        },
    )
    .await
    .unwrap();

    // Nobody joined; the patch itself is still announced to members' caches.
    let events = events.events.lock().unwrap();
    assert!(auto_joined(&events).is_empty());
    assert!(matches!(
        events.as_slice(),
        [ChannelEvent::ChannelUpdated { .. }]
    ));
}
