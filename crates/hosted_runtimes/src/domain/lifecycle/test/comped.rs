use super::*;

#[test]
fn comped_lifecycle_never_removes_subscription_items() {
    let reason = "internal team".to_owned();
    for host_has_room in [true, false] {
        let context = Context {
            enrollment_generation: crate::domain::persona_credentials::EnrollmentGeneration::new(0),
            now: now(),
            host_has_room,
        };
        let (comped, effects) = transition(
            &ComputerState::reserved(HOST, now()),
            &Event::Comped {
                reason: reason.clone(),
            },
            context,
        );
        assert_eq!(
            comped.phase,
            Phase::Provisioning {
                host: HOST,
                start: host_has_room,
            }
        );
        assert_eq!(comped.payment, PaymentOutcome::Comped);
        assert_eq!(comped.comp_reason.as_deref(), Some("internal team"));
        assert_eq!(
            effects,
            vec![Effect::Create {
                host: HOST,
                start: host_has_room,
                generation: crate::domain::persona_credentials::EnrollmentGeneration::new(1),
            }]
        );

        for (event, destroyed, canceled) in [
            (Event::ReleaseNow, true, false),
            (
                Event::CancelAtPeriodEnd {
                    at: now() + Duration::days(20),
                },
                false,
                true,
            ),
            (Event::SubscriptionCanceled, false, false),
            (Event::PeriodEnded, false, false),
            (Event::PaymentConfirmed, false, false),
            (
                Event::Comped {
                    reason: "late change".to_owned(),
                },
                false,
                false,
            ),
        ] {
            let (next, effects) = transition(&comped, &event, context);
            assert_eq!(next.payment, PaymentOutcome::Comped);
            assert_eq!(next.comp_reason, comped.comp_reason);
            assert_eq!(next.phase == Phase::Destroyed, destroyed);
            assert!(!effects.contains(&Effect::RemoveBillingItem));
            if canceled {
                assert_eq!(
                    next.billing,
                    Billing::Canceled {
                        retained_until: now() + RETENTION
                    }
                );
                assert_eq!(next.power, Power::Off);
                let (expired, effects) = transition(&next, &Event::RetentionExpired, context);
                assert_eq!(expired.phase, Phase::Destroyed);
                assert!(!effects.contains(&Effect::RemoveBillingItem));
            } else if !destroyed {
                assert_eq!(next, comped);
            }
        }
    }
}
