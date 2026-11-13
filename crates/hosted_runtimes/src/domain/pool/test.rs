use super::*;

use crate::domain::lifecycle::Billing;
use crate::domain::service::test::computer;

const ONE_STANDARD: PoolTargets = PoolTargets {
    standard: 1,
    large: 0,
    xl: 0,
};

fn image(name: &str) -> GuestImage {
    GuestImage::try_new(name).unwrap()
}

fn id(value: u128) -> ComputerId {
    ComputerId::new_from_uuid(uuid::Uuid::from_u128(value))
}

/// A pool computer in `phase`, created from `built` (`None` while creating).
fn member(value: u128, phase: Phase, built: Option<&str>) -> Computer {
    let mut member = computer(id(value), phase, Billing::Pool);
    member.image = built.map(image);
    member
}

#[test]
fn an_empty_pool_creates_one_standard_computer() {
    assert_eq!(
        plan(ONE_STANDARD, &image("macro-box/2026-11-13"), &[]),
        PoolPlan {
            drain: vec![],
            create: vec![ComputerSize::Standard],
        }
    );
}

#[test]
fn plans_each_pool() {
    let current = "macro-box/2026-11-13";
    let cases = [
        (
            "a ready computer on the current image is kept",
            ONE_STANDARD,
            vec![member(1, Phase::Running, Some(current))],
            PoolPlan::default(),
        ),
        (
            "one still being created counts, so nothing is created twice",
            ONE_STANDARD,
            vec![member(1, Phase::Provisioning { start: true }, None)],
            PoolPlan::default(),
        ),
        (
            "one on an older image is drained and replaced",
            ONE_STANDARD,
            vec![member(1, Phase::Running, Some("macro-box/2026-11-01"))],
            PoolPlan {
                drain: vec![id(1)],
                create: vec![ComputerSize::Standard],
            },
        ),
        (
            "one that gave up is drained and replaced",
            ONE_STANDARD,
            vec![member(
                1,
                Phase::Crashed {
                    restarts: 3,
                    retry: None,
                },
                Some(current),
            )],
            PoolPlan {
                drain: vec![id(1)],
                create: vec![ComputerSize::Standard],
            },
        ),
        (
            "one that is off is drained and replaced",
            ONE_STANDARD,
            vec![member(1, Phase::Stopped, Some(current))],
            PoolPlan {
                drain: vec![id(1)],
                create: vec![ComputerSize::Standard],
            },
        ),
        (
            "one restarting after a crash is kept",
            ONE_STANDARD,
            vec![member(
                1,
                Phase::Crashed {
                    restarts: 1,
                    retry: Some(crate::domain::lifecycle::Retry::after(
                        crate::domain::lifecycle::RESTART_BACKOFF,
                        0,
                        crate::domain::fakes::now(),
                    )),
                },
                Some(current),
            )],
            PoolPlan::default(),
        ),
        (
            "members beyond the target are drained, oldest kept",
            ONE_STANDARD,
            vec![
                member(1, Phase::Running, Some(current)),
                member(2, Phase::Running, Some(current)),
            ],
            PoolPlan {
                drain: vec![id(2)],
                create: vec![],
            },
        ),
        (
            "a pool turned off drains everything",
            PoolTargets::NONE,
            vec![member(1, Phase::Running, Some(current))],
            PoolPlan {
                drain: vec![id(1)],
                create: vec![],
            },
        ),
        (
            "every size with a target is filled",
            PoolTargets {
                standard: 2,
                large: 1,
                xl: 0,
            },
            vec![member(1, Phase::Running, Some(current))],
            PoolPlan {
                drain: vec![],
                create: vec![ComputerSize::Standard, ComputerSize::Large],
            },
        ),
    ];
    for (case, targets, members, expected) in cases {
        assert_eq!(plan(targets, &image(current), &members), expected, "{case}");
    }
}
