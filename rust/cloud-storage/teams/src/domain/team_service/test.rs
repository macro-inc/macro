use std::{
    collections::HashSet,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, OwnerTeamRole, RequiredPermission,
};
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use notification::domain::{
    models::{Notification, NotificationResult, request::SendNotificationRequest},
    service::{NotificationIngress, SendNotificationError},
};
use roles_and_permissions::domain::{
    model::{PermissionId, RoleId, UserRolesAndPermissionsError},
    port::UserRolesAndPermissionsService,
};

use crate::domain::populate_crm_enqueuer::NoOpPopulateCrmEnqueuer;

fn test_team_receipt<T: RequiredPermission>(
    team_id: uuid::Uuid,
    user_id: &MacroUserIdStr<'_>,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user_id.clone().into_owned(),
        &team_id.to_string(),
        EntityType::Team,
    )
}

use super::*;
use crate::domain::{
    customer_repo::CustomerRepository,
    model::{
        AcceptedTeamInvite, CreateSubscriptionArgs, CustomerError, PatchTeamRequest,
        PatchTeamUserRole, RemoveTeamInviteError, RemoveUserFromTeamError, Team, TeamError,
        TeamInvite, TeamInviteDetails, TeamMember, TeamPlan, TeamRole, TeamWithMembers,
    },
    team_repo::{TeamChannelsRepository, TeamRepository},
};

// -- Mock TeamRepository --

#[derive(Clone)]
struct MockTeamRepository {
    invites_to_return: Vec<TeamInvite<'static>>,
    team_name: String,
    mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>>,
    team_for_get_by_id: Option<Team>,
    team_subscription_id: Option<stripe::SubscriptionId>,
    stripe_customer_id: Option<stripe::CustomerId>,
    accepted_invite: Option<AcceptedTeamInvite<'static>>,
    removed_member: Option<TeamMember<'static>>,
    rollback_accept_calls: Arc<Mutex<usize>>,
    rollback_remove_calls: Arc<Mutex<usize>>,
    fail_rollback_accept: bool,
    fail_rollback_remove: bool,
    patch_team_user_role_calls: Arc<Mutex<Vec<(uuid::Uuid, String, TeamRole)>>>,
    patch_team_name_calls: Arc<Mutex<Vec<(uuid::Uuid, Option<String>, Option<String>)>>>,
}

impl MockTeamRepository {
    fn new(
        invites: Vec<TeamInvite<'static>>,
        team_name: &str,
        mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>>,
    ) -> Self {
        Self {
            invites_to_return: invites,
            team_name: team_name.to_string(),
            mark_sent_calls,
            team_for_get_by_id: None,
            team_subscription_id: None,
            stripe_customer_id: None,
            accepted_invite: None,
            removed_member: None,
            rollback_accept_calls: Arc::new(Mutex::new(0)),
            rollback_remove_calls: Arc::new(Mutex::new(0)),
            fail_rollback_accept: false,
            fail_rollback_remove: false,
            patch_team_user_role_calls: Arc::new(Mutex::new(Vec::new())),
            patch_team_name_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn with_team(mut self, team: Team) -> Self {
        self.team_for_get_by_id = Some(team);
        self
    }
}

impl TeamRepository for MockTeamRepository {
    fn get_stripe_customer_id(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<stripe::CustomerId>, TeamError>> + Send {
        let customer_id = self.stripe_customer_id.clone();
        async move { Ok(customer_id) }
    }

    fn get_team_subscription_id(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<stripe::SubscriptionId>, TeamError>> + Send {
        let subscription_id = self.team_subscription_id.clone();
        async move { Ok(subscription_id) }
    }

    fn has_user_trialed(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send {
        async { Ok(false) }
    }

    fn create_team(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &str,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send {
        async { unimplemented!() }
    }

    fn invite_users_to_team(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
        _: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send {
        let invites = self.invites_to_return.clone();
        async move { Ok(invites) }
    }

    fn get_new_invites(
        &self,
        _: &uuid::Uuid,
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<Email<Lowercase<'static>>>, InviteUsersToTeamError>> + Send
    {
        let invites = invites
            .iter()
            .map(|email| {
                Email::parse_from_str(email.as_ref())
                    .expect("test emails should be valid")
                    .into_owned()
                    .lowercase()
            })
            .collect();
        async move { Ok(invites) }
    }

    fn mark_invites_sent(
        &self,
        invite_ids: &[uuid::Uuid],
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.mark_sent_calls
            .lock()
            .unwrap()
            .push(invite_ids.to_vec());
        async { Ok(()) }
    }

    fn remove_user_from_team(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'static>, RemoveUserFromTeamError>> + Send {
        let removed_member = self.removed_member.clone();
        async move { removed_member.ok_or(RemoveUserFromTeamError::UserNotInTeam) }
    }

    fn get_team_invite_by_id(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamInvite<'_>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn delete_team_invite(
        &self,
        _: &uuid::Uuid,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RemoveTeamInviteError>> + Send {
        async { unimplemented!() }
    }

    fn update_team_subscription(
        &self,
        _: &uuid::Uuid,
        _: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { Ok(()) }
    }

    fn delete_team(&self, _: &uuid::Uuid) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_all_team_members(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamMember<'_>>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn accept_team_invite(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AcceptedTeamInvite<'static>, TeamError>> + Send {
        let accepted_invite = self.accepted_invite.clone();
        async move { accepted_invite.ok_or(TeamError::TeamInviteDoesNotExist) }
    }

    fn rollback_accept_team_invite(
        &self,
        _: &AcceptedTeamInvite<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        *self.rollback_accept_calls.lock().unwrap() += 1;
        let fail = self.fail_rollback_accept;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "rollback failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn rollback_remove_user_from_team(
        &self,
        _: &TeamMember<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        *self.rollback_remove_calls.lock().unwrap() += 1;
        let fail = self.fail_rollback_remove;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "rollback failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn is_user_member_of_team(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_members(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamMember<'_>>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn bulk_is_member_of_other_team(
        &self,
        _: non_empty::NonEmpty<&[uuid::Uuid]>,
        _: non_empty::NonEmpty<&[MacroUserIdStr<'_>]>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'_>>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_by_id(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send {
        let team = self.team_for_get_by_id.clone();
        async move {
            let team = team.ok_or(TeamError::TeamDoesNotExist)?;
            Ok(TeamWithMembers {
                team,
                members: Vec::new(),
            })
        }
    }

    fn get_user_teams(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Team>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_user_team_invites(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_invites(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_name(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<String, TeamError>> + Send {
        let name = self.team_name.clone();
        async move { Ok(name) }
    }

    fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.patch_team_name_calls.lock().unwrap().push((
            *team_id,
            req.name.clone(),
            req.slug.clone(),
        ));
        async { Ok(()) }
    }

    fn get_team_role(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamRole>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_member(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'_>, TeamError>> + Send {
        async { unimplemented!() }
    }

    fn patch_team_user_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        role: TeamRole,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.patch_team_user_role_calls.lock().unwrap().push((
            *team_id,
            user_id.as_ref().to_string(),
            role,
        ));
        async { Ok(()) }
    }

    fn get_team_seat_count(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<i32, TeamError>> + Send {
        async { Ok(0) }
    }

    fn get_team_plan(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<TeamPlan>, TeamError>> + Send {
        async { Ok(None) }
    }

    fn patch_team_plan(
        &self,
        _: &uuid::Uuid,
        _: TeamPlan,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { unimplemented!() }
    }
}

// -- Mock CustomerRepository --

#[derive(Clone)]
struct MockCustomerRepository;

impl CustomerRepository for MockCustomerRepository {
    fn convert_subscription_to_team(
        &self,
        _: &stripe::SubscriptionId,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        async { unimplemented!() }
    }

    fn get_subscription_id_for_customer(
        &self,
        _: &stripe::CustomerId,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send {
        async { unimplemented!() }
    }

    fn create_subscription(
        &self,
        _: CreateSubscriptionArgs,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send {
        async { unimplemented!() }
    }

    fn cancel_subscription(
        &self,
        _: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        async { unimplemented!() }
    }

    fn update_team_plan(
        &self,
        _subscription_id: &stripe::SubscriptionId,
        _current_team_plan: Option<TeamPlan>,
        _team_plan: TeamPlan,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        async { unimplemented!() }
    }

    fn create_team_checkout_session(
        &self,
        _team_id: &uuid::Uuid,
        _customer_id: stripe::CustomerId,
        _req: &TeamCheckoutSessionRequest,
        _has_trialed: bool,
    ) -> impl Future<Output = Result<String, CustomerError>> + Send {
        async { unimplemented!() }
    }
}

// -- Mock TeamChannelsRepository --

#[derive(Clone)]
struct MockTeamChannelsRepository;

impl TeamChannelsRepository for MockTeamChannelsRepository {
    fn add_team_member_to_channels(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { unimplemented!() }
    }

    fn remove_team_member_from_channels(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { unimplemented!() }
    }
}

// -- Mock UserRolesAndPermissionsService --

#[derive(Clone)]
struct MockUserRolesAndPermissionsService;

impl UserRolesAndPermissionsService for MockUserRolesAndPermissionsService {
    fn get_user_roles(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<HashSet<RoleId>, UserRolesAndPermissionsError>> + Send {
        async { unimplemented!() }
    }

    fn get_user_permissions(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<HashSet<PermissionId>, UserRolesAndPermissionsError>> + Send
    {
        async { unimplemented!() }
    }

    fn update_user_roles_and_permissions_for_subscription(
        &self,
        _: Email<Lowercase<'_>>,
        _: roles_and_permissions::domain::model::SubscriptionStatus,
        _: roles_and_permissions::domain::model::ProductTier,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send {
        async { unimplemented!() }
    }

    fn dangerous_upsert_roles_for_user(
        &self,
        _: &MacroUserIdStr<'_>,
        _: non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send {
        async { unimplemented!() }
    }

    fn dangerous_remove_roles_from_user(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send {
        async { unimplemented!() }
    }
}

// -- Mock NotificationIngress --

/// A mock that fails on specific call indices (0-based).
/// For example, `fail_indices: {1}` means the second call will fail.
struct MockNotificationIngress {
    fail_indices: HashSet<usize>,
    call_count: AtomicUsize,
    /// Captured serialized snapshots of each request, in call order.
    recorded_requests: Mutex<Vec<serde_json::Value>>,
}

impl MockNotificationIngress {
    fn new(fail_indices: HashSet<usize>) -> Self {
        Self {
            fail_indices,
            call_count: AtomicUsize::new(0),
            recorded_requests: Mutex::new(Vec::new()),
        }
    }
}

impl NotificationIngress for MockNotificationIngress {
    fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> impl Future<
        Output = Result<Option<NotificationResult<'a>>, rootcause::Report<SendNotificationError>>,
    > + Send {
        let index = self.call_count.fetch_add(1, Ordering::SeqCst);
        let should_fail = self.fail_indices.contains(&index);
        let snapshot = serde_json::to_value(&req).unwrap();
        self.recorded_requests.lock().unwrap().push(snapshot);
        async move {
            if should_fail {
                Err(rootcause::Report::new(SendNotificationError::Other))
            } else {
                Ok(None)
            }
        }
    }
}

// -- Helpers --

fn make_invite(email: &str, invite_id: uuid::Uuid, team_id: uuid::Uuid) -> TeamInvite<'static> {
    TeamInvite {
        team_id,
        team_invite_id: invite_id,
        email: Email::parse_from_str(email)
            .unwrap()
            .into_owned()
            .lowercase(),
    }
}

fn build_service(
    invites: Vec<TeamInvite<'static>>,
    fail_indices: HashSet<usize>,
    mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>>,
) -> (impl TeamService, Arc<MockNotificationIngress>) {
    let team_repo = MockTeamRepository::new(invites, "Test Team", mark_sent_calls);
    let notification_ingress = Arc::new(MockNotificationIngress::new(fail_indices));
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository,
        MockTeamChannelsRepository,
        MockUserRolesAndPermissionsService,
        notification_ingress.clone(),
        NoOpPopulateCrmEnqueuer,
    );
    (service, notification_ingress)
}

// -- Tests --

/// When one notification fails, only the successful invite IDs are passed to
/// mark_invites_sent.
#[tokio::test]
async fn test_invite_marks_sent_only_for_successful_notifications() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id_1 = uuid::Uuid::from_u128(101);
    let invite_id_2 = uuid::Uuid::from_u128(102);
    let invite_id_3 = uuid::Uuid::from_u128(103);

    let invites = vec![
        make_invite("alice@example.com", invite_id_1, team_id),
        make_invite("bob@example.com", invite_id_2, team_id),
        make_invite("carol@example.com", invite_id_3, team_id),
    ];

    // The second notification (bob, index 1) will fail
    let fail_indices = HashSet::from([1]);
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let (service, _notification_ingress) =
        build_service(invites, fail_indices, mark_sent_calls.clone());

    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let invites = vec![
        Email::parse_from_str("alice@example.com")
            .unwrap()
            .lowercase(),
        Email::parse_from_str("bob@example.com")
            .unwrap()
            .lowercase(),
        Email::parse_from_str("carol@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice()).unwrap();

    let receipt = test_team_receipt::<OwnerTeamRole>(team_id, &invited_by);
    let result = service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    // All three invites should be returned regardless of notification success
    assert_eq!(result.len(), 3);

    // mark_invites_sent should be called once with only alice and carol's IDs
    let marks = mark_sent_calls.lock().unwrap();
    assert_eq!(marks.len(), 1);
    let marked_ids = &marks[0];
    assert_eq!(marked_ids.len(), 2);
    assert!(marked_ids.contains(&invite_id_1)); // alice succeeded
    assert!(!marked_ids.contains(&invite_id_2)); // bob failed
    assert!(marked_ids.contains(&invite_id_3)); // carol succeeded
}

/// When all notifications fail, mark_invites_sent is never called.
#[tokio::test]
async fn test_invite_does_not_call_mark_sent_when_all_notifications_fail() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id = uuid::Uuid::from_u128(201);

    let invites = vec![make_invite("fail@example.com", invite_id, team_id)];

    // The only notification (index 0) fails
    let fail_indices = HashSet::from([0]);
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let (service, _notification_ingress) =
        build_service(invites, fail_indices, mark_sent_calls.clone());

    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let invites = vec![
        Email::parse_from_str("fail@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice()).unwrap();

    let receipt = test_team_receipt::<OwnerTeamRole>(team_id, &invited_by);
    service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    // mark_invites_sent should NOT be called since all notifications failed
    assert!(mark_sent_calls.lock().unwrap().is_empty());
}

/// When all notifications succeed, all invite IDs are passed to mark_invites_sent.
#[tokio::test]
async fn test_invite_marks_all_sent_when_all_notifications_succeed() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id_1 = uuid::Uuid::from_u128(301);
    let invite_id_2 = uuid::Uuid::from_u128(302);

    let invites = vec![
        make_invite("one@example.com", invite_id_1, team_id),
        make_invite("two@example.com", invite_id_2, team_id),
    ];

    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let (service, _notification_ingress) = build_service(
        invites,
        HashSet::new(), // all succeed
        mark_sent_calls.clone(),
    );

    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let invites = vec![
        Email::parse_from_str("one@example.com")
            .unwrap()
            .lowercase(),
        Email::parse_from_str("two@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice()).unwrap();

    let receipt = test_team_receipt::<OwnerTeamRole>(team_id, &invited_by);
    service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    let marks = mark_sent_calls.lock().unwrap();
    assert_eq!(marks.len(), 1);
    let marked_ids = &marks[0];
    assert_eq!(marked_ids.len(), 2);
    assert!(marked_ids.contains(&invite_id_1));
    assert!(marked_ids.contains(&invite_id_2));
}

fn build_service_with_team(
    team: Team,
) -> (
    impl TeamService,
    Arc<Mutex<Vec<(uuid::Uuid, String, TeamRole)>>>,
    Arc<Mutex<Vec<(uuid::Uuid, Option<String>, Option<String>)>>>,
) {
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo =
        MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls).with_team(team);
    let role_calls = team_repo.patch_team_user_role_calls.clone();
    let name_calls = team_repo.patch_team_name_calls.clone();
    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository,
        MockTeamChannelsRepository,
        MockUserRolesAndPermissionsService,
        notification_ingress,
        NoOpPopulateCrmEnqueuer,
    );
    (service, role_calls, name_calls)
}

/// Attempting to assign the Owner role via patch_team is rejected.
#[tokio::test]
async fn test_patch_team_rejects_owner_role_assignment() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let team = Team::new(
        team_id,
        "Test Team".to_string(),
        "TEST_TEAM".to_string(),
        owner_id,
    );

    let (service, role_calls, name_calls) = build_service_with_team(team);

    let req = PatchTeamRequest {
        name: Some("New Name".to_string()),
        slug: Some("new-team".to_string()),
        user_role_updates: Some(vec![PatchTeamUserRole {
            team_user_id: MacroUserIdStr::parse_from_str("macro|member@example.com")
                .unwrap()
                .into_owned(),
            role: TeamRole::Owner,
        }]),
    };

    let receipt = test_team_receipt::<AdminTeamRole>(
        team_id,
        &MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
    );
    let err = service.patch_team(receipt, &req).await.err().unwrap();
    assert!(matches!(err, TeamError::BadRequest(_)));
    assert!(role_calls.lock().unwrap().is_empty());
    assert!(name_calls.lock().unwrap().is_empty());
}

/// Attempting to modify the team owner's role via patch_team is rejected.
#[tokio::test]
async fn test_patch_team_rejects_owner_downgrade() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let team = Team::new(
        team_id,
        "Test Team".to_string(),
        "TEST_TEAM".to_string(),
        owner_id.clone(),
    );

    let (service, role_calls, name_calls) = build_service_with_team(team);

    let req = PatchTeamRequest {
        name: None,
        slug: None,
        user_role_updates: Some(vec![PatchTeamUserRole {
            team_user_id: owner_id.clone(),
            role: TeamRole::Member,
        }]),
    };

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);
    let err = service.patch_team(receipt, &req).await.err().unwrap();
    assert!(matches!(err, TeamError::BadRequest(_)));
    assert!(role_calls.lock().unwrap().is_empty());
    assert!(name_calls.lock().unwrap().is_empty());
}

/// Valid role updates are applied and the team name is also updated.
#[tokio::test]
async fn test_patch_team_applies_role_updates_and_name() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com")
        .unwrap()
        .into_owned();
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .unwrap()
        .into_owned();
    let team = Team::new(
        team_id,
        "Old Name".to_string(),
        "OLD_NAME".to_string(),
        owner_id.clone(),
    );

    let (service, role_calls, name_calls) = build_service_with_team(team);

    let req = PatchTeamRequest {
        name: Some("New Name".to_string()),
        slug: Some("new-team slug".to_string()),
        user_role_updates: Some(vec![
            PatchTeamUserRole {
                team_user_id: member_id.clone(),
                role: TeamRole::Admin,
            },
            PatchTeamUserRole {
                team_user_id: admin_id.clone(),
                role: TeamRole::Member,
            },
        ]),
    };

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);
    service.patch_team(receipt, &req).await.unwrap();

    let role_calls = role_calls.lock().unwrap();
    assert_eq!(role_calls.len(), 2);
    assert_eq!(
        role_calls[0],
        (team_id, member_id.as_ref().to_string(), TeamRole::Admin)
    );
    assert_eq!(
        role_calls[1],
        (team_id, admin_id.as_ref().to_string(), TeamRole::Member)
    );

    let name_calls = name_calls.lock().unwrap();
    assert_eq!(name_calls.len(), 1);
    assert_eq!(
        name_calls[0],
        (
            team_id,
            Some("New Name".to_string()),
            Some("new-team slug".to_string())
        )
    );
}

/// Empty user_role_updates vec is a no-op for roles but still applies name.
#[tokio::test]
async fn test_patch_team_empty_role_updates() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let team = Team::new(
        team_id,
        "Old Name".to_string(),
        "OLD_NAME".to_string(),
        owner_id.clone(),
    );

    let (service, role_calls, name_calls) = build_service_with_team(team);

    let req = PatchTeamRequest {
        name: Some("New Name".to_string()),
        slug: None,
        user_role_updates: Some(Vec::new()),
    };

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);
    service.patch_team(receipt, &req).await.unwrap();

    assert!(role_calls.lock().unwrap().is_empty());
    let name_calls = name_calls.lock().unwrap();
    assert_eq!(name_calls.len(), 1);
    assert_eq!(name_calls[0], (team_id, Some("New Name".to_string()), None));
}
