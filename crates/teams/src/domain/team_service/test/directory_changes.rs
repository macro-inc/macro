//! Membership changes tell the members whose teammates changed which contacts
//! to re-read.

use super::*;

const OWNER: &str = "macro|owner@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";
const MEMBER: &str = "macro|member@example.com";

fn team(team_id: uuid::Uuid) -> Team {
    Team::new(
        team_id,
        "Contacts Team".to_string(),
        "contacts-team".to_string(),
        MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned(),
        false,
        true,
    )
}

fn service(
    team_repository: MockTeamRepository,
    contacts_enqueuer: &RecordingContactsEnqueuer,
) -> impl TeamService {
    TeamServiceImpl::new(
        team_repository,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_contacts_enqueuer(contacts_enqueuer.clone())
}

fn ids(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

/// The roster re-reads the member, and the member re-reads the roster.
fn roster_and_member_changes() -> Vec<DirectoryChange> {
    vec![
        (ids(&[OWNER, TEAMMATE]), ids(&[MEMBER])),
        (ids(&[MEMBER]), ids(&[OWNER, TEAMMATE])),
    ]
}

#[tokio::test]
async fn accepting_an_invite_names_the_joiner_and_the_roster() {
    let team_id = uuid::Uuid::from_u128(0x6330_0001);
    let invite_id = uuid::Uuid::from_u128(0x6330_0002);
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository = make_enterprise_join_team_repository(team_id, invite_id, &member)
        .with_team(team(team_id))
        .with_team_members(vec![
            make_team_member(team_id, TEAMMATE, TeamRole::Member),
            make_team_member(team_id, MEMBER, TeamRole::Member),
        ]);
    let contacts_enqueuer = RecordingContactsEnqueuer::default();

    service(team_repository, &contacts_enqueuer)
        .join_team(&invite_id, &member)
        .await
        .unwrap();

    assert_eq!(
        *contacts_enqueuer.directory_changes.lock().unwrap(),
        roster_and_member_changes()
    );
}

#[tokio::test]
async fn joining_by_domain_names_the_joiner_and_the_roster() {
    let team_id = uuid::Uuid::from_u128(0x6330_0003);
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository = make_enterprise_domain_join_team_repository(team_id, &member)
        .with_team(team(team_id))
        .with_team_members(vec![
            make_team_member(team_id, TEAMMATE, TeamRole::Member),
            make_team_member(team_id, MEMBER, TeamRole::Member),
        ]);
    let contacts_enqueuer = RecordingContactsEnqueuer::default();

    service(team_repository, &contacts_enqueuer)
        .try_join_team_by_domain(&member)
        .await
        .unwrap()
        .expect("the member should join the team");

    assert_eq!(
        *contacts_enqueuer.directory_changes.lock().unwrap(),
        roster_and_member_changes()
    );
}

#[tokio::test]
async fn a_rolled_back_join_names_nobody() {
    let team_id = uuid::Uuid::from_u128(0x6330_0004);
    let invite_id = uuid::Uuid::from_u128(0x6330_0005);
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository = make_enterprise_join_team_repository(team_id, invite_id, &member)
        .with_team(team(team_id))
        .with_team_members(vec![make_team_member(team_id, TEAMMATE, TeamRole::Member)]);
    let contacts_enqueuer = RecordingContactsEnqueuer::default();
    let service = TeamServiceImpl::new(
        team_repository,
        MockCustomerRepository::default(),
        RecordingChannelService {
            fail_auto_join: true,
            ..Default::default()
        },
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_contacts_enqueuer(contacts_enqueuer.clone());

    service.join_team(&invite_id, &member).await.unwrap_err();

    assert!(
        contacts_enqueuer
            .directory_changes
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn removing_a_member_names_them_and_the_remaining_roster() {
    let team_id = uuid::Uuid::from_u128(0x6330_0006);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member, TeamRole::Member)
            .with_team(team(team_id))
            .with_team_members(vec![make_team_member(team_id, TEAMMATE, TeamRole::Member)]);
    let contacts_enqueuer = RecordingContactsEnqueuer::default();

    service(team_repository, &contacts_enqueuer)
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &member)
        .await
        .unwrap();

    assert_eq!(
        *contacts_enqueuer.directory_changes.lock().unwrap(),
        roster_and_member_changes()
    );
}

#[tokio::test]
async fn a_failed_directory_change_does_not_undo_a_removal() {
    let team_id = uuid::Uuid::from_u128(0x6330_0007);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member, TeamRole::Member)
            .with_team(team(team_id));
    let rollback_remove_calls = team_repository.rollback_remove_calls.clone();
    let contacts_enqueuer = RecordingContactsEnqueuer::failing();

    service(team_repository, &contacts_enqueuer)
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &member)
        .await
        .unwrap();

    assert_eq!(*rollback_remove_calls.lock().unwrap(), 0);
    assert_eq!(contacts_enqueuer.directory_changes.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn deleting_a_team_names_every_member_to_every_member() {
    let team_id = uuid::Uuid::from_u128(0x6330_0008);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Team", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_members = vec![
        make_team_member(team_id, OWNER, TeamRole::Owner),
        make_team_member(team_id, TEAMMATE, TeamRole::Member),
        make_team_member(team_id, MEMBER, TeamRole::Member),
    ];
    let contacts_enqueuer = RecordingContactsEnqueuer::default();
    let service = TeamServiceImpl::new(
        team_repository,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_contacts_enqueuer(contacts_enqueuer.clone())
    .with_owned_entity_cleanup(RecordingOwnedEntityCleanup::default());

    service
        .delete_team(test_team_receipt::<OwnerTeamRole>(team_id, &owner))
        .await
        .unwrap();

    let members = ids(&[OWNER, TEAMMATE, MEMBER]);
    assert_eq!(
        *contacts_enqueuer.directory_changes.lock().unwrap(),
        vec![(members.clone(), members)]
    );
}

fn pairs(pairs: &[(&str, &str)]) -> Vec<Vec<ContactPair>> {
    vec![
        pairs
            .iter()
            .map(|(first, second)| {
                (
                    MacroUserIdStr::parse_from_str(first).unwrap().into_owned(),
                    MacroUserIdStr::parse_from_str(second).unwrap().into_owned(),
                )
            })
            .collect(),
    ]
}

#[tokio::test]
async fn removing_a_member_disconnects_them_from_the_remaining_roster() {
    let team_id = uuid::Uuid::from_u128(0x6330_0009);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member, TeamRole::Member)
            .with_team(team(team_id))
            .with_team_members(vec![make_team_member(team_id, TEAMMATE, TeamRole::Member)]);
    let contacts_enqueuer = RecordingContactsEnqueuer::default();

    service(team_repository, &contacts_enqueuer)
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &member)
        .await
        .unwrap();

    assert_eq!(
        *contacts_enqueuer.disconnections.lock().unwrap(),
        pairs(&[(MEMBER, OWNER), (MEMBER, TEAMMATE)])
    );
}

#[tokio::test]
async fn members_leaving_together_still_disconnect_from_each_other() {
    // The teammate's removal commits while the member's is in flight, so the
    // roster after the member's removal no longer holds either of them.
    let team_id = uuid::Uuid::from_u128(0x6330_000b);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let member = MacroUserIdStr::parse_from_str(MEMBER).unwrap();
    let mut team_repository =
        make_enterprise_remove_user_repository(team_id, &member, TeamRole::Member)
            .with_team(team(team_id))
            .with_team_members(vec![
                make_team_member(team_id, TEAMMATE, TeamRole::Member),
                make_team_member(team_id, MEMBER, TeamRole::Member),
            ]);
    team_repository.team_members_after_remove = Some(Vec::new());
    let contacts_enqueuer = RecordingContactsEnqueuer::default();

    service(team_repository, &contacts_enqueuer)
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &member)
        .await
        .unwrap();

    assert_eq!(
        *contacts_enqueuer.disconnections.lock().unwrap(),
        pairs(&[(MEMBER, OWNER), (MEMBER, TEAMMATE)])
    );
}

#[tokio::test]
async fn deleting_a_team_disconnects_every_pair_of_members() {
    let team_id = uuid::Uuid::from_u128(0x6330_000a);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Team", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_members = vec![
        make_team_member(team_id, OWNER, TeamRole::Owner),
        make_team_member(team_id, TEAMMATE, TeamRole::Member),
        make_team_member(team_id, MEMBER, TeamRole::Member),
    ];
    let contacts_enqueuer = RecordingContactsEnqueuer::default();
    let service = TeamServiceImpl::new(
        team_repository,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_contacts_enqueuer(contacts_enqueuer.clone())
    .with_owned_entity_cleanup(RecordingOwnedEntityCleanup::default());

    service
        .delete_team(test_team_receipt::<OwnerTeamRole>(team_id, &owner))
        .await
        .unwrap();

    assert_eq!(
        *contacts_enqueuer.disconnections.lock().unwrap(),
        pairs(&[(OWNER, TEAMMATE), (OWNER, MEMBER), (TEAMMATE, MEMBER)])
    );
}
