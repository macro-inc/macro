use super::*;
use hosted_runtimes::domain::service::Clock;
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> chrono::DateTime<Utc> {
        Utc.timestamp_opt(1_700_000_100, 0).unwrap()
    }
}

#[tokio::test]
async fn initial_brain_health_grace_is_bounded_and_preserves_connecting() {
    let mut unavailable = healthy_brain();
    unavailable.healthy = false;
    unavailable.last_turn_at = None;
    unavailable.last_error = Some("brain health endpoint is unavailable".to_string());
    for brain in [None, Some(unavailable)] {
        let (service, _) = build(Setup::default());
        let service = service.with_clock(FixedClock);
        let mut agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
        agent.created_at = FixedClock.now() - chrono::Duration::seconds(30);
        let computer = ComputerStatus {
            payment: ComputerPayment::Comped,
            status: ComputerStatusKind::Ready,
            setup: None,
            brain,
        };
        let waiting = service
            .apply_computer_status(agent.clone(), computer.clone())
            .await
            .unwrap();
        assert_eq!(waiting.status, TeamAgentStatus::Provisioning);
        assert_eq!(waiting.status_reason, None);
        assert_eq!(
            waiting.setup,
            Some(SetupProgress {
                step: SetupStep::Connecting,
                position: 3,
                total: 4,
            })
        );
        assert_eq!(
            service
                .repository
                .get(&agent.user_id)
                .await
                .unwrap()
                .unwrap()
                .status,
            TeamAgentStatus::Provisioning
        );
        let mut expired = agent.clone();
        expired.created_at = FixedClock.now() - chrono::Duration::minutes(3);
        let failed = service
            .apply_computer_status(expired, computer)
            .await
            .unwrap();
        assert_eq!(failed.status, TeamAgentStatus::Unhealthy);
        assert!(failed.setup.is_none());
    }
}

#[tokio::test]
async fn initial_brain_health_grace_never_hides_loss_after_healthy() {
    let (service, _) = build(Setup::default());
    let service = service.with_clock(FixedClock);
    let mut agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    agent.created_at = FixedClock.now();
    let mut healthy = healthy_brain();
    healthy.checked_at = FixedClock.now();
    let computer = ComputerStatus {
        payment: ComputerPayment::Comped,
        status: ComputerStatusKind::Ready,
        setup: None,
        brain: Some(healthy),
    };
    let running = service
        .apply_computer_status(agent, computer.clone())
        .await
        .unwrap();
    assert_eq!(running.status, TeamAgentStatus::Running);
    let mut problem = healthy_brain();
    problem.checked_at = FixedClock.now();
    problem.healthy = false;
    problem.last_error = Some("brain process exited".to_string());
    for brain in [None, Some(problem)] {
        let failed = service
            .apply_computer_status(
                running.clone(),
                ComputerStatus {
                    brain,
                    ..computer.clone()
                },
            )
            .await
            .unwrap();
        assert_eq!(failed.status, TeamAgentStatus::Unhealthy);
        assert!(failed.setup.is_none());
    }
}

#[tokio::test]
async fn initial_brain_health_grace_does_not_hide_reported_problems() {
    let (service, _) = build(Setup::default());
    let service = service.with_clock(FixedClock);
    let mut agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    agent.created_at = FixedClock.now();
    let mut brain = healthy_brain();
    brain.checked_at = FixedClock.now();
    brain.healthy = false;
    brain.last_error = Some("workspace clone failed".to_string());
    let failed = service
        .apply_computer_status(
            agent,
            ComputerStatus {
                payment: ComputerPayment::Comped,
                status: ComputerStatusKind::Ready,
                setup: None,
                brain: Some(brain),
            },
        )
        .await
        .unwrap();
    assert_eq!(failed.status, TeamAgentStatus::Unhealthy);
    assert_eq!(
        failed.status_reason.as_deref(),
        Some("unhealthy: workspace clone failed")
    );
}
