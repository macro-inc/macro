use super::*;
use entity_access::domain::models::MemberTeamRole;

#[tokio::test]
async fn teammates_discover_only_the_bound_computer_without_admin_details() {
    let member = user("macro|member@example.com");
    let mut setup = Setup::default();
    setup.flags.as_mut().unwrap().set(
        member.clone(),
        Ok(FlagSnapshot::new([(
            TEAM_AGENTS_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    let (mut service, _) = build(setup);
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
