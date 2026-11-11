use super::*;
use chrono::TimeZone;

fn at(seconds: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(1_800_000_000 + seconds, 0).unwrap()
}

#[test]
fn a_paid_purchase_times_payment_create_and_boot() {
    let mut timeline = SetupTimeline::started(at(0));

    assert_eq!(
        timeline.advance(&Phase::Provisioning { start: true }, false, false, at(4)),
        vec![PhaseTiming {
            phase: SetupPhase::Payment,
            started_at: at(0),
            ended_at: at(4),
        }]
    );
    assert_eq!(
        timeline.advance(&Phase::Booting, false, false, at(30)),
        vec![PhaseTiming {
            phase: SetupPhase::Create,
            started_at: at(4),
            ended_at: at(30),
        }]
    );
    assert_eq!(
        timeline.advance(&Phase::Running, true, false, at(95)),
        vec![PhaseTiming {
            phase: SetupPhase::Boot,
            started_at: at(30),
            ended_at: at(95),
        }]
    );
    assert_eq!(timeline.total(), Some((at(0), at(95))));
}

#[test]
fn a_comp_confirmed_at_reservation_has_an_instant_payment_wait() {
    let mut timeline = SetupTimeline::started(at(0));

    assert_eq!(
        timeline.advance(&Phase::Provisioning { start: true }, false, false, at(0)),
        vec![PhaseTiming {
            phase: SetupPhase::Payment,
            started_at: at(0),
            ended_at: at(0),
        }]
    );
}

#[test]
fn macrod_connecting_before_create_completion_closes_create_and_boot_together() {
    let mut timeline = SetupTimeline::started(at(0));
    timeline.advance(&Phase::Provisioning { start: true }, false, false, at(2));

    assert_eq!(
        timeline.advance(&Phase::Provisioning { start: true }, true, false, at(40)),
        vec![
            PhaseTiming {
                phase: SetupPhase::Create,
                started_at: at(2),
                ended_at: at(40),
            },
            PhaseTiming {
                phase: SetupPhase::Boot,
                started_at: at(40),
                ended_at: at(40),
            },
        ]
    );
}

#[test]
fn a_capacity_wait_is_latched_into_the_create_wait() {
    let mut timeline = SetupTimeline::started(at(0));
    timeline.advance(&Phase::Provisioning { start: false }, false, true, at(1));
    timeline.advance(&Phase::Stopped, false, true, at(10));

    assert_eq!(
        timeline.advance(&Phase::Booting, false, false, at(300)),
        vec![PhaseTiming {
            phase: SetupPhase::Create,
            started_at: at(1),
            ended_at: at(300),
        }]
    );
    assert!(timeline.waited_for_capacity);
}

#[test]
fn completed_setup_ignores_later_restarts_and_refused_payment_records_nothing() {
    let mut timeline = SetupTimeline::started(at(0));
    timeline.advance(&Phase::Running, true, false, at(50));
    assert!(timeline.complete());

    assert_eq!(
        timeline.advance(&Phase::Booting, false, false, at(500)),
        vec![]
    );
    assert_eq!(
        timeline.advance(&Phase::Running, true, false, at(600)),
        vec![]
    );
    assert_eq!(timeline.total(), Some((at(0), at(50))));
}

#[test]
fn timelines_round_trip_and_states_without_one_still_decode() {
    let mut timeline = SetupTimeline::started(at(0));
    timeline.advance(&Phase::Booting, false, false, at(9));
    let json = serde_json::to_value(&timeline).unwrap();
    assert_eq!(
        serde_json::from_value::<SetupTimeline>(json).unwrap(),
        timeline
    );

    let untimed = serde_json::json!({
        "phase": { "phase": "running" },
        "power": "on",
        "billing": { "billing": "active", "subscription_item": "si_untimed" },
        "billing_changed_at": "2026-11-04T12:00:00Z",
        "macrod_connected": true,
        "macrod_misses": 0,
        "recent_crashes": [],
        "power_on_requested": false
    });
    let state: crate::domain::lifecycle::ComputerState = serde_json::from_value(untimed).unwrap();
    assert_eq!(state.setup, None);
}
