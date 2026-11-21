use super::*;

fn round(state: RoundState, released: bool, bytes: u64) -> Round {
    Round {
        state,
        released,
        bytes,
    }
}

#[test]
fn a_running_round_is_waited_for() {
    assert_eq!(
        copy_step(&round(RoundState::Running, false, 0), false, 1),
        CopyStep::Wait
    );
    assert_eq!(
        copy_step(&round(RoundState::Running, true, 0), true, 1),
        CopyStep::Wait
    );
}

#[test]
fn seeding_starts_the_first_round_then_cuts_over_once_a_round_is_small() {
    assert_eq!(
        copy_step(&round(RoundState::Idle, false, 0), false, 0),
        CopyStep::Replicate
    );
    // The seed itself is big: another round.
    assert_eq!(
        copy_step(&round(RoundState::Done, false, 8 << 30), false, 1),
        CopyStep::Replicate
    );
    assert_eq!(
        copy_step(&round(RoundState::Done, false, 33 << 20), false, 2),
        CopyStep::CutOver
    );
}

#[test]
fn a_guest_that_never_converges_cuts_over_after_the_last_seed_round() {
    assert_eq!(
        copy_step(
            &round(RoundState::Done, false, 4 << 30),
            false,
            MAX_SEED_ROUNDS
        ),
        CopyStep::CutOver
    );
}

#[test]
fn a_cutover_adopts_only_after_a_round_that_started_released() {
    // The last seed round finished before the release: not the final one.
    assert_eq!(
        copy_step(&round(RoundState::Done, false, 1 << 20), true, 3),
        CopyStep::Replicate
    );
    assert_eq!(
        copy_step(&round(RoundState::Done, true, 10 << 20), true, 3),
        CopyStep::Adopt
    );
}

#[test]
fn a_failed_or_forgotten_round_is_started_again() {
    assert_eq!(
        copy_step(
            &round(RoundState::Failed("broken pipe".to_owned()), true, 0),
            true,
            3
        ),
        CopyStep::Replicate
    );
    // The source agent restarted and forgot its rounds.
    assert_eq!(
        copy_step(&round(RoundState::Idle, false, 0), true, 3),
        CopyStep::Replicate
    );
}

#[test]
fn only_cutover_and_rollback_hold_the_computer() {
    assert!(MoveStage::CuttingOver.holds_computer());
    assert!(MoveStage::RollingBack.holds_computer());
    assert!(!MoveStage::Seeding.holds_computer());
    assert!(!MoveStage::Verifying.holds_computer());
    assert!(!MoveStage::Committed.is_open());
    assert!(MoveStage::Verifying.is_open());
}

#[test]
fn a_ticket_never_prints() {
    let ticket = MoveTicket::new("secret-ticket".to_owned());
    assert_eq!(format!("{ticket:?}"), "MoveTicket(**redacted**)");
}
