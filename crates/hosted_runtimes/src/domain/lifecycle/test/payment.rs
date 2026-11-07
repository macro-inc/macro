use super::*;

#[test]
fn payment_resolves_once_and_survives_release() {
    for (event, payment) in [
        (Event::PaymentConfirmed, PaymentOutcome::Paid),
        (Event::PurchaseFailed, PaymentOutcome::Unbilled),
    ] {
        for host_has_room in [true, false] {
            let state = ComputerState::reserved(HOST, now());
            assert_eq!(state.payment, PaymentOutcome::Pending);
            let context = Context {
                enrollment_generation:
                    crate::domain::persona_credentials::EnrollmentGeneration::new(0),
                now: now(),
                host_has_room,
            };
            let (resolved, _) = transition(&state, &event, context);
            assert_eq!(resolved.payment, payment);
            for late_event in [Event::PaymentConfirmed, Event::PurchaseFailed] {
                let (unchanged, effects) = transition(&resolved, &late_event, context);
                assert_eq!(unchanged, resolved);
                assert!(effects.is_empty());
            }
            let (released, effects) = transition(&resolved, &Event::ReleaseNow, context);
            assert_eq!(released.phase, Phase::Destroyed);
            assert_eq!(released.payment, payment);
            assert_eq!(
                effects.contains(&Effect::RemoveBillingItem),
                payment == PaymentOutcome::Paid
            );
            for late_event in [
                Event::PaymentConfirmed,
                Event::PurchaseFailed,
                Event::ReleaseNow,
            ] {
                let (unchanged, effects) = transition(&released, &late_event, context);
                assert_eq!(unchanged, released);
                assert!(effects.is_empty());
            }
        }
    }
}
