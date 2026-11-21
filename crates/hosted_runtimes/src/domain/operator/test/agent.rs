use super::*;
use crate::domain::enrollment::ComputerRole;

fn ada() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|ada-1@agents.macro.invalid".to_owned()).unwrap()
}

/// An agent computer's enrollment says only that it is one: the agent's
/// credentials never ride in it, they arrive over macrod's socket.
#[tokio::test]
async fn an_agent_computer_enrolls_as_an_agent_computer_without_credentials() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.repo.agents.lock().unwrap().insert(id, ada());

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments.len(), 1);
    assert_eq!(enrollments[0].0.role, ComputerRole::Agent);
    let wire = serde_json::to_value(&enrollments[0].0).unwrap();
    assert_eq!(wire["role"], "agent");
    assert!(wire.get("agent").is_none());
}

#[tokio::test]
async fn a_person_computer_enrolls_as_a_person_computer() {
    let operator = operator(FakeFleet::default()).await;
    paid_computer(&operator).await;

    operator.run_fleet_effects().await.unwrap();

    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments[0].0.role, ComputerRole::Person);
}

/// A booting agent computer whose macrod just connected on [`HARNESS`].
async fn connected_agent_computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
) -> ComputerId {
    let id = paid_computer(operator).await;
    operator.repo.agents.lock().unwrap().insert(id, ada());
    operator.run_fleet_effects().await.unwrap();
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.harness_id = Some(HARNESS);
        computer.state.awaiting_agent = true;
        computer.state.phase = crate::domain::lifecycle::Phase::Booting;
    }
    operator
        .repo
        .apply(id, crate::domain::lifecycle::Event::MacrodConnected, now())
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn a_connected_agent_computer_gets_its_agent_handed_over() {
    let operator = operator(FakeFleet::default()).await;
    let id = connected_agent_computer(&operator).await;

    operator.run_fleet_effects().await.unwrap();

    let generation = operator.repo.computers.lock().unwrap()[&id].enrollment_generation;
    assert_eq!(
        *operator.harnesses.delivered_agents.lock().unwrap(),
        vec![(HARNESS, id, generation)]
    );
}

/// The hand-off is timed to when macrod took the agent, not to when the
/// hand-off was queued on the connection.
#[tokio::test]
async fn the_agent_counts_as_delivered_once_macrod_took_it() {
    let operator = operator(FakeFleet::default()).await;
    let id = connected_agent_computer(&operator).await;
    let delivered_at = || {
        operator.repo.computers.lock().unwrap()[&id]
            .state
            .setup
            .as_ref()
            .and_then(|setup| setup.agent_delivered_at)
    };
    assert!(
        operator.repo.computers.lock().unwrap()[&id]
            .state
            .setup
            .as_ref()
            .is_some_and(|setup| setup.connected_at.is_some())
    );
    assert_eq!(delivered_at(), None);

    operator.run_fleet_effects().await.unwrap();

    assert!(delivered_at().is_some());
}

#[tokio::test]
async fn an_agent_already_online_is_not_handed_over_again() {
    let operator = operator(FakeFleet::default()).await;
    let id = connected_agent_computer(&operator).await;
    operator
        .repo
        .apply(id, crate::domain::lifecycle::Event::AgentOnline, now())
        .await
        .unwrap();

    operator.run_fleet_effects().await.unwrap();

    assert!(
        operator
            .harnesses
            .delivered_agents
            .lock()
            .unwrap()
            .is_empty()
    );
}

/// A macrod too old to take an agent fails the agent computer's start the
/// moment it connects, instead of at the agent's start deadline.
#[tokio::test]
async fn an_agent_computer_whose_macrod_cannot_take_an_agent_gives_up_on_connect() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.repo.agents.lock().unwrap().insert(id, ada());
    operator.run_fleet_effects().await.unwrap();
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.harness_id = Some(HARNESS);
        computer.state.awaiting_agent = true;
        computer.state.phase = crate::domain::lifecycle::Phase::Booting;
    }

    assert!(
        operator
            .macrod_connected(HARNESS, false)
            .await
            .unwrap()
            .is_computer()
    );
    operator.run_fleet_effects().await.unwrap();

    let state = operator.repo.computers.lock().unwrap()[&id].state.clone();
    assert_eq!(
        state.failure,
        Some(crate::domain::lifecycle::Failure::AgentUnsupported)
    );
    assert!(
        operator
            .harnesses
            .delivered_agents
            .lock()
            .unwrap()
            .is_empty()
    );
}
