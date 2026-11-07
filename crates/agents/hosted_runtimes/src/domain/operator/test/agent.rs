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
