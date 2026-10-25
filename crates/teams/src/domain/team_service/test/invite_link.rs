use uuid::Uuid;

use super::*;
use crate::domain::{
    model::{
        JoinTeamByInviteLinkError, JoinTeamByInviteLinkOutcome, ManageTeamInviteLinkError,
        TeamInviteLinkTeam, TeamInviteLinkToken,
    },
    team_repo::TeamInviteLinkService,
};

const TEAM_ID: Uuid = Uuid::from_u128(0x1_1000);
const CALLER: &str = "macro|caller@example.com";
const JOINER: &str = "macro|joiner@example.com";

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(CALLER).unwrap()
}

fn joiner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(JOINER).unwrap()
}

fn repository(role: TeamRole, allow_non_admin_invites: bool) -> MockTeamRepository {
    MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())))
        .with_caller_team_role(Some(role))
        .with_allow_non_admin_invites(allow_non_admin_invites)
}

fn service(team_repository: MockTeamRepository) -> impl TeamInviteLinkService + use<> {
    TeamServiceImpl::new(
        team_repository,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
}

/// A repository whose team has an invite link and whose free team accepts
/// `JOINER` as a new member.
fn repository_with_link(token: TeamInviteLinkToken) -> MockTeamRepository {
    let mut team_repository = repository(TeamRole::Member, true);
    *team_repository.invite_link.lock().unwrap() = Some(token);
    team_repository.invite_link_team = Some(TeamInviteLinkTeam {
        team_id: TEAM_ID,
        team_name: "Acme".to_string(),
    });
    team_repository.add_user_to_team_result = Some(TeamMember {
        team_id: TEAM_ID,
        user_id: joiner(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    team_repository
}

fn acme(team_id: Uuid) -> Team {
    Team::new(
        team_id,
        "Acme".to_string(),
        "ACME".to_string(),
        caller(),
        false,
        false,
    )
}

#[tokio::test]
async fn members_create_the_first_link_when_anyone_may_invite() {
    let team_repository = repository(TeamRole::Member, true);
    let service = service(team_repository.clone());

    let token = service
        .create_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
        .await
        .unwrap();

    assert_eq!(*team_repository.invite_link.lock().unwrap(), Some(token));
    assert_eq!(
        service
            .get_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
            .await
            .unwrap(),
        Some(token)
    );
}

#[tokio::test]
async fn members_cannot_see_or_create_links_when_only_admins_may_invite() {
    let team_repository = repository(TeamRole::Member, false);
    *team_repository.invite_link.lock().unwrap() = Some(TeamInviteLinkToken::generate());
    let service = service(team_repository.clone());

    assert!(matches!(
        service
            .get_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
            .await,
        Err(ManageTeamInviteLinkError::NonAdminInvitesDisabled)
    ));
    assert!(matches!(
        service
            .create_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
            .await,
        Err(ManageTeamInviteLinkError::NonAdminInvitesDisabled)
    ));
}

#[tokio::test]
async fn admins_manage_links_when_only_admins_may_invite() {
    let team_repository = repository(TeamRole::Admin, false);
    let service = service(team_repository.clone());

    let token = service
        .create_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
        .await
        .unwrap();

    assert_eq!(
        service
            .get_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
            .await
            .unwrap(),
        Some(token)
    );
}

#[tokio::test]
async fn only_admins_reset_an_existing_link() {
    let existing = TeamInviteLinkToken::generate();
    let member_repository = repository(TeamRole::Member, true);
    *member_repository.invite_link.lock().unwrap() = Some(existing);

    assert!(matches!(
        service(member_repository.clone())
            .create_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
            .await,
        Err(ManageTeamInviteLinkError::ResetRequiresAdmin)
    ));
    assert_eq!(
        *member_repository.invite_link.lock().unwrap(),
        Some(existing)
    );

    let owner_repository = repository(TeamRole::Owner, true);
    *owner_repository.invite_link.lock().unwrap() = Some(existing);
    let reset = service(owner_repository.clone())
        .create_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
        .await
        .unwrap();

    assert_ne!(reset, existing);
    assert_eq!(*owner_repository.invite_link.lock().unwrap(), Some(reset));
}

#[tokio::test]
async fn turning_off_the_link_stops_it_from_joining() {
    let token = TeamInviteLinkToken::generate();
    let team_repository = repository_with_link(token);
    let service = service(team_repository.clone());

    service
        .delete_team_invite_link(test_team_receipt(TEAM_ID, &caller()))
        .await
        .unwrap();

    assert!(matches!(
        service.get_team_by_invite_link(&token).await,
        Err(JoinTeamByInviteLinkError::LinkNotFound)
    ));
    assert!(matches!(
        service.join_team_by_invite_link(&token, &joiner()).await,
        Err(JoinTeamByInviteLinkError::LinkNotFound)
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn joining_by_link_adds_the_user_and_publishes_the_join_method() {
    let token = TeamInviteLinkToken::generate();
    let team_repository = repository_with_link(token);
    let channels = RecordingChannelService::default();
    let event_broker = RecordingEventBroker::default();
    let service = TeamServiceImpl::new(
        team_repository.clone(),
        MockCustomerRepository::default(),
        channels.clone(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(event_broker.clone());

    let outcome = service
        .join_team_by_invite_link(&token, &joiner())
        .await
        .unwrap();

    let JoinTeamByInviteLinkOutcome::Joined(member) = outcome else {
        panic!("expected the user to join, got {outcome:?}");
    };
    assert_eq!(member.team_id, TEAM_ID);
    assert_eq!(member.user_id, joiner());
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 1);
    assert_eq!(
        *channels.auto_join_calls.lock().unwrap(),
        vec![(TEAM_ID, JOINER.to_string())]
    );
    let published = event_broker.events();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].envelope["metadata"]["join_method"],
        serde_json::json!({ "type": "invite_link" })
    );
}

#[tokio::test]
async fn joining_by_a_wrong_token_changes_nothing() {
    let team_repository = repository_with_link(TeamInviteLinkToken::generate());
    let service = service(team_repository.clone());

    assert!(matches!(
        service
            .join_team_by_invite_link(&TeamInviteLinkToken::generate(), &joiner())
            .await,
        Err(JoinTeamByInviteLinkError::LinkNotFound)
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn joining_a_team_you_are_on_is_a_no_op() {
    let token = TeamInviteLinkToken::generate();
    let mut team_repository = repository_with_link(token);
    team_repository.user_teams = vec![acme(TEAM_ID)];
    let service = service(team_repository.clone());

    let outcome = service
        .join_team_by_invite_link(&token, &joiner())
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        JoinTeamByInviteLinkOutcome::AlreadyMember { team_id: TEAM_ID }
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn a_concurrent_join_to_the_same_team_is_a_no_op() {
    let token = TeamInviteLinkToken::generate();
    let mut team_repository = repository_with_link(token);
    team_repository.add_user_to_team_result = None;
    team_repository.user_teams_after_add = Some(vec![acme(TEAM_ID)]);
    let service = service(team_repository.clone());

    assert!(matches!(
        service.join_team_by_invite_link(&token, &joiner()).await,
        Ok(JoinTeamByInviteLinkOutcome::AlreadyMember { team_id: TEAM_ID })
    ));
}

#[tokio::test]
async fn a_concurrent_join_to_another_team_is_reported_as_a_conflict() {
    let token = TeamInviteLinkToken::generate();
    let mut team_repository = repository_with_link(token);
    team_repository.add_user_to_team_result = None;
    team_repository.user_teams_after_add = Some(vec![acme(Uuid::from_u128(0x2_2000))]);
    let service = service(team_repository.clone());

    assert!(matches!(
        service.join_team_by_invite_link(&token, &joiner()).await,
        Err(JoinTeamByInviteLinkError::AlreadyInAnotherTeam)
    ));
}

#[tokio::test]
async fn users_on_another_team_cannot_join_by_link() {
    let token = TeamInviteLinkToken::generate();
    let mut team_repository = repository_with_link(token);
    team_repository.user_teams = vec![acme(Uuid::from_u128(0x2_2000))];
    let service = service(team_repository.clone());

    assert!(matches!(
        service.join_team_by_invite_link(&token, &joiner()).await,
        Err(JoinTeamByInviteLinkError::AlreadyInAnotherTeam)
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
}
