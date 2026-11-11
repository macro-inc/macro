//! Team agents join on an included seat that billing never sees.

use super::*;

#[tokio::test]
async fn add_team_agent_on_a_paying_team_grants_premium_roles_without_billing() {
    let team_id = uuid::Uuid::from_u128(0x7a_0001);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.team_payment_status = true;
    team_repository.add_user_to_team_result = Some(TeamMember {
        team_id,
        user_id: agent_id.clone().into_owned(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let event_broker = RecordingEventBroker::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(event_broker.clone());

    let member = service
        .add_team_agent(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap();

    assert_eq!(member.team_id, team_id);
    assert_eq!(member.user_id.as_ref(), "macro|agent@example.com");
    assert_eq!(member.role, TeamRole::Member);
    assert_eq!(
        *team_repository.added_seat_included.lock().unwrap(),
        vec![true]
    );
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
    assert!(
        customer_repository
            .seat_plan_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(customer_repository.convert_calls.lock().unwrap().is_empty());
    assert_eq!(
        *customer_repository
            .subscription_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert!(
        customer_repository
            .item_change_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        *roles_service.upsert_calls.lock().unwrap(),
        vec![(
            "macro|agent@example.com".to_string(),
            vec![RoleId::TeamSubscriber, RoleId::SubOpus]
        )]
    );
    assert_eq!(
        *channel_service.auto_join_calls.lock().unwrap(),
        vec![(team_id, "macro|agent@example.com".to_string())]
    );
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);

    let events = event_broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].envelope["event_type"], "team.member_joined");
    assert_eq!(
        events[0].envelope["metadata"]["member_id"],
        "macro|agent@example.com"
    );
    assert_eq!(
        events[0].envelope["metadata"]["join_method"],
        serde_json::json!({
            "type": "team_agent",
            "added_by": "macro|admin@example.com"
        })
    );
}

#[tokio::test]
async fn add_team_agent_on_a_free_team_joins_without_premium_roles() {
    let team_id = uuid::Uuid::from_u128(0x7a_0002);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = None;
    team_repository.team_payment_status = false;
    team_repository.add_user_to_team_result = Some(TeamMember {
        team_id,
        user_id: agent_id.clone().into_owned(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService::default();
    let roles_service = MockUserRolesAndPermissionsService::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .add_team_agent(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap();

    assert_eq!(
        *team_repository.added_seat_included.lock().unwrap(),
        vec![true]
    );
    // A free team with no subscription would otherwise try to link the
    // owner's personal one.
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
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
    assert_eq!(
        *channel_service.auto_join_calls.lock().unwrap(),
        vec![(team_id, "macro|agent@example.com".to_string())]
    );
}

#[tokio::test]
async fn add_team_agent_already_on_the_team_is_a_typed_error() {
    let team_id = uuid::Uuid::from_u128(0x7a_0003);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.add_user_to_team_result = None;
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let event_broker = RecordingEventBroker::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(event_broker.clone());

    let error = service
        .add_team_agent(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, JoinTeamDirectlyError::AlreadyMember));
    assert!(
        customer_repository
            .increment_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
    assert!(channel_service.auto_join_calls.lock().unwrap().is_empty());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn undo_team_agent_join_removes_only_the_included_membership() {
    let team_id = uuid::Uuid::from_u128(0x7a_0004);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.seat_included = true;
    team_repository.removed_member = Some(TeamMember {
        team_id,
        user_id: agent_id.clone().into_owned(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService::default();
    let roles_service = MockUserRolesAndPermissionsService::default();
    let event_broker = RecordingEventBroker::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(event_broker.clone());

    service
        .undo_team_agent_join(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap();

    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert!(
        customer_repository
            .decrement_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        customer_repository
            .schedule_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(roles_service.remove_calls.lock().unwrap().is_empty());
    assert!(channel_service.leave_calls.lock().unwrap().is_empty());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn undo_team_agent_join_refuses_a_billed_membership() {
    let team_id = uuid::Uuid::from_u128(0x7a_0005);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let member_id = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())))
            .with_team_members(vec![TeamMember {
                team_id,
                user_id: member_id.clone().into_owned(),
                role: TeamRole::Member,
                plan: SeatPlan::Premium,
            }]);
    team_repository.seat_included = false;

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let error = service
        .undo_team_agent_join(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &member_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RemoveUserFromTeamError::SeatNotIncluded));
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn undo_team_agent_join_of_a_missing_membership_is_user_not_in_team() {
    let team_id = uuid::Uuid::from_u128(0x7a_0006);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.seat_included = false;

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let error = service
        .undo_team_agent_join(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RemoveUserFromTeamError::UserNotInTeam));
    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn remove_user_from_team_of_an_included_seat_leaves_the_subscription_alone() {
    let team_id = uuid::Uuid::from_u128(0x7a_0007);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.seat_included = true;
    team_repository.removed_member = Some(TeamMember {
        team_id,
        user_id: agent_id.clone().into_owned(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService::default();
    let roles_service = MockUserRolesAndPermissionsService::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service.clone(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap();

    assert_eq!(*team_repository.remove_user_calls.lock().unwrap(), 1);
    assert_eq!(
        *team_repository
            .team_subscription_id_lookup_calls
            .lock()
            .unwrap(),
        0
    );
    assert!(
        customer_repository
            .decrement_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        customer_repository
            .increment_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        customer_repository
            .schedule_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert_eq!(customer_repository.renewal_reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        *channel_service.leave_calls.lock().unwrap(),
        vec![(team_id, "macro|agent@example.com".to_string())]
    );
    assert_eq!(roles_service.remove_calls.lock().unwrap().len(), 1);
    assert_eq!(*team_repository.rollback_remove_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn remove_user_from_team_rollback_keeps_the_seat_included() {
    let team_id = uuid::Uuid::from_u128(0x7a_0008);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())));
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.seat_included = true;
    team_repository.removed_member = Some(TeamMember {
        team_id,
        user_id: agent_id.clone().into_owned(),
        role: TeamRole::Member,
        plan: SeatPlan::Premium,
    });
    let customer_repository = MockCustomerRepository::default();
    let channel_service = RecordingChannelService {
        fail_leave: true,
        ..Default::default()
    };

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        channel_service,
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    service
        .remove_user_from_team(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
        )
        .await
        .unwrap_err();

    assert_eq!(
        *team_repository.rolled_back_seat_included.lock().unwrap(),
        vec![true]
    );
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

#[tokio::test]
async fn set_team_member_plan_rejects_an_included_seat() {
    let team_id = uuid::Uuid::from_u128(0x7a_0009);
    let admin_id = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let agent_id = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();

    let mut team_repository =
        MockTeamRepository::new(Vec::new(), "Acme", Arc::new(Mutex::new(Vec::new())))
            .with_team_members(vec![TeamMember {
                team_id,
                user_id: agent_id.clone().into_owned(),
                role: TeamRole::Member,
                plan: SeatPlan::Premium,
            }]);
    team_repository.team_subscription_id = Some("sub_team".parse().unwrap());
    team_repository.seat_included = true;
    let customer_repository = MockCustomerRepository::default();
    let roles_service = MockUserRolesAndPermissionsService::default();

    let service = TeamServiceImpl::new(
        team_repository.clone(),
        customer_repository.clone(),
        RecordingChannelService::default(),
        roles_service.clone(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );

    let error = service
        .set_team_member_plan(
            test_team_receipt::<AdminTeamRole>(team_id, &admin_id),
            &agent_id,
            SeatPlan::Max,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, SetTeamMemberPlanError::SeatIncluded));
    assert!(
        customer_repository
            .move_seat_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        customer_repository
            .schedule_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(
        team_repository
            .patch_team_member_plan_calls
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(roles_service.upsert_calls.lock().unwrap().is_empty());
}
