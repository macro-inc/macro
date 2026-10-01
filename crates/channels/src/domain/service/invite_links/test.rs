use super::*;
use crate::domain::service::invite_links::{INVITE_LIFETIME, validate_invitation};
use chrono::Duration;
use entity_access::domain::models::ParticipantRole as AccessRole;

#[tokio::test]
async fn fresh_links_last_fourteen_days_and_both_allow_external_members() {
    for channel_type in [ChannelType::Team, ChannelType::Private] {
        let repo = FakeMutationRepo::new(Uuid::new_v4(), "macro|sender@test.com");
        let channel_id = repo.state.lock().unwrap().channel_id;
        repo.state.lock().unwrap().channel_type = channel_type;
        let svc = ChannelServiceImpl::new(repo.clone());
        let before = Utc::now();
        let first = svc
            .create_invite_link(patch_receipt(
                "macro|sender@test.com",
                channel_id,
                AccessRole::Member,
            ))
            .await
            .unwrap();
        let second = svc
            .create_invite_link(patch_receipt(
                "macro|sender@test.com",
                channel_id,
                AccessRole::Member,
            ))
            .await
            .unwrap();
        assert_ne!(first.join_code, second.join_code);
        for code in [first.join_code, second.join_code] {
            let expiry = repo.state.lock().unwrap().invite_links[&code];
            assert!(expiry >= before + INVITE_LIFETIME);
            assert!(expiry <= Utc::now() + INVITE_LIFETIME);
            svc.join_channel_by_code(sender("macro|external@elsewhere.com"), code)
                .await
                .unwrap();
        }
        let state = repo.state.lock().unwrap();
        assert_eq!(
            state.participant_additions, 1,
            "joining twice is idempotent"
        );
        assert_eq!(
            state.user_team_id_lookups, 0,
            "external membership needs no team affiliation"
        );
    }
}

#[tokio::test]
async fn expired_invitation_cannot_add_a_participant() {
    let repo = FakeMutationRepo::new(Uuid::new_v4(), "macro|sender@test.com");
    let code = Uuid::new_v4();
    repo.state
        .lock()
        .unwrap()
        .invite_links
        .insert(code, Utc::now() - Duration::seconds(1));
    let svc = ChannelServiceImpl::new(repo.clone());
    assert!(matches!(
        svc.join_channel_by_code(sender("macro|external@elsewhere.com"), code)
            .await,
        Err(ChannelMutationErr::NotFound(_))
    ));
    assert_eq!(repo.state.lock().unwrap().participant_additions, 0);
}

#[tokio::test]
async fn direct_messages_cannot_mint_invites() {
    let repo = FakeMutationRepo::new(Uuid::new_v4(), "macro|sender@test.com");
    let channel_id = repo.state.lock().unwrap().channel_id;
    repo.state.lock().unwrap().channel_type = ChannelType::DirectMessage;
    let svc = ChannelServiceImpl::new(repo.clone());
    assert!(matches!(
        svc.create_invite_link(patch_receipt(
            "macro|sender@test.com",
            channel_id,
            AccessRole::Member
        ))
        .await,
        Err(ChannelMutationErr::Forbidden(_))
    ));
    assert!(repo.state.lock().unwrap().invite_links.is_empty());
}

#[test]
fn expiration_boundary_is_exclusive() {
    let now = Utc::now();
    let info = ChannelInfo {
        id: Uuid::nil(),
        name: None,
        channel_type: ChannelType::Team,
        org_id: None,
        team_id: None,
    };
    assert!(validate_invitation(&info, now, now).is_err());
    assert!(validate_invitation(&info, now + Duration::nanoseconds(1), now).is_ok());
}
