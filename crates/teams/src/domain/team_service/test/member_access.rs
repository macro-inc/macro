//! Telling listeners when a member is removed or loses admin.

use super::*;
use crate::domain::member_access::{MemberAccessFuture, MemberAccessLost};

/// Every team a member lost access in, in order.
#[derive(Debug, Default)]
struct RecordingMemberAccessLost(Mutex<Vec<uuid::Uuid>>);

impl RecordingMemberAccessLost {
    fn teams(&self) -> Vec<uuid::Uuid> {
        self.0.lock().unwrap().clone()
    }
}

impl MemberAccessLost for RecordingMemberAccessLost {
    fn member_access_lost(&self, team_id: uuid::Uuid) -> MemberAccessFuture<'_> {
        self.0.lock().unwrap().push(team_id);
        Box::pin(async { Ok(()) })
    }
}

fn member_service(
    repo: MockTeamRepository,
    listener: Arc<RecordingMemberAccessLost>,
) -> impl TeamService {
    TeamServiceImpl::new(
        repo,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_member_access_lost(listener)
}

fn team_with(
    team_id: uuid::Uuid,
    owner: &MacroUserIdStr<'_>,
    member: &MacroUserIdStr<'_>,
    role: TeamRole,
) -> MockTeamRepository {
    let mut repo = MockTeamRepository::new(Vec::new(), "Team", Arc::new(Mutex::new(Vec::new())))
        .with_team(Team::new(
            team_id,
            "Team".to_string(),
            "team".to_string(),
            owner.clone().into_owned(),
            false,
            false,
        ));
    repo.team_members = vec![make_team_member(team_id, member.as_ref(), role)];
    repo
}

fn role_change(member: &MacroUserIdStr<'_>, role: TeamRole) -> PatchTeamRequest {
    PatchTeamRequest {
        member_crm_access: None,
        name: None,
        slug: None,
        user_role_updates: Some(vec![PatchTeamUserRole {
            team_user_id: member.clone().into_owned(),
            role,
        }]),
        default_link_share: None,
        language: None,
    }
}

#[tokio::test]
async fn a_demoted_admin_is_reported_at_once() {
    let team_id = uuid::Uuid::from_u128(901);
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let admin = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let listener = Arc::new(RecordingMemberAccessLost::default());
    let service = member_service(
        team_with(team_id, &owner, &admin, TeamRole::Admin),
        listener.clone(),
    );

    service
        .patch_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner),
            &role_change(&admin, TeamRole::Member),
        )
        .await
        .unwrap();

    assert_eq!(listener.teams(), vec![team_id]);
}

#[tokio::test]
async fn a_promotion_reports_nothing() {
    let team_id = uuid::Uuid::from_u128(902);
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let listener = Arc::new(RecordingMemberAccessLost::default());
    let service = member_service(
        team_with(team_id, &owner, &member, TeamRole::Member),
        listener.clone(),
    );

    service
        .patch_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner),
            &role_change(&member, TeamRole::Admin),
        )
        .await
        .unwrap();

    assert!(listener.teams().is_empty());
}

#[tokio::test]
async fn a_removed_member_is_reported_at_once() {
    let team_id = uuid::Uuid::from_u128(903);
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let admin = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let mut repo = team_with(team_id, &owner, &admin, TeamRole::Admin);
    repo.removed_member = Some(TeamMember {
        team_id,
        user_id: admin.clone().into_owned(),
        role: TeamRole::Admin,
        plan: SeatPlan::Premium,
    });
    let listener = Arc::new(RecordingMemberAccessLost::default());
    let service = member_service(repo, listener.clone());

    service
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &admin)
        .await
        .unwrap();

    assert_eq!(listener.teams(), vec![team_id]);
}

/// Records whether the team's billing lock was free when it was told.
#[derive(Debug)]
struct BillingLockProbe {
    billing_lock: Arc<tokio::sync::Mutex<()>>,
    free: Mutex<Vec<bool>>,
}

impl MemberAccessLost for BillingLockProbe {
    fn member_access_lost(&self, _team_id: uuid::Uuid) -> MemberAccessFuture<'_> {
        Box::pin(async move {
            let free =
                tokio::time::timeout(std::time::Duration::from_secs(1), self.billing_lock.lock())
                    .await
                    .is_ok();
            self.free.lock().unwrap().push(free);
            Ok(())
        })
    }
}

#[tokio::test]
async fn a_removed_members_listener_runs_after_the_billing_lock_is_released() {
    let team_id = uuid::Uuid::from_u128(904);
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let admin = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let mut repo = team_with(team_id, &owner, &admin, TeamRole::Admin);
    repo.removed_member = Some(TeamMember {
        team_id,
        user_id: admin.clone().into_owned(),
        role: TeamRole::Admin,
        plan: SeatPlan::Premium,
    });
    let customers = MockCustomerRepository::default();
    let probe = Arc::new(BillingLockProbe {
        billing_lock: customers.billing_lock.clone(),
        free: Mutex::new(Vec::new()),
    });
    let service = TeamServiceImpl::new(
        repo,
        customers,
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_member_access_lost(probe.clone());

    service
        .remove_user_from_team(test_team_receipt::<AdminTeamRole>(team_id, &owner), &admin)
        .await
        .unwrap();

    // Parking the member's agents is slow; billing for the team mustn't
    // wait on it.
    assert_eq!(*probe.free.lock().unwrap(), [true]);
}
