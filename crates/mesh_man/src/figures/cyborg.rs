//! CYBORG: half human, half machine. His left side keeps a skin mesh and
//! bones; his right is armour plate over truss struts, with pistons at the
//! elbow and knee and gears at the joints. Nerves are circuit traces routed
//! at right angles with a node at every bend, and a reactor glows where the
//! heart would be.

use std::f32::consts::{FRAC_PI_2, PI, TAU};

use glam::Vec3;

use super::common::{
    BRAIN, Draft, HEAD, Rng, SPINE, Seg, Side, TORSO, arc, ellipse, frame, limbs, line, profile_at,
    ring, simple_bones, spine_at,
};
use crate::figure::Core;
use crate::palette::Look;

/// Where the reactor sits, in the middle of the chest.
const REACTOR: Vec3 = Vec3::new(0.0, 0.47, 0.1);
/// Points per skin ring on the human side's limbs.
const LIMB_RING: usize = 8;
/// Sides of an armour plate ring.
const PLATE_SIDES: usize = 6;
/// Half the size of a circuit node.
const NODE: f32 = 0.009;

pub(crate) fn build() -> Draft {
    let [human, machine] = Side::both();
    let mut draft = Draft {
        core: Some(Core::Reactor(REACTOR)),
        look: Look::Cyborg,
        ..Draft::default()
    };

    torso(&mut draft);
    head(&mut draft);
    human_limbs(&mut draft.skin, &human);
    machine_limbs(&mut draft.extra, &machine);
    spine(&mut draft.bones);
    simple_bones(&mut draft.bones, &human);
    machine_bones(&mut draft.bones, &machine);
    circuits(&mut draft, &human, &machine);
    draft.brain = brain();
    draft
}

/// Human half of the torso: half rings with longitudinal lines. Machine
/// half: faceted plates with seams and vents.
fn torso(draft: &mut Draft) {
    let mut flesh: Vec<Vec<Vec3>> = Vec::new();
    let mut steel: Vec<Vec<Vec3>> = Vec::new();
    for &(y, rx, rz, z) in &TORSO {
        let centre = Vec3::new(0.0, y, z);
        flesh.push(arc(
            centre,
            Vec3::X,
            Vec3::Z,
            (rx, rz),
            -FRAC_PI_2,
            FRAC_PI_2,
            6,
        ));
        steel.push(arc(
            centre,
            Vec3::X,
            Vec3::Z,
            (rx * 1.06, rz * 1.06),
            FRAC_PI_2,
            PI + FRAC_PI_2,
            4,
        ));
    }
    for points in &flesh {
        line(&mut draft.skin, points);
    }
    for pair in flesh.windows(2) {
        for (a, b) in pair[0].iter().zip(&pair[1]) {
            draft.skin.push((*a, *b));
        }
    }

    // Plates: a seam at every other section, edges at each facet.
    for (index, points) in steel.iter().enumerate() {
        if index % 2 == 0 || index + 1 == steel.len() {
            line(&mut draft.extra, points);
        }
    }
    for pair in steel.windows(2) {
        for (a, b) in pair[0].iter().zip(&pair[1]) {
            draft.extra.push((*a, *b));
        }
    }
    // Vents on the flank: short slats.
    for k in 0..5 {
        let y = 0.16 + k as f32 * 0.03;
        let (x, z) = (-0.15, 0.03);
        draft
            .extra
            .push((Vec3::new(x, y, z + 0.03), Vec3::new(x - 0.004, y, z - 0.03)));
    }
    // The reactor's housing: a hexagon round the core.
    ring(
        &mut draft.extra,
        &ellipse(REACTOR - Vec3::Z * 0.005, Vec3::X, Vec3::Y, (0.05, 0.05), 6),
    );
}

fn head(draft: &mut Draft) {
    let radii = Vec3::new(0.085, 0.125, 0.10);
    let crown = HEAD + Vec3::Y * radii.y;
    let chin = HEAD - Vec3::Y * radii.y;

    // Human half: half latitude rings and meridians.
    let mut lattice: Vec<Vec<Vec3>> = Vec::new();
    for i in 1..6 {
        let polar = i as f32 / 6.0 * PI;
        let centre = Vec3::new(HEAD.x, HEAD.y + radii.y * polar.cos(), HEAD.z);
        let half = arc(
            centre,
            Vec3::X,
            Vec3::Z,
            (radii.x * polar.sin(), radii.z * polar.sin()),
            -FRAC_PI_2,
            FRAC_PI_2,
            5,
        );
        line(&mut draft.skin, &half);
        lattice.push(half);
    }
    for k in 0..6 {
        let mut meridian = vec![crown];
        meridian.extend(lattice.iter().filter_map(|ring| ring.get(k).copied()));
        meridian.push(chin);
        line(&mut draft.skin, &meridian);
    }

    // Machine half: a faceted shell.
    let mut shell: Vec<Vec<Vec3>> = Vec::new();
    for polar in [0.45, 1.1, 1.75, 2.4] {
        let centre = Vec3::new(HEAD.x, HEAD.y + radii.y * f32::cos(polar), HEAD.z);
        let half = arc(
            centre,
            Vec3::X,
            Vec3::Z,
            (
                radii.x * 1.05 * f32::sin(polar),
                radii.z * 1.05 * f32::sin(polar),
            ),
            FRAC_PI_2,
            PI + FRAC_PI_2,
            3,
        );
        line(&mut draft.extra, &half);
        shell.push(half);
    }
    for k in 0..4 {
        let mut edge = vec![crown];
        edge.extend(shell.iter().filter_map(|ring| ring.get(k).copied()));
        edge.push(chin);
        line(&mut draft.extra, &edge);
    }
    // Visor over the right eye, and a jaw plate.
    ring(
        &mut draft.extra,
        &[
            Vec3::new(-0.005, 0.9, 0.1),
            Vec3::new(-0.07, 0.9, 0.06),
            Vec3::new(-0.07, 0.872, 0.06),
            Vec3::new(-0.005, 0.872, 0.1),
        ],
    );
    line(
        &mut draft.extra,
        &[
            Vec3::new(0.0, 0.775, 0.07),
            Vec3::new(-0.06, 0.8, 0.03),
            Vec3::new(-0.08, 0.85, -0.01),
        ],
    );
}

/// Skin tubes on the human side.
fn human_limbs(out: &mut Vec<Seg>, side: &Side) {
    for (a, b, reference, profile) in limbs(side) {
        let (u, v) = frame(b - a, reference);
        let rings: Vec<Vec<Vec3>> = profile
            .iter()
            .map(|&(t, ru, rv)| ellipse(a.lerp(b, t), u, v, (ru, rv), LIMB_RING))
            .collect();
        for points in &rings {
            ring(out, points);
        }
        for pair in rings.windows(2) {
            for (p, q) in pair[0].iter().zip(&pair[1]) {
                out.push((*p, *q));
            }
        }
    }
    for (root, tip) in side.finger_roots().iter().zip(side.fingertips()) {
        out.push((*root, tip));
    }
}

/// A gear: a ring with teeth, square to `axis`.
fn gear(out: &mut Vec<Seg>, centre: Vec3, axis: Vec3, radius: f32) {
    let (u, v) = frame(axis, if axis.y.abs() > 0.9 { Vec3::X } else { Vec3::Y });
    ring(out, &ellipse(centre, u, v, (radius, radius), 10));
    for k in 0..10 {
        let angle = k as f32 / 10.0 * TAU;
        let out_dir = u * angle.cos() + v * angle.sin();
        out.push((centre + out_dir * radius, centre + out_dir * radius * 1.35));
    }
    ring(
        out,
        &ellipse(centre, u, v, (radius * 0.35, radius * 0.35), 6),
    );
}

/// A piston between two points: a cylinder and a thinner rod with a collar.
fn piston(out: &mut Vec<Seg>, from: Vec3, to: Vec3, radius: f32) {
    let (u, v) = frame(to - from, Vec3::Z);
    let middle = from.lerp(to, 0.55);
    for offset in [u * radius, -u * radius, v * radius, -v * radius] {
        out.push((from + offset, middle + offset));
    }
    ring(out, &ellipse(middle, u, v, (radius * 1.3, radius * 1.3), 6));
    out.push((middle, to));
    let half = radius * 0.4;
    out.push((middle + u * half, to + u * half));
}

/// Armour on the machine side: hexagonal plates with seams, gears at the
/// joints, pistons at the elbow and knee, a claw hand and a boot.
fn machine_limbs(out: &mut Vec<Seg>, side: &Side) {
    for (index, (a, b, reference, profile)) in limbs(side).into_iter().enumerate() {
        if index == 2 {
            continue; // the hand is a claw, below
        }
        let (u, v) = frame(b - a, reference);
        let seams = [0.04, 0.3, 0.7, 0.96];
        let rings: Vec<Vec<Vec3>> = seams
            .iter()
            .map(|&t| {
                let (ru, rv) = profile_at(profile, t);
                ellipse(a.lerp(b, t), u, v, (ru * 1.12, rv * 1.12), PLATE_SIDES)
            })
            .collect();
        for points in &rings {
            ring(out, points);
        }
        for pair in rings.windows(2) {
            for (p, q) in pair[0].iter().zip(&pair[1]) {
                out.push((*p, *q));
            }
        }
    }

    let s = side.s;
    for joint in [side.shoulder, side.elbow, side.hip, side.knee] {
        gear(out, joint + Vec3::new(s * 0.02, 0.0, 0.0), Vec3::X, 0.028);
    }

    let back = Vec3::new(0.0, 0.0, -0.055);
    piston(
        out,
        side.shoulder.lerp(side.elbow, 0.35) + back,
        side.elbow.lerp(side.wrist, 0.45) + back * 0.8,
        0.012,
    );
    let front = Vec3::new(0.0, 0.0, 0.075);
    piston(
        out,
        side.hip.lerp(side.knee, 0.45) + front,
        side.knee.lerp(side.ankle, 0.4) + front * 0.75,
        0.014,
    );

    // Claw: a palm frame and three jointed fingers and a thumb.
    let palm = [
        side.wrist + Vec3::new(0.0, 0.0, 0.03),
        side.knuckles + Vec3::new(0.0, 0.0, 0.035),
        side.knuckles + Vec3::new(0.0, 0.0, -0.03),
        side.wrist + Vec3::new(0.0, 0.0, -0.025),
    ];
    ring(out, &palm);
    let tips = side.fingertips();
    let roots = side.finger_roots();
    for finger in [0, 1, 2, 4] {
        let (Some(root), Some(tip)) = (roots.get(finger), tips.get(finger)) else {
            continue;
        };
        let bend = root.lerp(*tip, 0.5) + Vec3::new(s * 0.012, 0.0, 0.0);
        line(out, &[*root, bend, *tip]);
        ring(out, &ellipse(bend, Vec3::X, Vec3::Y, (0.006, 0.006), 4));
    }

    // Boot: a wedge.
    let sole = -0.985;
    let toe = Vec3::new(side.toe.x, sole, side.toe.z + 0.01);
    let heel = Vec3::new(side.heel.x, sole, side.heel.z - 0.01);
    for w in [-0.04, 0.04] {
        let across = Vec3::new(w, 0.0, 0.0);
        ring(
            out,
            &[
                heel + across,
                toe + across,
                toe + across + Vec3::Y * 0.02,
                side.ankle + across * 0.8 + Vec3::new(0.0, 0.0, 0.03),
                side.ankle + across * 0.8 + Vec3::new(0.0, 0.0, -0.04),
            ],
        );
    }
    out.push((heel + Vec3::X * -0.04, heel + Vec3::X * 0.04));
    out.push((toe + Vec3::X * -0.04, toe + Vec3::X * 0.04));
}

fn spine(out: &mut Vec<Seg>) {
    line(out, &SPINE);
    for k in 0..18 {
        let y = SPINE[0].y + (0.05 - SPINE[0].y) * k as f32 / 17.0;
        let centre = spine_at(y);
        out.push((centre - Vec3::X * 0.025, centre + Vec3::X * 0.025));
    }
}

/// A truss: two rails and a zigzag between them.
fn truss(out: &mut Vec<Seg>, a: Vec3, b: Vec3, width: f32, bays: usize) {
    let (u, _) = frame(b - a, Vec3::Z);
    let (left, right) = (u * width, -u * width);
    out.push((a + left, b + left));
    out.push((a + right, b + right));
    for k in 0..bays {
        let from = a.lerp(b, k as f32 / bays as f32);
        let to = a.lerp(b, (k + 1) as f32 / bays as f32);
        let (p, q) = if k % 2 == 0 {
            (left, right)
        } else {
            (right, left)
        };
        out.push((from + p, to + q));
    }
}

fn machine_bones(out: &mut Vec<Seg>, side: &Side) {
    let s = side.s;
    // A frame of bars where the ribs would be.
    for k in 0..5 {
        let y = 0.6 - k as f32 * 0.05;
        let width = 0.1 + 0.035 * (k as f32 * 0.8).sin();
        line(
            out,
            &[
                Vec3::new(0.0, y, -0.075),
                Vec3::new(s * width, y, -0.04),
                Vec3::new(s * width, y - 0.02, 0.05),
                Vec3::new(0.0, y - 0.03, 0.09),
            ],
        );
    }
    line(
        out,
        &[
            Vec3::new(s * 0.015, 0.62, 0.08),
            side.shoulder + Vec3::Y * 0.02,
        ],
    );
    line(
        out,
        &[
            Vec3::new(s * 0.02, 0.1, -0.06),
            Vec3::new(s * 0.14, 0.09, 0.0),
            side.hip,
        ],
    );
    truss(out, side.shoulder, side.elbow, 0.008, 4);
    truss(out, side.elbow, side.wrist, 0.006, 3);
    truss(out, side.hip, side.knee, 0.01, 5);
    truss(out, side.knee, side.ankle, 0.008, 5);
}

/// Routes a trace from `from` to `to` in right-angled steps: `steps` stairs
/// that alternate down (or up) and across. Returns the corner points.
fn staircase(from: Vec3, to: Vec3, steps: usize) -> Vec<Vec3> {
    let mut points = vec![from];
    let mut at = from;
    let steps = steps.max(1);
    let step = (to - from) / steps as f32;
    for _ in 0..steps {
        at = Vec3::new(at.x, at.y + step.y, at.z + step.z);
        points.push(at);
        at = Vec3::new(at.x + step.x, at.y, at.z);
        points.push(at);
    }
    points
}

/// A square node marker at `at`, facing the viewer.
fn node(out: &mut Vec<Seg>, at: Vec3) {
    ring(
        out,
        &[
            at + Vec3::new(-NODE, -NODE, 0.0),
            at + Vec3::new(NODE, -NODE, 0.0),
            at + Vec3::new(NODE, NODE, 0.0),
            at + Vec3::new(-NODE, NODE, 0.0),
        ],
    );
}

/// The nervous system as circuit traces: a bus down the spine, then each
/// nerve breaking out at right angles and stepping down its limb, with a
/// node at every other bend and a pad at the end.
fn circuits(draft: &mut Draft, human: &Side, machine: &Side) {
    let mut rng = Rng::new(0x00c1_c017);
    let bus = |lane: f32, down_to: f32| -> Vec<Vec3> {
        vec![
            BRAIN,
            Vec3::new(lane, BRAIN.y - 0.03, -0.02),
            Vec3::new(lane, 0.79, -0.03),
            Vec3::new(lane, down_to, spine_at(down_to).z + 0.0),
        ]
    };

    let mut paths: Vec<(String, Vec<Vec3>)> = vec![("spinal_cord".to_owned(), bus(0.0, 0.02))];
    for side in [human, machine] {
        let s = side.s;
        let tips = side.fingertips();
        for (lane, (name, finger)) in [("radial", 0), ("median", 2), ("ulnar", 4)]
            .into_iter()
            .enumerate()
        {
            let lane_x = s * (0.008 + 0.006 * lane as f32);
            let y = 0.66 - lane as f32 * 0.015;
            let mut points = bus(lane_x, y);
            let shoulder = side.shoulder + Vec3::new(0.0, 0.03 - lane as f32 * 0.012, 0.0);
            points.push(Vec3::new(shoulder.x, y, -0.03));
            points.extend(staircase(
                Vec3::new(shoulder.x, y, -0.03),
                side.wrist + Vec3::new(0.0, 0.0, -0.01 + lane as f32 * 0.01),
                2,
            ));
            if let Some(tip) = tips.get(finger) {
                points.push(*tip);
            }
            paths.push((side.name(name), points));
        }

        for index in 0..3 {
            let y = 0.55 - index as f32 * 0.07;
            let mut points = bus(s * 0.004, y);
            let width = 0.12 + 0.015 * index as f32;
            points.extend([
                Vec3::new(s * width, y, -0.05),
                Vec3::new(s * width, y, 0.06),
                Vec3::new(s * 0.03, y, 0.09),
            ]);
            paths.push((side.name(&format!("intercostal_{}", index + 1)), points));
        }

        let toes = side.toe_tips();
        for (lane, (name, toe)) in [("femoral", 0), ("tibial", 2), ("peroneal", 4)]
            .into_iter()
            .enumerate()
        {
            let lane_x = s * (0.006 + 0.007 * lane as f32);
            let y = 0.04 - lane as f32 * 0.02;
            let mut points = bus(lane_x, y);
            let hip = Vec3::new(side.hip.x + s * (lane as f32 - 1.0) * 0.015, y, 0.0);
            points.push(hip);
            points.extend(staircase(
                hip,
                side.ankle + Vec3::new(s * (lane as f32 - 1.0) * 0.012, 0.0, 0.0),
                3,
            ));
            if let Some(tip) = toes.get(toe) {
                points.push(*tip);
            }
            paths.push((side.name(name), points));
        }

        paths.push((
            side.name("optic"),
            vec![
                BRAIN,
                Vec3::new(s * 0.03, BRAIN.y, 0.02),
                Vec3::new(s * 0.03, 0.886, 0.085),
            ],
        ));
    }
    paths.push((
        "vagus".to_owned(),
        vec![
            BRAIN,
            Vec3::new(0.0, BRAIN.y - 0.03, -0.02),
            Vec3::new(0.0, 0.79, 0.04),
            Vec3::new(0.0, REACTOR.y + 0.08, 0.06),
            REACTOR,
        ],
    ));

    // Draw: traces once each (the shared bus by the cord), nodes at bends.
    for (name, points) in &paths {
        let own = if name == "spinal_cord" || name == "vagus" {
            &points[..]
        } else {
            points.get(3..).unwrap_or(&[])
        };
        for (index, point) in own.iter().enumerate().skip(1) {
            if index % 2 == 0 || rng.unit() < 0.3 {
                node(&mut draft.nerves, *point);
            }
        }
        if let Some(end) = points.last() {
            ring(
                &mut draft.nerves,
                &ellipse(*end, Vec3::X, Vec3::Y, (0.012, 0.012), 6),
            );
        }
    }
    draft.paths = paths;
}

/// A chip where the brain is: a die with pins and a grid inside.
fn brain() -> Vec<Seg> {
    let mut out = Vec::new();
    let centre = Vec3::new(0.0, 0.92, -0.005);
    let half = 0.045;
    let corners = [
        centre + Vec3::new(-half, 0.0, -half),
        centre + Vec3::new(half, 0.0, -half),
        centre + Vec3::new(half, 0.0, half),
        centre + Vec3::new(-half, 0.0, half),
    ];
    ring(&mut out, &corners);
    for k in 1..4 {
        let t = k as f32 / 4.0;
        out.push((
            corners[0].lerp(corners[1], t),
            corners[3].lerp(corners[2], t),
        ));
        out.push((
            corners[0].lerp(corners[3], t),
            corners[1].lerp(corners[2], t),
        ));
    }
    for k in 0..6 {
        let t = (k as f32 + 0.5) / 6.0;
        for (a, b, out_dir) in [
            (corners[0], corners[1], -Vec3::Z),
            (corners[3], corners[2], Vec3::Z),
            (corners[0], corners[3], -Vec3::X),
            (corners[1], corners[2], Vec3::X),
        ] {
            let pin = a.lerp(b, t);
            out.push((pin, pin + out_dir * 0.015 - Vec3::Y * 0.01));
        }
    }
    out
}
