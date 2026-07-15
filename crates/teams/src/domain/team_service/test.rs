use std::{
    collections::HashSet,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, MemberTeamRole, RequiredPermission,
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

use crate::domain::{
    crm_enqueuer::{CrmEnqueuer, NoOpCrmEnqueuer},
    team_analytics::{TeamAnalytics, TeamAnalyticsEvent},
    team_crm_settings_repo::NoOpTeamCrmSettingsRepository,
};

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
        AcceptedTeamInvite, CustomerError, PatchTeamRequest, PatchTeamUserRole,
        RemoveTeamInviteError, RemoveUserFromTeamError, Team, TeamError, TeamInvite,
        TeamInviteDetails, TeamInviteSnapshot, TeamMember, TeamPlan, TeamRole, TeamWithMembers,
        ToggleAutoJoinDomainError, TryJoinTeamByDomainError,
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
    team_subscription_id_lookup_calls: Arc<Mutex<usize>>,
    fail_team_subscription_id_lookup: bool,
    backfilled_subscription_id: Arc<Mutex<Option<stripe::SubscriptionId>>>,
    stripe_customer_id: Option<stripe::CustomerId>,
    stripe_customer_id_lookup_calls: Arc<Mutex<usize>>,
    team_payment_status: bool,
    team_payment_status_lookup_calls: Arc<Mutex<usize>>,
    fail_team_payment_status_lookup: bool,
    enterprise: bool,
    enterprise_status_lookup_calls: Arc<Mutex<usize>>,
    fail_enterprise_status_lookup: bool,
    team_members: Vec<TeamMember<'static>>,
    accepted_invite: Option<AcceptedTeamInvite<'static>>,
    removed_member: Option<TeamMember<'static>>,
    rollback_accept_calls: Arc<Mutex<usize>>,
    rollback_remove_calls: Arc<Mutex<usize>>,
    fail_rollback_accept: bool,
    fail_rollback_remove: bool,
    patch_team_user_role_calls: Arc<Mutex<Vec<(uuid::Uuid, String, TeamRole)>>>,
    patch_team_name_calls: Arc<Mutex<Vec<(uuid::Uuid, Option<String>, Option<String>)>>>,
    created_team: Team,
    github_installation_move_calls: Arc<Mutex<Vec<(String, uuid::Uuid)>>>,
    subscription_update_calls: Arc<Mutex<Vec<(uuid::Uuid, String)>>>,
    payment_update_calls: Arc<Mutex<Vec<(uuid::Uuid, bool)>>>,
    fail_github_installation_move: bool,
    fail_invite_users_to_team: bool,
    invite_users_to_team_calls: Arc<Mutex<usize>>,
    get_team_by_id_calls: Arc<Mutex<usize>>,
    team_id_for_domain: Option<uuid::Uuid>,
    team_plan: Option<TeamPlan>,
    seat_count: i32,
    add_user_to_team_result: Option<TeamMember<'static>>,
    add_user_to_team_calls: Arc<Mutex<usize>>,
    remove_user_calls: Arc<Mutex<usize>>,
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
            team_subscription_id_lookup_calls: Arc::new(Mutex::new(0)),
            fail_team_subscription_id_lookup: false,
            backfilled_subscription_id: Arc::new(Mutex::new(None)),
            stripe_customer_id: None,
            stripe_customer_id_lookup_calls: Arc::new(Mutex::new(0)),
            team_payment_status: true,
            team_payment_status_lookup_calls: Arc::new(Mutex::new(0)),
            fail_team_payment_status_lookup: false,
            enterprise: false,
            enterprise_status_lookup_calls: Arc::new(Mutex::new(0)),
            fail_enterprise_status_lookup: false,
            team_members: Vec::new(),
            accepted_invite: None,
            removed_member: None,
            rollback_accept_calls: Arc::new(Mutex::new(0)),
            rollback_remove_calls: Arc::new(Mutex::new(0)),
            fail_rollback_accept: false,
            fail_rollback_remove: false,
            patch_team_user_role_calls: Arc::new(Mutex::new(Vec::new())),
            patch_team_name_calls: Arc::new(Mutex::new(Vec::new())),
            created_team: Team::new(
                uuid::Uuid::from_u128(1000),
                "Created Team".to_string(),
                "CREATED_TEAM".to_string(),
                MacroUserIdStr::parse_from_str("macro|owner@example.com")
                    .unwrap()
                    .into_owned(),
                false,
                false,
            ),
            github_installation_move_calls: Arc::new(Mutex::new(Vec::new())),
            subscription_update_calls: Arc::new(Mutex::new(Vec::new())),
            payment_update_calls: Arc::new(Mutex::new(Vec::new())),
            fail_github_installation_move: false,
            fail_invite_users_to_team: false,
            invite_users_to_team_calls: Arc::new(Mutex::new(0)),
            get_team_by_id_calls: Arc::new(Mutex::new(0)),
            team_id_for_domain: None,
            team_plan: None,
            seat_count: 0,
            add_user_to_team_result: None,
            add_user_to_team_calls: Arc::new(Mutex::new(0)),
            remove_user_calls: Arc::new(Mutex::new(0)),
        }
    }

    fn with_team(mut self, team: Team) -> Self {
        self.team_for_get_by_id = Some(team);
        self
    }

    fn with_enterprise(mut self, enterprise: bool) -> Self {
        self.enterprise = enterprise;
        self
    }

    fn with_team_members(mut self, members: Vec<TeamMember<'static>>) -> Self {
        self.team_members = members;
        self
    }
}

impl TeamRepository for MockTeamRepository {
    fn get_stripe_customer_id(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<stripe::CustomerId>, TeamError>> + Send {
        *self.stripe_customer_id_lookup_calls.lock().unwrap() += 1;
        let customer_id = self.stripe_customer_id.clone();
        async move { Ok(customer_id) }
    }

    fn get_team_subscription_id(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<stripe::SubscriptionId>, TeamError>> + Send {
        *self.team_subscription_id_lookup_calls.lock().unwrap() += 1;
        let subscription_id = self
            .backfilled_subscription_id
            .lock()
            .unwrap()
            .clone()
            .or_else(|| self.team_subscription_id.clone());
        let fail = self.fail_team_subscription_id_lookup;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "team subscription id lookup failed"
                )))
            } else {
                Ok(subscription_id)
            }
        }
    }

    fn get_team_payment_status(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send {
        *self.team_payment_status_lookup_calls.lock().unwrap() += 1;
        let team_payment_status = self.team_payment_status;
        let fail = self.fail_team_payment_status_lookup;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "team payment status lookup failed"
                )))
            } else {
                Ok(team_payment_status)
            }
        }
    }

    fn get_team_enterprise_status(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send {
        *self.enterprise_status_lookup_calls.lock().unwrap() += 1;
        let enterprise = self.enterprise;
        let fail = self.fail_enterprise_status_lookup;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "enterprise status lookup failed"
                )))
            } else {
                Ok(enterprise)
            }
        }
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
        _: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send {
        let team = self.created_team.clone();
        async move { Ok(team) }
    }

    fn move_github_app_installation_to_team_if_exists(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), CreateTeamError>> + Send {
        self.github_installation_move_calls
            .lock()
            .unwrap()
            .push((user_id.as_ref().to_string(), *team_id));
        let fail = self.fail_github_installation_move;
        async move {
            if fail {
                Err(CreateTeamError::StorageLayerError(anyhow::anyhow!(
                    "github installation move failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn invite_users_to_team(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
        _: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send {
        *self.invite_users_to_team_calls.lock().unwrap() += 1;
        let invites = self.invites_to_return.clone();
        let fail = self.fail_invite_users_to_team;
        async move {
            if fail {
                Err(InviteUsersToTeamError::StorageLayerError(anyhow::anyhow!(
                    "invite failed"
                )))
            } else {
                Ok(invites)
            }
        }
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
        *self.remove_user_calls.lock().unwrap() += 1;
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
        team_id: &uuid::Uuid,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.subscription_update_calls
            .lock()
            .unwrap()
            .push((*team_id, subscription_id.to_string()));
        *self.backfilled_subscription_id.lock().unwrap() = Some(subscription_id.clone());
        async { Ok(()) }
    }

    fn update_team_payment_status(
        &self,
        team_id: &uuid::Uuid,
        paying: bool,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.payment_update_calls
            .lock()
            .unwrap()
            .push((*team_id, paying));
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
        let members = self.team_members.clone();
        async move { Ok(members) }
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
        *self.get_team_by_id_calls.lock().unwrap() += 1;
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
        let seat_count = self.seat_count;
        async move { Ok(seat_count) }
    }

    fn get_team_plan(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<TeamPlan>, TeamError>> + Send {
        let team_plan = self.team_plan;
        async move { Ok(team_plan) }
    }

    fn patch_team_plan(
        &self,
        _: &uuid::Uuid,
        _: TeamPlan,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        async { unimplemented!() }
    }

    fn toggle_auto_join_domain(
        &self,
        _: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<String>, ToggleAutoJoinDomainError>> + Send {
        async { unimplemented!() }
    }

    fn get_team_id_by_domain(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<uuid::Uuid>, TeamError>> + Send {
        let team_id = self.team_id_for_domain;
        async move { Ok(team_id) }
    }

    fn add_user_to_team(
        &self,
        _: &uuid::Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamMember<'static>>, TeamError>> + Send {
        *self.add_user_to_team_calls.lock().unwrap() += 1;
        let member = self.add_user_to_team_result.clone();
        async move { Ok(member) }
    }
}

// -- Mock CustomerRepository --

#[derive(Clone)]
struct MockCustomerRepository {
    subscription_id: stripe::SubscriptionId,
    increment_calls: Arc<Mutex<Vec<(String, u64)>>>,
    decrement_calls: Arc<Mutex<Vec<(String, u64)>>>,
    convert_calls: Arc<Mutex<Vec<(String, uuid::Uuid, String)>>>,
    subscription_lookup_calls: Arc<Mutex<usize>>,
    fail_increment: bool,
    fail_decrement: bool,
    no_active_subscription: bool,
}

impl Default for MockCustomerRepository {
    fn default() -> Self {
        Self {
            subscription_id: "sub_test".parse().unwrap(),
            increment_calls: Arc::new(Mutex::new(Vec::new())),
            decrement_calls: Arc::new(Mutex::new(Vec::new())),
            convert_calls: Arc::new(Mutex::new(Vec::new())),
            subscription_lookup_calls: Arc::new(Mutex::new(0)),
            fail_increment: false,
            fail_decrement: false,
            no_active_subscription: false,
        }
    }
}

impl CustomerRepository for MockCustomerRepository {
    fn convert_subscription_to_team(
        &self,
        subscription_id: &stripe::SubscriptionId,
        team_id: &uuid::Uuid,
        team_owner_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        self.convert_calls.lock().unwrap().push((
            subscription_id.to_string(),
            *team_id,
            team_owner_id.as_ref().to_string(),
        ));
        async { Ok(()) }
    }

    fn get_subscription_id_for_customer(
        &self,
        _: &stripe::CustomerId,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send {
        *self.subscription_lookup_calls.lock().unwrap() += 1;
        let no_active_subscription = self.no_active_subscription;
        let subscription_id = self.subscription_id.clone();
        async move {
            if no_active_subscription {
                Err(CustomerError::SubscriptionNotActive)
            } else {
                Ok(subscription_id)
            }
        }
    }

    fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        self.increment_calls
            .lock()
            .unwrap()
            .push((subscription_id.to_string(), amount));
        let fail = self.fail_increment;
        async move {
            if fail {
                Err(CustomerError::StorageLayerError(anyhow::anyhow!(
                    "increment failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        self.decrement_calls
            .lock()
            .unwrap()
            .push((subscription_id.to_string(), amount));
        let fail = self.fail_decrement;
        async move {
            if fail {
                Err(CustomerError::StorageLayerError(anyhow::anyhow!(
                    "decrement failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn cancel_subscription(
        &self,
        _: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send {
        async { unimplemented!() }
    }
}

// -- Mock TeamChannelsRepository --

#[derive(Clone, Default)]
struct MockTeamChannelsRepository {
    add_calls: Arc<Mutex<Vec<(uuid::Uuid, String)>>>,
    remove_calls: Arc<Mutex<Vec<(uuid::Uuid, String)>>>,
    fail_add: bool,
    fail_remove: bool,
}

impl TeamChannelsRepository for MockTeamChannelsRepository {
    fn add_team_member_to_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.add_calls
            .lock()
            .unwrap()
            .push((*team_id, user_id.as_ref().to_string()));
        let fail = self.fail_add;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "add channels failed"
                )))
            } else {
                Ok(())
            }
        }
    }

    fn remove_team_member_from_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send {
        self.remove_calls
            .lock()
            .unwrap()
            .push((*team_id, user_id.as_ref().to_string()));
        let fail = self.fail_remove;
        async move {
            if fail {
                Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "remove channels failed"
                )))
            } else {
                Ok(())
            }
        }
    }
}

// -- Mock UserRolesAndPermissionsService --

#[derive(Clone, Default)]
struct MockUserRolesAndPermissionsService {
    upsert_calls: Arc<Mutex<Vec<(String, Vec<RoleId>)>>>,
    remove_calls: Arc<Mutex<Vec<(String, Vec<RoleId>)>>>,
    fail_upsert: bool,
    fail_remove: bool,
}

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
        user_id: &MacroUserIdStr<'_>,
        role_ids: non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send {
        self.upsert_calls
            .lock()
            .unwrap()
            .push((user_id.as_ref().to_string(), role_ids.inner().to_vec()));
        let fail = self.fail_upsert;
        async move {
            if fail {
                Err(UserRolesAndPermissionsError::StorageLayerError(
                    anyhow::anyhow!("upsert roles failed"),
                ))
            } else {
                Ok(())
            }
        }
    }

    fn dangerous_remove_roles_from_user(
        &self,
        user_id: &MacroUserIdStr<'_>,
        role_ids: &non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send {
        self.remove_calls
            .lock()
            .unwrap()
            .push((user_id.as_ref().to_string(), role_ids.inner().to_vec()));
        let fail = self.fail_remove;
        async move {
            if fail {
                Err(UserRolesAndPermissionsError::StorageLayerError(
                    anyhow::anyhow!("remove roles failed"),
                ))
            } else {
                Ok(())
            }
        }
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

// -- Mock TeamAnalytics --

#[derive(Clone)]
struct MockTeamAnalytics {
    events: Arc<Mutex<Vec<TeamAnalyticsEvent>>>,
    fail: bool,
}

impl MockTeamAnalytics {
    fn new(events: Arc<Mutex<Vec<TeamAnalyticsEvent>>>) -> Self {
        Self {
            events,
            fail: false,
        }
    }

    fn failing(events: Arc<Mutex<Vec<TeamAnalyticsEvent>>>) -> Self {
        Self { events, fail: true }
    }
}

impl TeamAnalytics for MockTeamAnalytics {
    type Err = String;

    fn track_team_event(
        &self,
        event: TeamAnalyticsEvent,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send {
        self.events.lock().unwrap().push(event);
        let fail = self.fail;
        async move {
            if fail {
                Err("analytics failed".to_string())
            } else {
                Ok(())
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

fn make_team_member(team_id: uuid::Uuid, user_id: &str, role: TeamRole) -> TeamMember<'static> {
    TeamMember {
        team_id,
        user_id: MacroUserIdStr::parse_from_str(user_id)
            .unwrap()
            .into_owned(),
        role,
    }
}

fn make_accepted_invite(
    team_id: uuid::Uuid,
    invite_id: uuid::Uuid,
    user_id: &MacroUserIdStr<'_>,
) -> AcceptedTeamInvite<'static> {
    AcceptedTeamInvite {
        member: TeamMember {
            team_id,
            user_id: user_id.clone().into_owned(),
            role: TeamRole::Member,
        },
        invite: TeamInviteSnapshot {
            id: invite_id,
            team_id,
            email: Email::parse_from_str(user_id.email_part().as_ref())
                .unwrap()
                .into_owned()
                .lowercase(),
            team_role: TeamRole::Member,
            invited_by: MacroUserIdStr::parse_from_str("macro|owner@example.com")
                .unwrap()
                .into_owned(),
            created_at: chrono::Utc::now(),
            last_sent_at: chrono::Utc::now(),
        },
    }
}

fn make_enterprise_join_team_repository(
    team_id: uuid::Uuid,
    invite_id: uuid::Uuid,
    user_id: &MacroUserIdStr<'_>,
) -> MockTeamRepository {
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Enterprise Team", mark_sent_calls)
            .with_enterprise(true);
    team_repository.team_payment_status = false;
    team_repository.team_subscription_id = Some("sub_enterprise_sentinel".parse().unwrap());
    team_repository.accepted_invite = Some(make_accepted_invite(team_id, invite_id, user_id));
    team_repository
}

fn make_enterprise_domain_join_team_repository(
    team_id: uuid::Uuid,
    user_id: &MacroUserIdStr<'_>,
) -> MockTeamRepository {
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let member = TeamMember {
        team_id,
        user_id: user_id.clone().into_owned(),
        role: TeamRole::Member,
    };
    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Enterprise Team", mark_sent_calls)
            .with_enterprise(true);
    team_repository.team_id_for_domain = Some(team_id);
    team_repository.team_payment_status = false;
    team_repository.team_subscription_id = Some("sub_enterprise_sentinel".parse().unwrap());
    team_repository.stripe_customer_id = Some("cus_enterprise_sentinel".parse().unwrap());
    team_repository.add_user_to_team_result = Some(member.clone());
    team_repository.removed_member = Some(member);
    team_repository
}

fn make_enterprise_remove_user_repository(
    team_id: uuid::Uuid,
    user_id: &MacroUserIdStr<'_>,
    role: TeamRole,
) -> MockTeamRepository {
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let team = Team::new(
        team_id,
        "Enterprise Team".to_string(),
        "ENTERPRISE_TEAM".to_string(),
        owner_id.into_owned(),
        false,
        true,
    );
    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Enterprise Team", mark_sent_calls)
            .with_enterprise(true)
            .with_team(team);
    team_repository.team_payment_status = false;
    team_repository.stripe_customer_id = Some("cus_enterprise_sentinel".parse().unwrap());
    team_repository.removed_member = Some(TeamMember {
        team_id,
        user_id: user_id.clone().into_owned(),
        role,
    });
    team_repository
}

fn assert_no_enterprise_join_team_billing_calls(
    team_repository: &MockTeamRepository,
    customer_repository: &MockCustomerRepository,
) {
    assert_eq!(
        *team_repository
            .team_payment_status_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert_eq!(
        *team_repository
            .team_subscription_id_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert_eq!(
        *team_repository
            .stripe_customer_id_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert!(
        team_repository
            .subscription_update_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        team_repository
            .payment_update_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        *customer_repository
            .subscription_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert!(customer_repository.convert_calls.lock().unwrap().is_empty());
    assert!(
        customer_repository
            .increment_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        customer_repository
            .decrement_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

fn assert_no_enterprise_remove_user_billing_calls(
    team_repository: &MockTeamRepository,
    customer_repository: &MockCustomerRepository,
) {
    assert_no_enterprise_join_team_billing_calls(team_repository, customer_repository);
    assert_eq!(*team_repository.get_team_by_id_calls.lock().unwrap(), 0);
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
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress.clone(),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );
    (service, notification_ingress)
}

fn build_service_with_analytics(
    team_repo: MockTeamRepository,
    customer_repo: MockCustomerRepository,
    channels_repo: MockTeamChannelsRepository,
    roles_service: MockUserRolesAndPermissionsService,
    team_analytics: MockTeamAnalytics,
) -> impl TeamService {
    TeamServiceImpl::new_with_analytics(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
        team_analytics,
    )
}

// -- Tests --

#[tokio::test]
async fn team_payment_revoke_removes_exact_premium_roles_from_members() {
    let team_id = uuid::Uuid::from_u128(5000);
    let members = vec![
        make_team_member(team_id, "macro|member-one@example.com", TeamRole::Member),
        make_team_member(team_id, "macro|member-two@example.com", TeamRole::Admin),
    ];
    let expected_roles = vec![RoleId::TeamSubscriber, RoleId::SubOpus];
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls)
        .with_team_members(members);
    let roles_service = MockUserRolesAndPermissionsService::default();
    let remove_role_calls = roles_service.remove_calls.clone();
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .revoke_permissions_for_team_members(&team_id)
        .await
        .unwrap();

    assert_eq!(
        *remove_role_calls.lock().unwrap(),
        vec![
            (
                "macro|member-one@example.com".to_string(),
                expected_roles.clone(),
            ),
            ("macro|member-two@example.com".to_string(), expected_roles),
        ]
    );
}

#[tokio::test]
async fn team_payment_restore_adds_exact_premium_roles_to_members() {
    let team_id = uuid::Uuid::from_u128(5001);
    let members = vec![
        make_team_member(team_id, "macro|member-one@example.com", TeamRole::Member),
        make_team_member(team_id, "macro|member-two@example.com", TeamRole::Admin),
    ];
    let expected_roles = vec![RoleId::TeamSubscriber, RoleId::SubOpus];
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls)
        .with_team_members(members);
    let roles_service = MockUserRolesAndPermissionsService::default();
    let upsert_role_calls = roles_service.upsert_calls.clone();
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .restore_permissions_for_team_members(&team_id)
        .await
        .unwrap();

    assert_eq!(
        *upsert_role_calls.lock().unwrap(),
        vec![
            (
                "macro|member-one@example.com".to_string(),
                expected_roles.clone(),
            ),
            ("macro|member-two@example.com".to_string(), expected_roles),
        ]
    );
}

#[tokio::test]
async fn team_payment_patch_payment_status_delegates_to_repository() {
    let team_id = uuid::Uuid::from_u128(5002);
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    let payment_update_calls = team_repo.payment_update_calls.clone();
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .patch_team_payment_status(&team_id, false)
        .await
        .unwrap();
    service
        .patch_team_payment_status(&team_id, true)
        .await
        .unwrap();

    assert_eq!(
        *payment_update_calls.lock().unwrap(),
        vec![(team_id, false), (team_id, true)]
    );
}

#[tokio::test]
async fn test_create_team_moves_github_installation_to_created_team() {
    let user_id = MacroUserIdStr::parse_from_str("macro|creator@example.com").unwrap();
    let team = Team::new(
        uuid::Uuid::from_u128(2000),
        "New Team".to_string(),
        "NEW_TEAM".to_string(),
        user_id.clone().into_owned(),
        false,
        false,
    );
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.created_team = team.clone();
    let move_calls = team_repo.github_installation_move_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let created_team = service
        .create_team(&user_id, "New Team", &"sub_test".parse().unwrap())
        .await
        .unwrap();

    assert_eq!(created_team.id(), team.id());
    assert_eq!(
        *move_calls.lock().unwrap(),
        vec![(user_id.as_ref().to_string(), *team.id())]
    );
}

#[tokio::test]
async fn test_create_team_propagates_github_installation_move_failure() {
    let user_id = MacroUserIdStr::parse_from_str("macro|creator@example.com").unwrap();
    let team = Team::new(
        uuid::Uuid::from_u128(2001),
        "New Team".to_string(),
        "NEW_TEAM".to_string(),
        user_id.clone().into_owned(),
        false,
        false,
    );
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.created_team = team.clone();
    team_repo.fail_github_installation_move = true;
    let move_calls = team_repo.github_installation_move_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service
        .create_team(&user_id, "New Team", &"sub_test".parse().unwrap())
        .await
        .err()
        .unwrap();

    assert!(matches!(err, CreateTeamError::StorageLayerError(_)));
    assert_eq!(
        *move_calls.lock().unwrap(),
        vec![(user_id.as_ref().to_string(), *team.id())]
    );
}

#[tokio::test]
async fn team_analytics_create_team_emits_created_event_with_team_id() {
    let user_id = MacroUserIdStr::parse_from_str("macro|creator@example.com").unwrap();
    let team_id = uuid::Uuid::from_u128(2100);
    let team = Team::new(
        team_id,
        "Analytics Team".to_string(),
        "ANALYTICS_TEAM".to_string(),
        user_id.clone().into_owned(),
        false,
        false,
    );
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.created_team = team;

    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    service
        .create_team(&user_id, "Analytics Team", &"sub_test".parse().unwrap())
        .await
        .unwrap();

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        TeamAnalyticsEvent::TeamCreated {
            team_id: event_team_id,
            owner_id,
            team_name,
        } => {
            assert_eq!(*event_team_id, team_id);
            assert_eq!(owner_id.as_ref(), user_id.as_ref());
            assert_eq!(team_name, "Analytics Team");
        }
        event => panic!("unexpected event: {event:?}"),
    }
}

#[tokio::test]
async fn team_analytics_failure_is_swallowed_by_create_team() {
    let user_id = MacroUserIdStr::parse_from_str("macro|creator@example.com").unwrap();
    let team_id = uuid::Uuid::from_u128(2101);
    let team = Team::new(
        team_id,
        "Analytics Team".to_string(),
        "ANALYTICS_TEAM".to_string(),
        user_id.clone().into_owned(),
        false,
        false,
    );
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.created_team = team;

    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::failing(events.clone()),
    );

    let result = service
        .create_team(&user_id, "Analytics Team", &"sub_test".parse().unwrap())
        .await;

    assert!(result.is_ok());
    assert_eq!(events.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn team_analytics_create_team_does_not_emit_when_side_effect_fails() {
    let user_id = MacroUserIdStr::parse_from_str("macro|creator@example.com").unwrap();
    let team = Team::new(
        uuid::Uuid::from_u128(2102),
        "Analytics Team".to_string(),
        "ANALYTICS_TEAM".to_string(),
        user_id.clone().into_owned(),
        false,
        false,
    );
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.created_team = team;
    team_repo.fail_github_installation_move = true;

    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    let err = service
        .create_team(&user_id, "Analytics Team", &"sub_test".parse().unwrap())
        .await
        .err()
        .unwrap();

    assert!(matches!(err, CreateTeamError::StorageLayerError(_)));
    assert!(events.lock().unwrap().is_empty());
}

fn build_service_for_premium_check(
    stripe_customer_id: Option<stripe::CustomerId>,
    no_active_subscription: bool,
) -> impl TeamService {
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.stripe_customer_id = stripe_customer_id;
    TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository {
            no_active_subscription,
            ..Default::default()
        },
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
}

#[tokio::test]
async fn test_is_user_premium_with_active_subscription() {
    let user_id = MacroUserIdStr::parse_from_str("macro|premium@example.com").unwrap();
    let service = build_service_for_premium_check(Some("cus_test".parse().unwrap()), false);

    assert!(service.is_user_premium(&user_id).await.unwrap().is_some());
}

#[tokio::test]
async fn test_is_user_premium_without_stripe_customer() {
    let user_id = MacroUserIdStr::parse_from_str("macro|free@example.com").unwrap();
    let service = build_service_for_premium_check(None, false);

    assert!(service.is_user_premium(&user_id).await.unwrap().is_none());
}

#[tokio::test]
async fn test_is_user_premium_without_active_subscription() {
    let user_id = MacroUserIdStr::parse_from_str("macro|lapsed@example.com").unwrap();
    let service = build_service_for_premium_check(Some("cus_test".parse().unwrap()), true);

    assert!(service.is_user_premium(&user_id).await.unwrap().is_none());
}

#[tokio::test]
async fn invite_users_to_team_enterprise_bypasses_billing_and_preserves_side_effects() {
    let team_id = uuid::Uuid::from_u128(6000);
    let invite_id = uuid::Uuid::from_u128(6001);
    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(
        vec![make_invite("member@example.com", invite_id, team_id)],
        "Enterprise Team",
        mark_sent_calls.clone(),
    )
    .with_enterprise(true);
    team_repo.team_payment_status = false;
    team_repo.team_subscription_id = Some("sub_enterprise_sentinel".parse().unwrap());
    team_repo.stripe_customer_id = Some("cus_enterprise_sentinel".parse().unwrap());
    team_repo.team_plan = Some(TeamPlan::Idea);
    team_repo.seat_count = TeamPlan::Idea.seat_cap() - 1;

    let enterprise_status_lookup_calls = team_repo.enterprise_status_lookup_calls.clone();
    let payment_status_lookup_calls = team_repo.team_payment_status_lookup_calls.clone();
    let subscription_id_lookup_calls = team_repo.team_subscription_id_lookup_calls.clone();
    let stripe_customer_id_lookup_calls = team_repo.stripe_customer_id_lookup_calls.clone();
    let get_team_by_id_calls = team_repo.get_team_by_id_calls.clone();
    let invitation_persistence_calls = team_repo.invite_users_to_team_calls.clone();
    let subscription_update_calls = team_repo.subscription_update_calls.clone();
    let payment_update_calls = team_repo.payment_update_calls.clone();

    let customer_repo = MockCustomerRepository::default();
    let customer_subscription_lookup_calls = customer_repo.subscription_lookup_calls.clone();
    let convert_calls = customer_repo.convert_calls.clone();
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();
    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let analytics_events = Arc::new(Mutex::new(Vec::new()));
    let service = TeamServiceImpl::new_with_analytics(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress.clone(),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(analytics_events.clone()),
    );

    let invite_emails = vec![
        Email::parse_from_str("member@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invite_emails.as_slice()).unwrap();
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);

    let result = service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].team_invite_id, invite_id);
    assert_eq!(*enterprise_status_lookup_calls.lock().unwrap(), 1);
    assert_eq!(*payment_status_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*subscription_id_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*stripe_customer_id_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*get_team_by_id_calls.lock().unwrap(), 0);
    assert_eq!(*customer_subscription_lookup_calls.lock().unwrap(), 0);
    assert!(convert_calls.lock().unwrap().is_empty());
    assert!(subscription_update_calls.lock().unwrap().is_empty());
    assert!(payment_update_calls.lock().unwrap().is_empty());
    assert!(increment_calls.lock().unwrap().is_empty());
    assert!(decrement_calls.lock().unwrap().is_empty());

    assert_eq!(*invitation_persistence_calls.lock().unwrap(), 1);
    assert_eq!(notification_ingress.call_count.load(Ordering::SeqCst), 1);
    assert_eq!(*mark_sent_calls.lock().unwrap(), vec![vec![invite_id]]);

    let events = analytics_events.lock().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        TeamAnalyticsEvent::TeamInvited {
            team_id: event_team_id,
            team_invite_id,
            inviter_id,
            team_name,
        } => {
            assert_eq!(*event_team_id, team_id);
            assert_eq!(*team_invite_id, invite_id);
            assert_eq!(inviter_id.as_ref(), invited_by.as_ref());
            assert_eq!(team_name.as_deref(), Some("Enterprise Team"));
        }
        event => panic!("unexpected event: {event:?}"),
    }
}

#[tokio::test]
async fn invite_users_to_team_enterprise_enforces_team_plan_seat_cap() {
    let team_id = uuid::Uuid::from_u128(6010);
    let invite_id = uuid::Uuid::from_u128(6011);
    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(
        vec![make_invite("member@example.com", invite_id, team_id)],
        "Enterprise Team",
        mark_sent_calls.clone(),
    )
    .with_enterprise(true);
    team_repo.team_payment_status = false;
    team_repo.team_subscription_id = Some("sub_enterprise_sentinel".parse().unwrap());
    team_repo.team_plan = Some(TeamPlan::Idea);
    team_repo.seat_count = TeamPlan::Idea.seat_cap();

    let payment_status_lookup_calls = team_repo.team_payment_status_lookup_calls.clone();
    let subscription_id_lookup_calls = team_repo.team_subscription_id_lookup_calls.clone();
    let invitation_persistence_calls = team_repo.invite_users_to_team_calls.clone();
    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let analytics_events = Arc::new(Mutex::new(Vec::new()));
    let service = TeamServiceImpl::new_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress.clone(),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(analytics_events.clone()),
    );

    let invite_emails = vec![
        Email::parse_from_str("member@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invite_emails.as_slice()).unwrap();
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);

    let error = service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap_err();

    assert!(matches!(error, InviteUsersToTeamError::NotEnoughOpenSeats));
    assert_eq!(*payment_status_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*subscription_id_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*invitation_persistence_calls.lock().unwrap(), 0);
    assert_eq!(notification_ingress.call_count.load(Ordering::SeqCst), 0);
    assert!(mark_sent_calls.lock().unwrap().is_empty());
    assert!(analytics_events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invite_users_to_team_enterprise_status_lookup_failure_precedes_persistence() {
    let team_id = uuid::Uuid::from_u128(6020);
    let invite_id = uuid::Uuid::from_u128(6021);
    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let mark_sent_calls = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(
        vec![make_invite("member@example.com", invite_id, team_id)],
        "Enterprise Team",
        mark_sent_calls,
    );
    team_repo.fail_enterprise_status_lookup = true;

    let enterprise_status_lookup_calls = team_repo.enterprise_status_lookup_calls.clone();
    let payment_status_lookup_calls = team_repo.team_payment_status_lookup_calls.clone();
    let invitation_persistence_calls = team_repo.invite_users_to_team_calls.clone();
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let invite_emails = vec![
        Email::parse_from_str("member@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invite_emails.as_slice()).unwrap();
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);

    let error = service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        InviteUsersToTeamError::TeamError(TeamError::StorageLayerError(_))
    ));
    assert_eq!(*enterprise_status_lookup_calls.lock().unwrap(), 1);
    assert_eq!(*payment_status_lookup_calls.lock().unwrap(), 0);
    assert_eq!(*invitation_persistence_calls.lock().unwrap(), 0);
}

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

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);
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

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);
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

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);
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

#[tokio::test]
async fn team_analytics_invite_users_emits_invited_events_with_team_id() {
    let team_id = uuid::Uuid::from_u128(310);
    let invite_id_1 = uuid::Uuid::from_u128(311);
    let invite_id_2 = uuid::Uuid::from_u128(312);
    let invites_to_return = vec![
        make_invite("one@example.com", invite_id_1, team_id),
        make_invite("two@example.com", invite_id_2, team_id),
    ];
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo = MockTeamRepository::new(invites_to_return, "Test Team", mark_sent_calls);
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
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
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);

    service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 2);
    for (event, expected_invite_id) in events.iter().zip([invite_id_1, invite_id_2]) {
        match event {
            TeamAnalyticsEvent::TeamInvited {
                team_id: event_team_id,
                team_invite_id,
                inviter_id,
                team_name,
            } => {
                assert_eq!(*event_team_id, team_id);
                assert_eq!(*team_invite_id, expected_invite_id);
                assert_eq!(inviter_id.as_ref(), invited_by.as_ref());
                assert_eq!(team_name.as_deref(), Some("Test Team"));
            }
            event => panic!("unexpected event: {event:?}"),
        }
    }
}

#[tokio::test]
async fn team_analytics_invite_users_does_not_emit_when_invite_creation_fails() {
    let team_id = uuid::Uuid::from_u128(313);
    let invite_id = uuid::Uuid::from_u128(314);
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(
        vec![make_invite("one@example.com", invite_id, team_id)],
        "Test Team",
        mark_sent_calls,
    );
    team_repo.fail_invite_users_to_team = true;
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    let invited_by = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let invites = vec![
        Email::parse_from_str("one@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice()).unwrap();
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &invited_by);

    let err = service
        .invite_users_to_team(receipt, invites)
        .await
        .err()
        .unwrap();

    assert!(matches!(err, InviteUsersToTeamError::StorageLayerError(_)));
    assert!(events.lock().unwrap().is_empty());
}

/// get_team reports the `crm_enabled` flag stored on the team row.
#[tokio::test]
async fn test_get_team_reports_crm_enabled() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let team = Team::new(
        team_id,
        "Test Team".to_string(),
        "TEST_TEAM".to_string(),
        owner_id.clone(),
        true,
        false,
    );

    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo =
        MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls).with_team(team);
    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress,
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let receipt = test_team_receipt::<MemberTeamRole>(team_id, &owner_id);
    let team = service.get_team(receipt).await.unwrap();
    assert!(team.team.crm_enabled());
}

/// CrmEnqueuer that records which users had a populate or depopulate enqueued.
#[derive(Clone, Default)]
struct RecordingCrmEnqueuer {
    populated: Arc<Mutex<Vec<String>>>,
    depopulated: Arc<Mutex<Vec<(uuid::Uuid, String)>>>,
}

impl CrmEnqueuer for RecordingCrmEnqueuer {
    type Err = std::convert::Infallible;

    async fn enqueue_populate_crm_for_user(
        &self,
        macro_id: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        self.populated
            .lock()
            .unwrap()
            .push(macro_id.as_ref().to_string());
        Ok(())
    }

    async fn enqueue_depopulate_crm_for_user(
        &self,
        team_id: &uuid::Uuid,
        macro_id: &MacroUserIdStr<'_>,
    ) -> Result<(), Self::Err> {
        self.depopulated
            .lock()
            .unwrap()
            .push((*team_id, macro_id.as_ref().to_string()));
        Ok(())
    }
}

fn build_crm_enable_service(
    team_id: uuid::Uuid,
    member_ids: &[&str],
) -> (impl TeamService, Arc<Mutex<Vec<String>>>) {
    let members = member_ids
        .iter()
        .map(|id| TeamMember {
            team_id,
            user_id: MacroUserIdStr::parse_from_str(id).unwrap().into_owned(),
            role: TeamRole::Member,
        })
        .collect();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls)
        .with_team_members(members);
    let enqueuer = RecordingCrmEnqueuer::default();
    let populated = enqueuer.populated.clone();
    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let service = TeamServiceImpl::new(
        team_repo,
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress,
        enqueuer,
        // NoOp reports every enable_crm call as a fresh false → true flip.
        NoOpTeamCrmSettingsRepository,
    );
    (service, populated)
}

/// Enabling with backfill enqueues a populate per team member.
#[tokio::test]
async fn test_enable_crm_with_backfill_enqueues_members() {
    let team_id = uuid::Uuid::from_u128(7);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let (service, populated) = build_crm_enable_service(
        team_id,
        &["macro|owner@example.com", "macro|member@example.com"],
    );

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);
    let response = service
        .set_team_crm_enabled(receipt, true, true)
        .await
        .unwrap();

    assert!(response.enabled);
    assert!(response.changed);
    assert_eq!(response.backfill_enqueued, 2);
    assert_eq!(response.backfill_failed, 0);
    assert_eq!(
        *populated.lock().unwrap(),
        vec![
            "macro|owner@example.com".to_string(),
            "macro|member@example.com".to_string()
        ]
    );
}

/// Enabling without backfill flips the flag but enqueues nothing.
#[tokio::test]
async fn test_enable_crm_without_backfill_skips_enqueue() {
    let team_id = uuid::Uuid::from_u128(7);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let (service, populated) = build_crm_enable_service(
        team_id,
        &["macro|owner@example.com", "macro|member@example.com"],
    );

    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);
    let response = service
        .set_team_crm_enabled(receipt, true, false)
        .await
        .unwrap();

    assert!(response.enabled);
    assert!(response.changed);
    assert_eq!(response.backfill_enqueued, 0);
    assert_eq!(response.backfill_failed, 0);
    assert!(populated.lock().unwrap().is_empty());
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
        MockCustomerRepository::default(),
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress,
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
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
        false,
        false,
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
        false,
        false,
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
        false,
        false,
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
        false,
        false,
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

#[tokio::test]
async fn test_invite_users_to_team_backfills_legacy_team_subscription() {
    let team_id = uuid::Uuid::from_u128(42);
    let invite_id = uuid::Uuid::from_u128(420);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_backfill_invite".parse().unwrap();

    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(
        vec![make_invite("alice@example.com", invite_id, team_id)],
        "Legacy Team",
        mark_sent_calls,
    )
    .with_team(Team::new(
        team_id,
        "Legacy Team".to_string(),
        "legacy-team".to_string(),
        owner_id.clone().into_owned(),
        false,
        false,
    ));
    team_repo.team_payment_status = false;
    team_repo.team_subscription_id = None;
    team_repo.stripe_customer_id = Some("cus_backfill_invite".parse().unwrap());
    let subscription_update_calls = team_repo.subscription_update_calls.clone();
    let payment_update_calls = team_repo.payment_update_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let convert_calls = customer_repo.convert_calls.clone();

    let notification_ingress = Arc::new(MockNotificationIngress::new(HashSet::new()));
    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        notification_ingress,
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let invites = vec![
        Email::parse_from_str("alice@example.com")
            .unwrap()
            .lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice()).unwrap();
    let receipt = test_team_receipt::<AdminTeamRole>(team_id, &owner_id);

    service
        .invite_users_to_team(receipt, invites)
        .await
        .unwrap();

    assert_eq!(
        *convert_calls.lock().unwrap(),
        vec![(
            (subscription_id.to_string()),
            team_id,
            owner_id.as_ref().to_string()
        )]
    );
    assert_eq!(
        *subscription_update_calls.lock().unwrap(),
        vec![(team_id, subscription_id.to_string())]
    );
    assert_eq!(*payment_update_calls.lock().unwrap(), vec![(team_id, true)]);
}

#[tokio::test]
async fn join_team_enterprise_bypasses_billing_and_preserves_membership_side_effects() {
    let team_id = uuid::Uuid::from_u128(45);
    let invite_id = uuid::Uuid::from_u128(450);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_join_team_repository(team_id, invite_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let member = service.join_team(&invite_id, &user_id).await.unwrap();

    assert_eq!(member.team_id, team_id);
    assert_eq!(member.user_id, user_id);
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.rollback_accept_calls.lock().unwrap(), 0);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(
        *roles_service.upsert_calls.lock().unwrap(),
        vec![(
            user_id.as_ref().to_string(),
            vec![RoleId::TeamSubscriber, RoleId::SubOpus]
        )]
    );
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert_eq!(
        *channels_repository.add_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert!(channels_repository.remove_calls.lock().unwrap().is_empty());
    assert_eq!(
        *crm_enqueuer.populated.lock().unwrap(),
        vec![user_id.as_ref().to_string()]
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec![TeamAnalyticsEvent::TeamJoined {
            team_id,
            team_invite_id: invite_id,
            member_id: user_id.clone().into_owned(),
            role: TeamRole::Member,
        }]
    );
}

#[tokio::test]
async fn join_team_enterprise_rolls_back_accepted_invite_when_role_assignment_fails() {
    let team_id = uuid::Uuid::from_u128(46);
    let invite_id = uuid::Uuid::from_u128(460);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_join_team_repository(team_id, invite_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService {
        fail_upsert: true,
        ..Default::default()
    };
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.join_team(&invite_id, &user_id).await.unwrap_err();

    assert!(matches!(error, JoinTeamError::AddRolesToUserError(_)));
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.rollback_accept_calls.lock().unwrap(), 1);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(roles_service.upsert_calls.lock().unwrap().len(), 1);
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn join_team_enterprise_rolls_back_roles_and_invite_when_channel_add_fails() {
    let team_id = uuid::Uuid::from_u128(47);
    let invite_id = uuid::Uuid::from_u128(470);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_join_team_repository(team_id, invite_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository {
        fail_add: true,
        ..Default::default()
    };
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.join_team(&invite_id, &user_id).await.unwrap_err();

    assert!(matches!(error, JoinTeamError::TeamError(_)));
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.rollback_accept_calls.lock().unwrap(), 1);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(roles_service.upsert_calls.lock().unwrap().len(), 1);
    assert_eq!(roles_service.remove_calls.lock().unwrap().len(), 1);
    assert_eq!(
        *channels_repository.add_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn join_team_enterprise_rolls_back_accepted_invite_when_status_read_fails() {
    let team_id = uuid::Uuid::from_u128(48);
    let invite_id = uuid::Uuid::from_u128(480);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mut team_repository = make_enterprise_join_team_repository(team_id, invite_id, &user_id);
    team_repository.fail_enterprise_status_lookup = true;
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.join_team(&invite_id, &user_id).await.unwrap_err();

    assert!(matches!(error, JoinTeamError::TeamError(_)));
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.rollback_accept_calls.lock().unwrap(), 1);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn join_team_rolls_back_accepted_invite_when_billing_lookup_fails() {
    let team_id = uuid::Uuid::from_u128(49);
    let invite_id = uuid::Uuid::from_u128(490);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();

    for (fail_payment_status, fail_subscription_id, expected_subscription_lookups) in
        [(true, false, 0), (false, true, 1)]
    {
        let mut team_repository =
            make_enterprise_join_team_repository(team_id, invite_id, &user_id);
        team_repository.enterprise = false;
        team_repository.fail_team_payment_status_lookup = fail_payment_status;
        team_repository.fail_team_subscription_id_lookup = fail_subscription_id;

        let service = TeamServiceImpl::new(
            team_repository.clone(),
            MockCustomerRepository::default(),
            MockTeamChannelsRepository::default(),
            MockUserRolesAndPermissionsService::default(),
            Arc::new(MockNotificationIngress::new(HashSet::new())),
            NoOpCrmEnqueuer,
            NoOpTeamCrmSettingsRepository,
        );

        let error = service.join_team(&invite_id, &user_id).await.unwrap_err();

        assert!(matches!(
            error,
            JoinTeamError::TeamError(TeamError::StorageLayerError(_))
        ));
        assert_eq!(*team_repository.rollback_accept_calls.lock().unwrap(), 1);
        assert_eq!(
            *team_repository
                .team_payment_status_lookup_calls
                .lock()
                .unwrap(),
            1
        );
        assert_eq!(
            *team_repository
                .team_subscription_id_lookup_calls
                .lock()
                .unwrap(),
            expected_subscription_lookups
        );
    }
}

#[tokio::test]
async fn test_join_team_backfills_legacy_team_subscription() {
    let team_id = uuid::Uuid::from_u128(43);
    let invite_id = uuid::Uuid::from_u128(430);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_backfill_join".parse().unwrap();

    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Legacy Team", mark_sent_calls)
        .with_team(Team::new(
            team_id,
            "Legacy Team".to_string(),
            "legacy-team".to_string(),
            owner_id.clone().into_owned(),
            false,
            false,
        ));
    team_repo.team_payment_status = false;
    team_repo.team_subscription_id = None;
    team_repo.stripe_customer_id = Some("cus_backfill_join".parse().unwrap());
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    let subscription_update_calls = team_repo.subscription_update_calls.clone();
    let payment_update_calls = team_repo.payment_update_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let convert_calls = customer_repo.convert_calls.clone();
    let increment_calls = customer_repo.increment_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service.join_team(&invite_id, &user_id).await.unwrap();

    assert!(convert_calls.lock().unwrap().contains(&(
        subscription_id.to_string(),
        team_id,
        owner_id.as_ref().to_string()
    )));
    assert_eq!(
        *subscription_update_calls.lock().unwrap(),
        vec![(team_id, subscription_id.to_string())]
    );
    assert_eq!(*payment_update_calls.lock().unwrap(), vec![(team_id, true)]);
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
}

#[tokio::test]
async fn test_join_team_rolls_back_accept_when_backfill_fails() {
    let team_id = uuid::Uuid::from_u128(44);
    let invite_id = uuid::Uuid::from_u128(440);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();

    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Legacy Team", mark_sent_calls)
        .with_team(Team::new(
            team_id,
            "Legacy Team".to_string(),
            "legacy-team".to_string(),
            owner_id.into_owned(),
            false,
            false,
        ));
    team_repo.team_payment_status = false;
    team_repo.team_subscription_id = None;
    team_repo.stripe_customer_id = Some("cus_backfill_join".parse().unwrap());
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    let rollback_accept_calls = team_repo.rollback_accept_calls.clone();

    let customer_repo = MockCustomerRepository {
        no_active_subscription: true,
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service.join_team(&invite_id, &user_id).await.err().unwrap();

    assert!(matches!(err, JoinTeamError::CustomerError(_)));
    assert_eq!(*rollback_accept_calls.lock().unwrap(), 1);
    assert!(increment_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_join_team_increments_customer_seat_count() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id = uuid::Uuid::from_u128(2);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_accept_calls = team_repo.rollback_accept_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();

    let channels_repo = MockTeamChannelsRepository::default();
    let add_channel_calls = channels_repo.add_calls.clone();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let upsert_role_calls = roles_service.upsert_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service.join_team(&invite_id, &user_id).await.unwrap();

    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert!(decrement_calls.lock().unwrap().is_empty());
    assert_eq!(*rollback_accept_calls.lock().unwrap(), 0);
    assert_eq!(
        *add_channel_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert_eq!(upsert_role_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn team_analytics_join_team_emits_joined_event_with_team_id() {
    let team_id = uuid::Uuid::from_u128(321);
    let invite_id = uuid::Uuid::from_u128(322);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let customer_repo = MockCustomerRepository {
        subscription_id,
        ..Default::default()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    service.join_team(&invite_id, &user_id).await.unwrap();

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        TeamAnalyticsEvent::TeamJoined {
            team_id: event_team_id,
            team_invite_id,
            member_id,
            role,
        } => {
            assert_eq!(*event_team_id, team_id);
            assert_eq!(*team_invite_id, invite_id);
            assert_eq!(member_id.as_ref(), user_id.as_ref());
            assert_eq!(*role, TeamRole::Member);
        }
        event => panic!("unexpected event: {event:?}"),
    }
}

#[tokio::test]
async fn test_join_team_rolls_back_accept_when_customer_increment_fails() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id = uuid::Uuid::from_u128(2);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_accept_calls = team_repo.rollback_accept_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        fail_increment: true,
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let channels_repo = MockTeamChannelsRepository::default();
    let add_channel_calls = channels_repo.add_calls.clone();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let upsert_role_calls = roles_service.upsert_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service.join_team(&invite_id, &user_id).await.err().unwrap();

    assert!(matches!(err, JoinTeamError::CustomerError(_)));
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(*rollback_accept_calls.lock().unwrap(), 1);
    assert!(add_channel_calls.lock().unwrap().is_empty());
    assert!(upsert_role_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_remove_user_from_team_decrements_customer_seat_count() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.removed_member = Some(TeamMember {
        team_id,
        user_id: member_id.clone().into_owned(),
        role: TeamRole::Member,
    });
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_remove_calls = team_repo.rollback_remove_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();

    let channels_repo = MockTeamChannelsRepository::default();
    let remove_channel_calls = channels_repo.remove_calls.clone();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let remove_role_calls = roles_service.remove_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap();

    assert_eq!(
        *decrement_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert!(increment_calls.lock().unwrap().is_empty());
    assert_eq!(*rollback_remove_calls.lock().unwrap(), 0);
    assert_eq!(
        *remove_channel_calls.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert_eq!(remove_role_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn team_analytics_remove_user_from_team_emits_left_event_with_team_id() {
    let team_id = uuid::Uuid::from_u128(331);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.removed_member = Some(TeamMember {
        team_id,
        user_id: member_id.clone().into_owned(),
        role: TeamRole::Admin,
    });
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let customer_repo = MockCustomerRepository {
        subscription_id,
        ..Default::default()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap();

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        TeamAnalyticsEvent::TeamLeft {
            team_id: event_team_id,
            member_id: event_member_id,
            removed_by_id,
            role,
        } => {
            assert_eq!(*event_team_id, team_id);
            assert_eq!(event_member_id.as_ref(), member_id.as_ref());
            assert_eq!(removed_by_id.as_ref(), owner_id.as_ref());
            assert_eq!(*role, TeamRole::Admin);
        }
        event => panic!("unexpected event: {event:?}"),
    }
}

#[tokio::test]
async fn test_remove_user_from_team_rolls_back_remove_when_customer_decrement_fails() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.removed_member = Some(TeamMember {
        team_id,
        user_id: member_id.clone().into_owned(),
        role: TeamRole::Member,
    });
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_remove_calls = team_repo.rollback_remove_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        fail_decrement: true,
        ..Default::default()
    };
    let decrement_calls = customer_repo.decrement_calls.clone();
    let channels_repo = MockTeamChannelsRepository::default();
    let remove_channel_calls = channels_repo.remove_calls.clone();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let remove_role_calls = roles_service.remove_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .err()
        .unwrap();

    assert!(matches!(err, RemoveUserFromTeamError::CustomerError(_)));
    assert_eq!(
        *decrement_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(*rollback_remove_calls.lock().unwrap(), 1);
    assert!(remove_channel_calls.lock().unwrap().is_empty());
    assert!(remove_role_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_join_team_rolls_back_customer_roles_and_accept_when_channel_add_fails() {
    let team_id = uuid::Uuid::from_u128(1);
    let invite_id = uuid::Uuid::from_u128(2);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_accept_calls = team_repo.rollback_accept_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();
    let channels_repo = MockTeamChannelsRepository {
        fail_add: true,
        ..Default::default()
    };
    let roles_service = MockUserRolesAndPermissionsService::default();
    let upsert_role_calls = roles_service.upsert_calls.clone();
    let remove_role_calls = roles_service.remove_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service.join_team(&invite_id, &user_id).await.err().unwrap();

    assert!(matches!(err, JoinTeamError::TeamError(_)));
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(
        *decrement_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(*rollback_accept_calls.lock().unwrap(), 1);
    assert_eq!(upsert_role_calls.lock().unwrap().len(), 1);
    assert_eq!(remove_role_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn team_analytics_join_team_does_not_emit_when_join_is_rolled_back() {
    let team_id = uuid::Uuid::from_u128(323);
    let invite_id = uuid::Uuid::from_u128(324);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.accepted_invite = Some(make_accepted_invite(team_id, invite_id, &user_id));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let customer_repo = MockCustomerRepository {
        subscription_id,
        ..Default::default()
    };
    let channels_repo = MockTeamChannelsRepository {
        fail_add: true,
        ..Default::default()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        customer_repo,
        channels_repo,
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    let err = service.join_team(&invite_id, &user_id).await.err().unwrap();

    assert!(matches!(err, JoinTeamError::TeamError(_)));
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_remove_user_from_team_rolls_back_customer_and_remove_when_channel_remove_fails() {
    let team_id = uuid::Uuid::from_u128(1);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.removed_member = Some(TeamMember {
        team_id,
        user_id: member_id.clone().into_owned(),
        role: TeamRole::Member,
    });
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let rollback_remove_calls = team_repo.rollback_remove_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();
    let channels_repo = MockTeamChannelsRepository {
        fail_remove: true,
        ..Default::default()
    };
    let roles_service = MockUserRolesAndPermissionsService::default();
    let remove_role_calls = roles_service.remove_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .err()
        .unwrap();

    assert!(matches!(err, RemoveUserFromTeamError::TeamError(_)));
    assert_eq!(
        *decrement_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(*rollback_remove_calls.lock().unwrap(), 1);
    assert!(remove_role_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn team_analytics_remove_user_from_team_does_not_emit_when_remove_is_rolled_back() {
    let team_id = uuid::Uuid::from_u128(332);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.removed_member = Some(TeamMember {
        team_id,
        user_id: member_id.clone().into_owned(),
        role: TeamRole::Member,
    });
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let customer_repo = MockCustomerRepository {
        subscription_id,
        ..Default::default()
    };
    let channels_repo = MockTeamChannelsRepository {
        fail_remove: true,
        ..Default::default()
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = build_service_with_analytics(
        team_repo,
        customer_repo,
        channels_repo,
        MockUserRolesAndPermissionsService::default(),
        MockTeamAnalytics::new(events.clone()),
    );

    let err = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .err()
        .unwrap();

    assert!(matches!(err, RemoveUserFromTeamError::TeamError(_)));
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_try_join_team_by_domain_no_matching_team_returns_none() {
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);

    let customer_repo = MockCustomerRepository::default();
    let increment_calls = customer_repo.increment_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let member = service.try_join_team_by_domain(&user_id).await.unwrap();

    assert!(member.is_none());
    assert!(increment_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_try_join_team_by_domain_adds_member_directly() {
    let team_id = uuid::Uuid::from_u128(77);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.team_id_for_domain = Some(team_id);
    team_repo.add_user_to_team_result = Some(make_team_member(
        team_id,
        "macro|member@example.com",
        TeamRole::Member,
    ));
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let remove_user_calls = team_repo.remove_user_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();

    let channels_repo = MockTeamChannelsRepository::default();
    let add_channel_calls = channels_repo.add_calls.clone();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let upsert_role_calls = roles_service.upsert_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        channels_repo,
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let member = service
        .try_join_team_by_domain(&user_id)
        .await
        .unwrap()
        .expect("user should have been auto-joined");

    assert_eq!(member.team_id, team_id);
    assert_eq!(member.user_id.as_ref(), user_id.as_ref());
    assert_eq!(member.role, TeamRole::Member);
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert!(decrement_calls.lock().unwrap().is_empty());
    assert_eq!(
        *add_channel_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert_eq!(upsert_role_calls.lock().unwrap().len(), 1);
    assert_eq!(*remove_user_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn test_try_join_team_by_domain_returns_none_when_already_member() {
    let team_id = uuid::Uuid::from_u128(78);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    // add_user_to_team returns None: the user is already on the team.
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.team_id_for_domain = Some(team_id);
    team_repo.add_user_to_team_result = None;

    let customer_repo = MockCustomerRepository::default();
    let increment_calls = customer_repo.increment_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let member = service.try_join_team_by_domain(&user_id).await.unwrap();

    assert!(member.is_none());
    assert!(increment_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_try_join_team_by_domain_skips_team_at_seat_cap() {
    let team_id = uuid::Uuid::from_u128(79);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    // The mock would add the member, so a None result proves the seat-cap
    // check short-circuited before the membership insert.
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.team_id_for_domain = Some(team_id);
    team_repo.add_user_to_team_result = Some(make_team_member(
        team_id,
        "macro|member@example.com",
        TeamRole::Member,
    ));
    team_repo.team_plan = Some(TeamPlan::Idea);
    team_repo.seat_count = TeamPlan::Idea.seat_cap();

    let customer_repo = MockCustomerRepository::default();
    let increment_calls = customer_repo.increment_calls.clone();

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let member = service.try_join_team_by_domain(&user_id).await.unwrap();

    assert!(member.is_none());
    assert!(increment_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_try_join_team_by_domain_rolls_back_membership_when_roles_fail() {
    let team_id = uuid::Uuid::from_u128(80);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let subscription_id: stripe::SubscriptionId = "sub_test".parse().unwrap();
    let mark_sent_calls: Arc<Mutex<Vec<Vec<uuid::Uuid>>>> = Arc::new(Mutex::new(Vec::new()));

    let member = make_team_member(team_id, "macro|member@example.com", TeamRole::Member);
    let mut team_repo = MockTeamRepository::new(Vec::new(), "Test Team", mark_sent_calls);
    team_repo.team_id_for_domain = Some(team_id);
    team_repo.add_user_to_team_result = Some(member.clone());
    // The rollback removes the freshly added member again.
    team_repo.removed_member = Some(member);
    team_repo.team_subscription_id = Some(subscription_id.clone());
    let remove_user_calls = team_repo.remove_user_calls.clone();

    let customer_repo = MockCustomerRepository {
        subscription_id: subscription_id.clone(),
        ..Default::default()
    };
    let increment_calls = customer_repo.increment_calls.clone();
    let decrement_calls = customer_repo.decrement_calls.clone();

    let roles_service = MockUserRolesAndPermissionsService {
        fail_upsert: true,
        ..Default::default()
    };

    let service = TeamServiceImpl::new(
        team_repo,
        customer_repo,
        MockTeamChannelsRepository::default(),
        roles_service,
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let err = service
        .try_join_team_by_domain(&user_id)
        .await
        .err()
        .unwrap();

    assert!(matches!(
        err,
        TryJoinTeamByDomainError::JoinTeamError(JoinTeamError::AddRolesToUserError(_))
    ));
    // The seat increment happened, was rolled back, and the membership
    // itself was removed again.
    assert_eq!(
        *increment_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(
        *decrement_calls.lock().unwrap(),
        vec![(subscription_id.to_string(), 1)]
    );
    assert_eq!(*remove_user_calls.lock().unwrap(), 1);
}

#[tokio::test]
async fn try_join_team_by_domain_rolls_back_membership_when_billing_lookup_fails() {
    let team_id = uuid::Uuid::from_u128(86);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();

    for (fail_payment_status, fail_subscription_id, expected_subscription_lookups) in
        [(true, false, 0), (false, true, 1)]
    {
        let mut team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
        team_repository.enterprise = false;
        team_repository.fail_team_payment_status_lookup = fail_payment_status;
        team_repository.fail_team_subscription_id_lookup = fail_subscription_id;

        let service = TeamServiceImpl::new(
            team_repository.clone(),
            MockCustomerRepository::default(),
            MockTeamChannelsRepository::default(),
            MockUserRolesAndPermissionsService::default(),
            Arc::new(MockNotificationIngress::new(HashSet::new())),
            NoOpCrmEnqueuer,
            NoOpTeamCrmSettingsRepository,
        );

        let error = service.try_join_team_by_domain(&user_id).await.unwrap_err();

        assert!(matches!(
            error,
            TryJoinTeamByDomainError::TeamError(TeamError::StorageLayerError(_))
        ));
        assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 1);
        assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
        assert_eq!(
            *team_repository
                .team_payment_status_lookup_calls
                .lock()
                .unwrap(),
            1
        );
        assert_eq!(
            *team_repository
                .team_subscription_id_lookup_calls
                .lock()
                .unwrap(),
            expected_subscription_lookups
        );
    }
}

#[tokio::test]
async fn try_join_team_by_domain_enterprise_bypasses_billing_and_preserves_side_effects() {
    let team_id = uuid::Uuid::from_u128(81);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let member = service
        .try_join_team_by_domain(&user_id)
        .await
        .unwrap()
        .expect("enterprise user should have been auto-joined");

    assert_eq!(member.team_id, team_id);
    assert_eq!(member.user_id, user_id);
    assert_eq!(member.role, TeamRole::Member);
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(
        *roles_service.upsert_calls.lock().unwrap(),
        vec![(
            user_id.as_ref().to_string(),
            vec![RoleId::TeamSubscriber, RoleId::SubOpus]
        )]
    );
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert_eq!(
        *channels_repository.add_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert!(channels_repository.remove_calls.lock().unwrap().is_empty());
    assert_eq!(
        *crm_enqueuer.populated.lock().unwrap(),
        vec![user_id.as_ref().to_string()]
    );
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn try_join_team_by_domain_enterprise_still_enforces_local_seat_cap() {
    let team_id = uuid::Uuid::from_u128(82);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mut team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
    team_repository.team_plan = Some(TeamPlan::Idea);
    team_repository.seat_count = TeamPlan::Idea.seat_cap();
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let member = service.try_join_team_by_domain(&user_id).await.unwrap();

    assert!(member.is_none());
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn try_join_team_by_domain_enterprise_rolls_back_membership_when_roles_fail() {
    let team_id = uuid::Uuid::from_u128(83);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService {
        fail_upsert: true,
        ..Default::default()
    };
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.try_join_team_by_domain(&user_id).await.unwrap_err();

    assert!(matches!(
        error,
        TryJoinTeamByDomainError::JoinTeamError(JoinTeamError::AddRolesToUserError(_))
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(roles_service.upsert_calls.lock().unwrap().len(), 1);
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn try_join_team_by_domain_enterprise_rolls_back_roles_when_channels_fail() {
    let team_id = uuid::Uuid::from_u128(84);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository {
        fail_add: true,
        ..Default::default()
    };
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.try_join_team_by_domain(&user_id).await.unwrap_err();

    assert!(matches!(
        error,
        TryJoinTeamByDomainError::JoinTeamError(JoinTeamError::TeamError(_))
    ));
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert_eq!(roles_service.upsert_calls.lock().unwrap().len(), 1);
    assert_eq!(roles_service.remove_calls.lock().unwrap().len(), 1);
    assert_eq!(
        *channels_repository.add_calls.lock().unwrap(),
        vec![(team_id, user_id.as_ref().to_string())]
    );
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn remove_user_from_team_enterprise_bypasses_billing_and_preserves_side_effects() {
    let team_id = uuid::Uuid::from_u128(91);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member_id, TeamRole::Admin);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap();

    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.rollback_remove_calls.lock().unwrap(), 0);
    assert_no_enterprise_remove_user_billing_calls(&team_repository, &customer_repository);
    assert_eq!(
        *channels_repository.remove_calls.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert_eq!(
        *roles_service.remove_calls.lock().unwrap(),
        vec![(
            member_id.as_ref().to_string(),
            vec![RoleId::TeamSubscriber, RoleId::SubOpus]
        )]
    );
    assert_eq!(
        *crm_enqueuer.depopulated.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec![TeamAnalyticsEvent::TeamLeft {
            team_id,
            member_id: member_id.clone().into_owned(),
            removed_by_id: owner_id.into_owned(),
            role: TeamRole::Admin,
        }]
    );
}

#[tokio::test]
async fn remove_user_from_team_enterprise_rolls_back_membership_when_channel_removal_fails() {
    let team_id = uuid::Uuid::from_u128(92);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member_id, TeamRole::Member);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository {
        fail_remove: true,
        ..Default::default()
    };
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RemoveUserFromTeamError::TeamError(_)));
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.rollback_remove_calls.lock().unwrap(), 1);
    assert_no_enterprise_remove_user_billing_calls(&team_repository, &customer_repository);
    assert_eq!(
        *channels_repository.remove_calls.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.depopulated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn remove_user_from_team_enterprise_rolls_back_membership_and_channels_when_role_removal_fails()
 {
    let team_id = uuid::Uuid::from_u128(93);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let team_repository =
        make_enterprise_remove_user_repository(team_id, &member_id, TeamRole::Member);
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService {
        fail_remove: true,
        ..Default::default()
    };
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        RemoveUserFromTeamError::RemoveRolesFromUserError(_)
    ));
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_eq!(*team_repository.rollback_remove_calls.lock().unwrap(), 1);
    assert_no_enterprise_remove_user_billing_calls(&team_repository, &customer_repository);
    assert_eq!(
        *channels_repository.remove_calls.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert_eq!(
        *channels_repository.add_calls.lock().unwrap(),
        vec![(team_id, member_id.as_ref().to_string())]
    );
    assert_eq!(roles_service.remove_calls.lock().unwrap().len(), 1);
    assert!(crm_enqueuer.depopulated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn remove_user_from_team_enterprise_status_read_precedes_membership_removal() {
    let team_id = uuid::Uuid::from_u128(94);
    let owner_id = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mut team_repository =
        make_enterprise_remove_user_repository(team_id, &member_id, TeamRole::Member);
    team_repository.fail_enterprise_status_lookup = true;
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &owner_id),
            &member_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        RemoveUserFromTeamError::TeamError(TeamError::StorageLayerError(_))
    ));
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
    assert_eq!(*team_repository.rollback_remove_calls.lock().unwrap(), 0);
    assert_no_enterprise_remove_user_billing_calls(&team_repository, &customer_repository);
    assert!(channels_repository.remove_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.depopulated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn try_join_team_by_domain_enterprise_status_read_precedes_membership_mutation() {
    let team_id = uuid::Uuid::from_u128(85);
    let user_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    let mut team_repository = make_enterprise_domain_join_team_repository(team_id, &user_id);
    team_repository.fail_enterprise_status_lookup = true;
    let customer_repository = MockCustomerRepository::default();
    let channels_repository = MockTeamChannelsRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let crm_enqueuer = RecordingCrmEnqueuer::default();
    let events = Arc::new(Mutex::new(Vec::new()));

    let service = TeamServiceImpl::new_with_analytics(
        team_repository.clone(),
        customer_repository.clone(),
        channels_repository.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        crm_enqueuer.clone(),
        NoOpTeamCrmSettingsRepository,
        MockTeamAnalytics::new(events.clone()),
    );

    let error = service.try_join_team_by_domain(&user_id).await.unwrap_err();

    assert!(matches!(
        error,
        TryJoinTeamByDomainError::TeamError(TeamError::StorageLayerError(_))
    ));
    assert_eq!(
        *team_repository
            .enterprise_status_lookup_calls
            .lock()
            .unwrap(),
        1
    );
    assert_eq!(*team_repository.add_user_to_team_calls.lock().unwrap(), 0);
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
    assert_no_enterprise_join_team_billing_calls(&team_repository, &customer_repository);
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
    assert!(channels_repository.add_calls.lock().unwrap().is_empty());
    assert!(crm_enqueuer.populated.lock().unwrap().is_empty());
    assert!(events.lock().unwrap().is_empty());
}
