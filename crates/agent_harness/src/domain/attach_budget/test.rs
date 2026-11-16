use super::*;
use futures::FutureExt as _;

const HARNESS_C: HarnessId = HarnessId::new_from_uuid(uuid::Uuid::from_u128(0x4A125C));

#[tokio::test]
async fn a_prompt_attaches_while_background_work_fills_its_share() {
    let budget = AttachBudget::default();
    let mut held = Vec::new();
    for harness in [HarnessId::TEST_A, HarnessId::TEST_B, HARNESS_C] {
        for _ in 0..2 {
            held.push(
                budget
                    .acquire(AttachPath::Dial, harness, AgentSessionId::new())
                    .await
                    .unwrap(),
            );
        }
    }

    assert!(
        budget
            .acquire(AttachPath::Delivery, HARNESS_C, AgentSessionId::new())
            .now_or_never()
            .is_none(),
        "background work may hold only {} permits",
        ATTACH_CONCURRENCY - USER_RESERVED_ATTACHES
    );
    let first = budget
        .acquire(AttachPath::Prompt, HarnessId::TEST_A, AgentSessionId::new())
        .now_or_never()
        .expect("a prompt takes a reserved permit")
        .unwrap();
    let second = budget
        .acquire(AttachPath::Prompt, HarnessId::TEST_A, AgentSessionId::new())
        .now_or_never()
        .expect("a prompt skips its harness's share")
        .unwrap();
    assert!(
        budget
            .acquire(AttachPath::Prompt, HarnessId::TEST_B, AgentSessionId::new())
            .now_or_never()
            .is_none(),
        "no attach exceeds the total"
    );
    drop((first, second, held));
}

#[tokio::test]
async fn one_harness_cannot_starve_another() {
    let budget = AttachBudget::default();
    let mut held = Vec::new();
    for _ in 0..HARNESS_ATTACH_SHARE {
        held.push(
            budget
                .acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new())
                .await
                .unwrap(),
        );
    }
    let mut queued =
        Box::pin(budget.acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new()));
    assert!((&mut queued).now_or_never().is_none());

    let other = budget
        .acquire(
            AttachPath::Recovery,
            HarnessId::TEST_B,
            AgentSessionId::new(),
        )
        .now_or_never()
        .expect("another harness's attach is not queued behind the first's")
        .unwrap();

    held.pop();
    let next = queued.await.unwrap();
    drop((next, other, held));
}

#[tokio::test]
async fn dropping_permits_returns_them_and_forgets_idle_harnesses() {
    let budget = AttachBudget::default();
    let dial = budget
        .acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new())
        .await
        .unwrap();
    let prompt = budget
        .acquire(AttachPath::Prompt, HarnessId::TEST_B, AgentSessionId::new())
        .await
        .unwrap();
    assert_eq!(budget.available(), ATTACH_CONCURRENCY - 2);
    assert_eq!(budget.tracked_harnesses(), 1);

    drop(dial);
    drop(prompt);
    assert_eq!(budget.available(), ATTACH_CONCURRENCY);
    assert_eq!(budget.tracked_harnesses(), 0);
}

#[tokio::test]
async fn a_cancelled_wait_gives_back_what_it_took() {
    let budget = AttachBudget::new(1, 0, 1, ATTACH_PERMIT_HOLD);
    let held = budget
        .acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new())
        .await
        .unwrap();
    assert!(
        budget
            .acquire(AttachPath::Dial, HarnessId::TEST_B, AgentSessionId::new())
            .now_or_never()
            .is_none()
    );

    drop(held);
    let after = budget
        .acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new())
        .now_or_never()
        .expect("the abandoned waiter kept nothing")
        .unwrap();
    drop(after);
}

#[tokio::test(start_paused = true)]
async fn a_restore_that_never_answers_releases_its_permit() {
    let budget = AttachBudget::new(1, 0, 1, ATTACH_PERMIT_HOLD);
    let permit = budget
        .acquire(AttachPath::Dial, HarnessId::TEST_A, AgentSessionId::new())
        .await
        .unwrap();

    let started = tokio::time::Instant::now();
    let outcome = permit.hold_until(futures::future::pending::<()>()).await;

    assert_eq!(outcome, None);
    assert_eq!(started.elapsed(), ATTACH_PERMIT_HOLD);
    assert_eq!(budget.available(), 1);
    assert_eq!(budget.tracked_harnesses(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_restore_in_time_answers_and_releases() {
    let budget = AttachBudget::default();
    let permit = budget
        .acquire(AttachPath::Prompt, HarnessId::TEST_A, AgentSessionId::new())
        .await
        .unwrap();

    let outcome = permit.hold_until(async { true }).await;

    assert_eq!(outcome, Some(true));
    assert_eq!(budget.available(), ATTACH_CONCURRENCY);
}
