use super::*;

fn task() -> MessageParent {
    MessageParent::parse("document", "assigned-task").unwrap()
}

fn assignment_service(facts: impl Into<FactMocks>, history: MockThreadHistory) -> TestService {
    let (replies, judge) = no_implicit();
    service_reading(MockAgentSessionRepo::new(), facts, replies, judge, history)
}

fn allowed_history() -> MockThreadHistory {
    let mut history = MockThreadHistory::new();
    history
        .expect_authorize_invocation()
        .once()
        .withf(|caller, parent, root| {
            caller == &user() && parent == &task() && *root == Uuid::from_u128(3)
        })
        .returning(allow_invocation);
    history
}

#[tokio::test]
async fn owners_can_assign_their_agents_without_channel_participation() {
    for scope in [AgentChannelScope::All, AgentChannelScope::Selected] {
        let mut bots = MockAgentBotLookup::new();
        bots.expect_get_agent()
            .once()
            .with(mockall::predicate::eq(BotId::TEST_A))
            .return_once(move |id| {
                Box::pin(async move {
                    let mut agent = private_agent(id);
                    agent.channel_scope = scope;
                    Ok(Some(agent))
                })
            });
        let service = assignment_service(bots, allowed_history());

        let invocation = service
            .authorize_task_assignment(&user(), &task(), Uuid::from_u128(3), BotId::TEST_A)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(invocation.root_id, Uuid::from_u128(3));
        assert_eq!(invocation.access.entity().entity_id, "assigned-task");
    }
}

#[tokio::test]
async fn another_users_private_agent_cannot_be_assigned() {
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|id| Box::pin(async move { Ok(Some(private_agent(id))) }));
    let service = assignment_service(bots, MockThreadHistory::new());

    assert!(
        service
            .authorize_task_assignment(
                &MacroUserIdStr::try_from_email("another@example.com").unwrap(),
                &task(),
                Uuid::from_u128(3),
                BotId::TEST_A,
            )
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn team_agents_require_current_team_membership() {
    for member in [true, false] {
        let team_id = Uuid::from_u128(99);
        let mut facts = FactMocks::from(MockAgentBotLookup::new());
        facts.bots.expect_get_agent().once().return_once(move |id| {
            Box::pin(async move {
                Ok(Some(agent_with(
                    id,
                    BotOwner::Team { team_id },
                    AgentChannelScope::Selected,
                )))
            })
        });
        facts
            .teams
            .expect_user_has_team()
            .once()
            .with(
                mockall::predicate::eq(user()),
                mockall::predicate::eq(team_id),
            )
            .return_once(move |_, _| Box::pin(async move { Ok(member) }));
        let history = if member {
            allowed_history()
        } else {
            MockThreadHistory::new()
        };
        let service = assignment_service(facts, history);

        assert_eq!(
            service
                .authorize_task_assignment(&user(), &task(), Uuid::from_u128(3), BotId::TEST_A)
                .await
                .unwrap()
                .is_some(),
            member
        );
    }
}

#[tokio::test]
async fn system_agents_can_be_assigned_without_membership_checks() {
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_bot()
        .once()
        .return_once(|id| Box::pin(async move { Ok(Some(system_bot(id))) }));
    let service = assignment_service(bots, allowed_history());

    assert!(
        service
            .authorize_task_assignment(&user(), &task(), Uuid::from_u128(3), BotId::TEST_A)
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn revoked_task_access_prevents_an_assignment_from_starting() {
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|id| Box::pin(async move { Ok(Some(private_agent(id))) }));
    let mut history = MockThreadHistory::new();
    history
        .expect_authorize_invocation()
        .once()
        .withf(|caller, parent, root| {
            caller == &user() && parent == &task() && *root == Uuid::from_u128(3)
        })
        .return_once(|_, _, _| Box::pin(async { Ok(None) }));
    let service = assignment_service(bots, history);

    assert!(
        service
            .authorize_task_assignment(&user(), &task(), Uuid::from_u128(3), BotId::TEST_A)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn assignments_cannot_target_channels() {
    let service = assignment_service(MockAgentBotLookup::new(), MockThreadHistory::new());

    assert!(
        service
            .authorize_task_assignment(
                &user(),
                &MessageParent::Channel(Uuid::from_u128(1)),
                Uuid::from_u128(3),
                BotId::TEST_A,
            )
            .await
            .unwrap()
            .is_none()
    );
}
