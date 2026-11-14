//! NEURAL: the nervous system alone, lit up. A dense brain of folded
//! cortex, the cord, and a branching network reaching every finger and toe,
//! over a faint skeleton and a ghost of skin. Nerves fire in groups, so a
//! pulse runs down a limb and forks at the elbow and again at the wrist.

use std::f32::consts::{PI, TAU};

use glam::Vec3;

use super::common::{
    BRAIN, Branching, Draft, HEAD, HEART, Rng, SPINE, Seg, Side, cord_to, ellipse, frame,
    limbs, line, profile_at, ring, simple_bones, spine_at, sprout, torso_at,
};
use crate::figure::Core;
use crate::palette::Look;

/// Twig paths per limb that join its fork group, so pulses spray into the
/// tree as well as along the main nerves.
const TWIGS_PER_GROUP: usize = 3;

pub(crate) fn build() -> Draft {
    let sides = Side::both();
    let mut draft = Draft {
        core: Some(Core::Heart(HEART)),
        look: Look::Neural,
        ..Draft::default()
    };

    ghost_skin(&mut draft.skin, &sides);
    line(&mut draft.bones, &SPINE);
    for side in &sides {
        simple_bones(&mut draft.bones, side);
    }
    ring(
        &mut draft.bones,
        &ellipse(HEAD + Vec3::Y * 0.01, Vec3::X, Vec3::Y, (0.075, 0.1), 14),
    );
    network(&mut draft, &sides);
    draft.brain = brain();
    draft
}

/// A ghost of the skin: sparse rings and four outline lines a limb.
fn ghost_skin(out: &mut Vec<Seg>, sides: &[Side; 2]) {
    let mut y = -0.08;
    while y <= 0.74 {
        let (rx, rz, z) = torso_at(y);
        ring(
            out,
            &ellipse(Vec3::new(0.0, y, z), Vec3::X, Vec3::Z, (rx, rz), 14),
        );
        y += 0.12;
    }
    ring(
        out,
        &ellipse(HEAD, Vec3::X, Vec3::Z, (0.085, 0.1), 12),
    );
    for side in sides {
        for (a, b, reference, profile) in limbs(side) {
            let (u, v) = frame(b - a, reference);
            for (k, dir) in [u, v, -u, -v].into_iter().enumerate() {
                let points: Vec<Vec3> = (0..=4)
                    .map(|i| {
                        let t = i as f32 / 4.0;
                        let (ru, rv) = profile_at(profile, t);
                        let radius = if k % 2 == 0 { ru } else { rv };
                        a.lerp(b, t) + dir * radius
                    })
                    .collect();
                line(out, &points);
            }
        }
    }
}

/// One limb's nerves: a trunk that splits at `split` into three, each
/// splitting again at `hub` into the tips.
struct Limb {
    name: &'static str,
    trunk: Vec<Vec3>,
    split: Vec3,
    hubs: [Vec3; 3],
    /// Tips by branch.
    tips: [Vec<Vec3>; 3],
    labels: [&'static str; 3],
}

fn arm(side: &Side) -> Limb {
    let s = side.s;
    let tips = side.fingertips();
    let mut trunk = cord_to(0.64);
    trunk.extend([
        Vec3::new(s * 0.10, 0.63, -0.03),
        Vec3::new(s * 0.185, 0.60, -0.02),
        side.shoulder.lerp(side.elbow, 0.5) + Vec3::new(0.0, 0.0, 0.0),
    ]);
    let wrist = |dz: f32| side.wrist + Vec3::new(0.0, 0.0, dz);
    Limb {
        name: "arm",
        trunk,
        split: side.elbow + Vec3::new(0.0, 0.02, 0.0),
        hubs: [wrist(0.02), wrist(0.0), wrist(-0.02)],
        tips: [vec![tips[0], tips[1]], vec![tips[2]], vec![tips[3], tips[4]]],
        labels: ["radial", "median", "ulnar"],
    }
}

fn leg(side: &Side) -> Limb {
    let s = side.s;
    let toes = side.toe_tips();
    let mut trunk = cord_to(0.06);
    trunk.extend([
        Vec3::new(s * 0.04, 0.06, -0.06),
        Vec3::new(s * 0.09, -0.08, -0.05),
        side.hip.lerp(side.knee, 0.5) + Vec3::new(0.0, 0.0, -0.02),
    ]);
    let ankle = |dx: f32, dz: f32| side.ankle + Vec3::new(s * dx, 0.0, dz);
    Limb {
        name: "leg",
        trunk,
        split: side.knee + Vec3::new(0.0, 0.03, -0.02),
        hubs: [ankle(-0.015, 0.02), ankle(0.0, -0.03), ankle(0.02, 0.01)],
        tips: [vec![toes[0], toes[1]], vec![side.heel], vec![toes[3], toes[4]]],
        labels: ["femoral", "tibial", "peroneal"],
    }
}

fn network(draft: &mut Draft, sides: &[Side; 2]) {
    let mut rng = Rng::new(0x0e0_7a1);
    let dense = Branching {
        spacing: 0.045,
        chance: 0.6,
        length: 0.055,
        shrink: 0.68,
        depth: 3,
        angle: (0.4, 1.0),
        reach: 0.05,
    };

    // The cord, with a pair of spinal nerves at each level.
    let cord = cord_to(0.0);
    line(&mut draft.nerves, &cord);
    draft.paths.push(("spinal_cord".to_owned(), cord));

    for side in sides {
        for limb in [arm(side), leg(side)] {
            let mut group = Vec::new();
            let own_from = limb.trunk.len().saturating_sub(3);
            let own = limb.trunk.get(own_from..).unwrap_or(&[]).to_vec();
            line(&mut draft.nerves, &own);
            line(&mut draft.nerves, &[*own.last().unwrap_or(&limb.split), limb.split]);

            for ((hub, tips), label) in limb.hubs.iter().zip(&limb.tips).zip(limb.labels) {
                line(&mut draft.nerves, &[limb.split, *hub]);
                for (k, tip) in tips.iter().enumerate() {
                    line(&mut draft.nerves, &[*hub, *tip]);
                    let mut points = limb.trunk.clone();
                    points.extend([limb.split, *hub, *tip]);
                    let name = if k == 0 {
                        side.name(label)
                    } else {
                        side.name(&format!("{label}_{k}"))
                    };
                    group.push(draft.paths.len());
                    draft.paths.push((name, points));
                }

                // A dense tree off this branch; a few of its leaves carry
                // pulses too.
                let mut leaves = Vec::new();
                sprout(
                    &[limb.split, *hub],
                    Branching {
                        reach: if limb.name == "arm" { 0.035 } else { 0.05 },
                        ..dense
                    },
                    &mut rng,
                    &mut draft.nerves,
                    &mut leaves,
                );
                let step = (leaves.len() / TWIGS_PER_GROUP).max(1);
                for (k, leaf) in leaves.iter().step_by(step).take(TWIGS_PER_GROUP).enumerate() {
                    let mut points = limb.trunk.clone();
                    points.push(limb.split);
                    points.extend(leaf.iter().copied());
                    group.push(draft.paths.len());
                    draft
                        .paths
                        .push((side.name(&format!("{label}_twig_{k}")), points));
                }
            }

            // And off the trunk itself.
            let mut leaves = Vec::new();
            sprout(&own, dense, &mut rng, &mut draft.nerves, &mut leaves);
            draft.forks.push(group);
        }
    }

    // Intercostal pairs: both sides fire together, forking at the cord.
    for level in 0..6 {
        let back_y = 0.6 - level as f32 * 0.045;
        let width = 0.11 + 0.035 * (level as f32 * 0.6).sin();
        let mut group = Vec::new();
        for side in sides {
            let s = side.s;
            let mut rib: Vec<Vec3> = (0..8)
                .map(|k| {
                    let theta = k as f32 / 7.0 * PI * 0.85;
                    let around = (1.0 - theta.cos()) / 2.0;
                    Vec3::new(
                        s * width * theta.sin(),
                        back_y - 0.065 * around,
                        0.0 - 0.085 * theta.cos(),
                    )
                })
                .collect();
            if let Some(first) = rib.first_mut() {
                *first = spine_at(back_y);
            }
            line(&mut draft.nerves, &rib);
            let mut leaves = Vec::new();
            sprout(
                &rib,
                Branching {
                    chance: 0.5,
                    length: 0.035,
                    depth: 2,
                    reach: 0.03,
                    ..dense
                },
                &mut rng,
                &mut draft.nerves,
                &mut leaves,
            );
            let mut points = cord_to(back_y);
            points.extend(rib.iter().skip(1));
            group.push(draft.paths.len());
            draft
                .paths
                .push((side.name(&format!("intercostal_{}", level + 1)), points));
        }
        draft.forks.push(group);
    }

    // Cranial nerves: optic, facial fans, and the vagus to the heart.
    for side in sides {
        let s = side.s;
        let mut group = Vec::new();
        for (name, rest) in [
            (
                "optic",
                vec![Vec3::new(s * 0.022, 0.89, 0.045), Vec3::new(s * 0.032, 0.885, 0.085)],
            ),
            (
                "facial",
                vec![Vec3::new(s * 0.06, 0.85, 0.01), Vec3::new(s * 0.05, 0.81, 0.07)],
            ),
            (
                "trigeminal",
                vec![Vec3::new(s * 0.05, 0.87, 0.04), Vec3::new(s * 0.03, 0.84, 0.09)],
            ),
        ] {
            let mut points = vec![BRAIN];
            points.extend(rest);
            line(&mut draft.nerves, &points);
            group.push(draft.paths.len());
            draft.paths.push((side.name(name), points));
        }
        draft.forks.push(group);
    }
    let vagus = vec![
        BRAIN,
        Vec3::new(0.02, 0.80, 0.0),
        Vec3::new(0.03, 0.70, 0.005),
        Vec3::new(0.035, 0.55, 0.035),
        HEART,
    ];
    line(&mut draft.nerves, &vagus);
    draft.paths.push(("vagus".to_owned(), vagus));

    // Twigs off the cord all the way down.
    let mut leaves = Vec::new();
    sprout(
        &cord_to(0.0),
        Branching {
            chance: 0.6,
            reach: 0.06,
            ..dense
        },
        &mut rng,
        &mut draft.nerves,
        &mut leaves,
    );
}

/// Two hemispheres of wavy gyri, a fissure between, the cerebellum and the
/// brain stem.
fn brain() -> Vec<Seg> {
    let mut out = Vec::new();
    for s in [1.0_f32, -1.0] {
        // Folds as wavy latitude loops over each hemisphere.
        for (k, polar) in [0.35_f32, 0.7, 1.05, 1.4, 1.75].into_iter().enumerate() {
            let points: Vec<Vec3> = (0..=20)
                .map(|i| {
                    let a = i as f32 / 20.0 * PI;
                    let wobble = 1.0 + 0.16 * (a * (7.0 + k as f32) + s).sin();
                    let r = polar.sin() * wobble;
                    Vec3::new(
                        s * (0.006 + 0.058 * r * a.sin()),
                        0.885 + 0.075 * polar.cos(),
                        -0.005 + 0.08 * r * a.cos(),
                    )
                })
                .collect();
            line(&mut out, &points);
        }
        // Sulci across: wavy meridians.
        for m in 0..5 {
            let azimuth = (m as f32 + 0.5) / 5.0 * PI;
            let points: Vec<Vec3> = (0..=10)
                .map(|i| {
                    let polar = 0.2 + i as f32 / 10.0 * 1.6;
                    let wobble = 1.0 + 0.1 * (polar * 9.0 + m as f32).sin();
                    Vec3::new(
                        s * (0.006 + 0.058 * polar.sin() * azimuth.sin() * wobble),
                        0.885 + 0.075 * polar.cos(),
                        -0.005 + 0.08 * polar.sin() * azimuth.cos() * wobble,
                    )
                })
                .collect();
            line(&mut out, &points);
        }
    }
    // Cerebellum: tight stacked loops at the back, and the stem.
    for k in 0..3 {
        ring(
            &mut out,
            &ellipse(
                Vec3::new(0.0, 0.835 + 0.008 * k as f32, -0.055),
                Vec3::X,
                Vec3::Z,
                (0.042 - 0.008 * k as f32, 0.025 - 0.004 * k as f32),
                12,
            ),
        );
    }
    line(
        &mut out,
        &[BRAIN, Vec3::new(0.0, 0.85, -0.025), SPINE[0]],
    );
    let _ = TAU;
    out
}
