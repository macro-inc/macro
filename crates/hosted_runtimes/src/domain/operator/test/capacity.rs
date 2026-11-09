use super::*;

#[tokio::test]
async fn make_room_reports_unavailable_and_ignores_a_completed_wake() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state.phase = Phase::Stopped { host: HOST };
        computer.state.wake_requested = true;
    }
    let event = operator
        .carry_out(id, &Effect::MakeRoom { host: HOST })
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        serde_json::json!({"event":"room_unavailable"})
    );
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state.phase = Phase::Running { host: HOST };
        computer.state.wake_requested = false;
    }
    assert_eq!(
        operator
            .carry_out(id, &Effect::MakeRoom { host: HOST })
            .await
            .unwrap(),
        None
    );
}
