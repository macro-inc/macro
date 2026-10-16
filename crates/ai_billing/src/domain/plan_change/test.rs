use super::*;
use chrono::Duration;

fn record(from: PlanTier, to: PlanTier, seconds: i64) -> RecordedPlanChange {
    let start = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    let allowance = |plan| match plan {
        PlanTier::Free => None,
        PlanTier::Premium => Some(2_000),
        PlanTier::Max => Some(10_000),
    };
    RecordedPlanChange {
        change: PlanChange {
            from,
            to,
            at: start + Duration::seconds(seconds),
            period: BillingPeriod {
                start,
                end: start + Duration::days(30),
            },
        },
        previous_included_cents: allowance(from),
        new_included_cents: allowance(to),
    }
}
fn segment(seconds: i64, usd: f64) -> PlanUsageSegment {
    PlanUsageSegment {
        start: record(PlanTier::Free, PlanTier::Premium, seconds).change.at,
        usd,
    }
}
#[test]
fn free_pro_max_each_new_highest_resets_and_preserves_prior_overage() {
    let changes = [
        record(PlanTier::Free, PlanTier::Premium, 10),
        record(PlanTier::Premium, PlanTier::Max, 20),
    ];
    let costs = [segment(0, 80.0), segment(10, 22.0), segment(20, 105.0)];
    assert_eq!(
        meter_plan_usage(&changes, &costs, false),
        PlanUsage {
            used_cents: 10_500,
            chargeable_cents: 700
        }
    );
    assert_eq!(
        meter_plan_usage(&changes, &costs, true),
        PlanUsage {
            used_cents: 10_500,
            chargeable_cents: 500
        }
    );
}
#[test]
fn max_pro_max_cannot_replenish_or_reclassify_prior_max_costs() {
    let changes = [
        record(PlanTier::Max, PlanTier::Premium, 10),
        record(PlanTier::Premium, PlanTier::Max, 20),
    ];
    assert_eq!(
        meter_plan_usage(
            &changes,
            &[segment(0, 80.0), segment(10, 0.0), segment(20, 0.0)],
            false
        ),
        PlanUsage {
            used_cents: 8_000,
            chargeable_cents: 0
        }
    );
    assert_eq!(
        meter_plan_usage(
            &changes,
            &[segment(0, 80.0), segment(10, 1.0), segment(20, 25.0)],
            false
        ),
        PlanUsage {
            used_cents: 10_600,
            chargeable_cents: 700
        }
    );
}
#[test]
fn max_free_max_retains_consumption_without_charging_free_costs() {
    let changes = [
        record(PlanTier::Max, PlanTier::Free, 10),
        record(PlanTier::Free, PlanTier::Max, 20),
    ];
    assert_eq!(
        meter_plan_usage(
            &changes,
            &[segment(0, 80.0), segment(10, 5.0), segment(20, 20.0)],
            false
        ),
        PlanUsage {
            used_cents: 10_500,
            chargeable_cents: 500
        }
    );
}
#[test]
fn previous_cycle_max_does_not_block_a_new_cycle_pro_max_upgrade() {
    let changes = [
        record(PlanTier::Max, PlanTier::Premium, 0),
        record(PlanTier::Premium, PlanTier::Max, 10),
    ];
    assert_eq!(
        meter_plan_usage(&changes, &[segment(0, 15.0), segment(10, 2.0)], false),
        PlanUsage {
            used_cents: 200,
            chargeable_cents: 0
        }
    );
}
#[test]
fn repeated_upgrade_fact_cannot_reset_new_usage() {
    let changes = [
        record(PlanTier::Premium, PlanTier::Max, 10),
        record(PlanTier::Premium, PlanTier::Max, 20),
    ];
    assert_eq!(
        meter_plan_usage(
            &changes,
            &[segment(0, 15.0), segment(10, 2.0), segment(20, 1.0)],
            false
        ),
        PlanUsage {
            used_cents: 300,
            chargeable_cents: 0
        }
    );
}

#[test]
fn renewal_downgrade_starts_fresh_public_pro_funding() {
    let changes = [record(PlanTier::Max, PlanTier::Premium, 0)];
    assert_eq!(
        meter_plan_usage(&changes, &[segment(0, 22.0)], true),
        PlanUsage {
            used_cents: 2_200,
            chargeable_cents: 0
        }
    );
}
