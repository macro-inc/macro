use super::*;
use entity_access::domain::models::MemberTeamRole;

#[tokio::test]
async fn teammates_discover_only_the_bound_computer_without_admin_details() {
    let member = user("macro|member@example.com");
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        member.clone(),
        Ok(FlagSnapshot::new([(
            hosted_runtimes::domain::rollout::ENABLE_MACRO_COMPUTERS.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    let (service, _) = build(Setup::default());
    let mut service = service.with_computer_rollout(ComputerRollout::new(flags));
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    let member_receipt =
        EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
            member.clone(),
            TEAM_ID,
            EntityType::Team,
        );
    let unpaired = service
        .computer(member_receipt.clone(), &agent.user_id)
        .await
        .unwrap();
    assert_eq!(unpaired.computer_id, agent.computer_id.unwrap());
    assert!(unpaired.harness_id.is_none());
    assert!(unpaired.is_agent_computer);
    assert_eq!(
        service.list(receipt(TEAM_ID)).await.unwrap().agents.len(),
        1
    );
    let harness = harness_id::HarnessId::new_from_uuid(Uuid::from_u128(0x50));
    *service.computers.harness_id.lock().unwrap() = Some(harness);
    assert_eq!(
        service
            .computer(member_receipt.clone(), &agent.user_id)
            .await
            .unwrap()
            .harness_id,
        Some(harness)
    );
    let cross_team = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        member,
        OTHER_TEAM_ID,
        EntityType::Team,
    );
    assert!(matches!(
        service.computer(cross_team, &agent.user_id).await,
        Err(TeamAgentError::NotFound)
    ));
    service.computers.unavailable = true;
    assert!(matches!(
        service.computer(member_receipt, &agent.user_id).await,
        Err(TeamAgentError::NotFound)
    ));
}

#[tokio::test]
async fn teammate_discovery_fails_closed_for_rollout_and_missing_agents() {
    let (service, _) = build(Setup::default());
    assert!(matches!(
        service
            .computer(
                EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
                    user(ADMIN),
                    TEAM_ID,
                    EntityType::Team
                ),
                &user(AGENT),
            )
            .await,
        Err(TeamAgentError::NotEnabled)
    ));
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user(ADMIN),
        Ok(FlagSnapshot::new([(
            hosted_runtimes::domain::rollout::ENABLE_MACRO_COMPUTERS.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    let service = service.with_computer_rollout(ComputerRollout::new(flags));
    let caller = user("macro|disabled@example.com");
    let receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        caller,
        TEAM_ID,
        EntityType::Team,
    );
    assert!(matches!(
        service.computer(receipt, &user(AGENT)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    let receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        user(ADMIN),
        TEAM_ID,
        EntityType::Team,
    );
    assert!(matches!(
        service.computer(receipt, &user(AGENT)).await,
        Err(TeamAgentError::NotFound)
    ));
}

#[tokio::test]
async fn computer_discovery_uses_computer_rollout_independently_of_agent_management() {
    for (computers_enabled, agents_enabled) in [(true, false), (false, true)] {
        let (mut service, _) = build(Setup::default());
        let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
        let snapshot = FlagSnapshot::new([
            (
                hosted_runtimes::domain::rollout::ENABLE_MACRO_COMPUTERS.to_owned(),
                FlagValue::Boolean(computers_enabled),
            ),
            (
                TEAM_AGENTS_FLAG.to_owned(),
                FlagValue::Boolean(agents_enabled),
            ),
        ]);
        let mut management_flags = FakeFeatureFlags::default();
        management_flags.set(user(ADMIN), Ok(snapshot.clone()));
        service.rollout = TeamAgentRollout::new(Some(management_flags));
        let mut computer_flags = FakeFeatureFlags::default();
        computer_flags.set(user(ADMIN), Ok(snapshot));
        let service = service.with_computer_rollout(ComputerRollout::new(computer_flags));
        let member_receipt =
            EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
                user(ADMIN),
                TEAM_ID,
                EntityType::Team,
            );
        let result = service.computer(member_receipt, &agent.user_id).await;
        if computers_enabled {
            assert_eq!(result.unwrap().computer_id, agent.computer_id.unwrap());
        } else {
            assert!(matches!(result, Err(TeamAgentError::NotEnabled)));
        }
        let roster = service.list(receipt(TEAM_ID)).await;
        if agents_enabled {
            assert_eq!(roster.unwrap().agents.len(), 1);
        } else {
            assert!(matches!(roster, Err(TeamAgentError::NotEnabled)));
        }
    }
}

#[tokio::test]
async fn detached_discovery_checks_rollout_then_attachment_before_any_agent_lookup() {
    for existing_agent in [false, true] {
        for computers_enabled in [false, true] {
            let (service, journal) = build(Setup::default());
            if existing_agent {
                service.create(receipt(TEAM_ID), request()).await.unwrap();
            }
            let mut flags = FakeFeatureFlags::default();
            flags.set(
                user(ADMIN),
                Ok(FlagSnapshot::new([(
                    hosted_runtimes::domain::rollout::ENABLE_MACRO_COMPUTERS.to_owned(),
                    FlagValue::Boolean(computers_enabled),
                )])),
            );
            let mut service = service.with_computer_rollout(ComputerRollout::new(flags));
            service.computers.attached = false;
            let before_reads = *service.repository.get_calls.lock().unwrap();
            let before_steps = journal.steps().len();
            let before_attachment = *service.computers.attachment_calls.lock().unwrap();
            let result = service
                .computer(
                    EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
                        user(ADMIN),
                        TEAM_ID,
                        EntityType::Team,
                    ),
                    &user(AGENT),
                )
                .await;
            if computers_enabled {
                assert!(matches!(result, Err(TeamAgentError::FleetUnavailable(_))));
                assert_eq!(
                    *service.computers.attachment_calls.lock().unwrap(),
                    before_attachment + 1
                );
            } else {
                assert!(matches!(result, Err(TeamAgentError::NotEnabled)));
                assert_eq!(
                    *service.computers.attachment_calls.lock().unwrap(),
                    before_attachment
                );
            }
            assert_eq!(journal.steps().len(), before_steps);
            assert_eq!(*service.repository.get_calls.lock().unwrap(), before_reads);
        }
    }
}
