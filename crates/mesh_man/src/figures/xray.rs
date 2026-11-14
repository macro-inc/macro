//! XRAY: a dense skeleton (every vertebra, rib, finger and toe bone, the jaw
//! and shoulder blades), skin as horizontal contour slices like a CT scan,
//! and nerves as fine trees branching off each trunk.

use std::f32::consts::{FRAC_PI_2, PI, TAU};

use glam::Vec3;

use crate::figure::Core;
use crate::palette::Look;

use super::common::{
    BRAIN, Branching, Draft, HEAD, HEART, Rng, SPINE, Seg, Side, arc, cord_to, ellipse,
    ellipse_from, frame, limbs, line, profile_at, ring, spine_at, sprout, torso_at,
};

/// Height between contour slices.
const SLICE_STEP: f32 = 0.034;
/// Points per slice round the torso, a limb and the head.
const TORSO_SLICE: usize = 18;
const LIMB_SLICE: usize = 9;
const HEAD_SLICE: usize = 14;

/// Vertebrae from the neck to the sacrum.
const VERTEBRAE: usize = 24;
/// Ribs a side.
const RIBS: usize = 12;

pub(crate) fn build() -> Draft {
    let sides = Side::both();
    let mut draft = Draft {
        core: Some(Core::Heart(HEART)),
        look: Look::Xray,
        ..Draft::default()
    };

    contours(&mut draft.skin, &sides);
    skull(&mut draft.bones);
    spine(&mut draft.bones);
    ribcage(&mut draft.bones);
    pelvis(&mut draft.bones);
    for side in &sides {
        arm_bones(&mut draft.bones, side);
        leg_bones(&mut draft.bones, side);
    }
    nerves(&mut draft, &sides);
    draft.brain = brain_stem();
    draft
}

/// CT slices: horizontal contours of the torso and head, and slices square
/// to each limb.
fn contours(out: &mut Vec<Seg>, sides: &[Side; 2]) {
    let mut y = -0.10;
    while y <= 0.78 {
        let (rx, rz, z) = torso_at(y);
        ring(
            out,
            &ellipse(Vec3::new(0.0, y, z), Vec3::X, Vec3::Z, (rx, rz), TORSO_SLICE),
        );
        y += SLICE_STEP;
    }

    let radii = Vec3::new(0.085, 0.125, 0.10);
    let mut y: f32 = -0.92;
    while y < 0.96 {
        let polar = f32::acos(y);
        let (rx, rz) = (radii.x * polar.sin(), radii.z * polar.sin());
        ring(
            out,
            &ellipse(
                HEAD + Vec3::Y * radii.y * y,
                Vec3::X,
                Vec3::Z,
                (rx, rz),
                HEAD_SLICE,
            ),
        );
        y += 0.24;
    }

    for side in sides {
        for (a, b, reference, profile) in limbs(side) {
            let (u, v) = frame(b - a, reference);
            let length = a.distance(b);
            let slices = ((length / SLICE_STEP).round() as usize).max(2);
            for k in 0..=slices {
                let t = k as f32 / slices as f32;
                let (ru, rv) = profile_at(profile, t);
                ring(out, &ellipse(a.lerp(b, t), u, v, (ru, rv), LIMB_SLICE));
            }
        }
    }
}

fn skull(out: &mut Vec<Seg>) {
    let centre = HEAD + Vec3::new(0.0, 0.015, -0.005);
    let radii = Vec3::new(0.074, 0.098, 0.088);

    // Cranium: latitude rings over the top, meridians down to the brow.
    for polar in [0.35, 0.75, 1.15, 1.5] {
        let y = centre.y + radii.y * f32::cos(polar);
        ring(
            out,
            &ellipse(
                Vec3::new(0.0, y, centre.z),
                Vec3::X,
                Vec3::Z,
                (radii.x * f32::sin(polar), radii.z * f32::sin(polar)),
                16,
            ),
        );
    }
    for k in 0..8 {
        let azimuth = k as f32 / 8.0 * TAU;
        let points: Vec<Vec3> = (0..=6)
            .map(|i| {
                let polar = i as f32 / 6.0 * 1.6;
                centre
                    + Vec3::new(
                        radii.x * polar.sin() * azimuth.cos(),
                        radii.y * polar.cos(),
                        radii.z * polar.sin() * azimuth.sin(),
                    )
            })
            .collect();
        line(out, &points);
    }
    // Back of the skull down to the base.
    line(
        out,
        &arc(
            Vec3::new(0.0, 0.875, -0.01),
            Vec3::X,
            -Vec3::Z,
            (0.07, 0.08),
            0.0,
            PI,
            8,
        ),
    );

    // Eye sockets, nose, cheekbones.
    for s in [1.0, -1.0] {
        ring(
            out,
            &ellipse(
                Vec3::new(s * 0.031, 0.885, 0.083),
                Vec3::X,
                Vec3::Y,
                (0.021, 0.018),
                10,
            ),
        );
        line(
            out,
            &[
                Vec3::new(s * 0.05, 0.872, 0.075),
                Vec3::new(s * 0.068, 0.86, 0.04),
                Vec3::new(s * 0.07, 0.862, -0.005),
            ],
        );
    }
    ring(
        out,
        &[
            Vec3::new(0.0, 0.868, 0.095),
            Vec3::new(0.011, 0.84, 0.093),
            Vec3::new(-0.011, 0.84, 0.093),
        ],
    );

    // Upper jaw and teeth.
    let upper = arc(
        Vec3::new(0.0, 0.822, 0.025),
        Vec3::X,
        Vec3::Z,
        (0.05, 0.065),
        0.1,
        PI - 0.1,
        10,
    );
    line(out, &upper);
    for tooth in &upper {
        out.push((*tooth, *tooth - Vec3::Y * 0.012));
    }

    // Mandible: chin, body and the ramus up to the ear.
    let lower = arc(
        Vec3::new(0.0, 0.798, 0.02),
        Vec3::X,
        Vec3::Z,
        (0.052, 0.066),
        0.05,
        PI - 0.05,
        10,
    );
    for tooth in lower.iter().skip(2).take(7) {
        out.push((*tooth, *tooth + Vec3::Y * 0.011));
    }
    let mut jaw = vec![Vec3::new(0.064, 0.86, -0.012), Vec3::new(0.06, 0.79, 0.0)];
    jaw.extend(
        arc(
            Vec3::new(0.0, 0.78, 0.02),
            Vec3::X,
            Vec3::Z,
            (0.056, 0.066),
            0.05,
            PI - 0.05,
            10,
        )
        .into_iter()
        .skip(1)
        .take(9),
    );
    jaw.extend([Vec3::new(-0.06, 0.79, 0.0), Vec3::new(-0.064, 0.86, -0.012)]);
    line(out, &jaw);
}

fn spine(out: &mut Vec<Seg>) {
    let top = SPINE[0].y;
    let bottom = 0.05;
    for k in 0..VERTEBRAE {
        let t = k as f32 / (VERTEBRAE - 1) as f32;
        let y = top + (bottom - top) * t;
        let centre = spine_at(y);
        // Cervical small, thoracic middling, lumbar broad.
        let (width, body) = match k {
            0..7 => (0.022, 0.012),
            7..19 => (0.03, 0.015),
            _ => (0.04, 0.02),
        };
        ring(
            out,
            &ellipse(
                centre + Vec3::Z * 0.02,
                Vec3::X,
                Vec3::Z,
                (body, body * 0.8),
                6,
            ),
        );
        // Transverse processes and the spinous process behind.
        out.push((centre - Vec3::X * width, centre + Vec3::X * width));
        out.push((centre, centre + Vec3::new(0.0, -0.012, -0.03)));
    }

    // Sacrum: a tapering plate with its foramina, then the coccyx.
    let sacrum_top = spine_at(bottom - 0.01);
    let points = [
        sacrum_top + Vec3::new(0.05, 0.0, 0.0),
        sacrum_top + Vec3::new(0.0, -0.13, 0.025),
        sacrum_top + Vec3::new(-0.05, 0.0, 0.0),
    ];
    ring(out, &points);
    for k in 1..4 {
        let t = k as f32 * 0.25;
        let left = points[0].lerp(points[1], t);
        let right = points[2].lerp(points[1], t);
        out.push((left.lerp(right, 0.2), left.lerp(right, 0.4)));
        out.push((left.lerp(right, 0.6), left.lerp(right, 0.8)));
    }
    line(
        out,
        &[
            points[1],
            points[1] + Vec3::new(0.0, -0.025, 0.02),
            points[1] + Vec3::new(0.0, -0.04, 0.04),
        ],
    );
}

/// Half width of rib `index` (0 at the top).
fn rib_width(index: usize) -> f32 {
    let t = index as f32 / (RIBS - 1) as f32;
    0.07 + 0.08 * (t * PI * 0.85).sin().max(0.0) + 0.02 * t
}

/// One rib from the spine to `reach` of the way round to the sternum.
fn rib(s: f32, index: usize, reach: f32) -> Vec<Vec3> {
    let back_y = 0.64 - index as f32 * 0.03;
    let width = rib_width(index);
    let depth = 0.075 + 0.02 * (index as f32 / RIBS as f32);
    (0..12)
        .map(|k| {
            let theta = k as f32 / 11.0 * PI * reach;
            let around = (1.0 - theta.cos()) / 2.0;
            Vec3::new(
                s * width * theta.sin(),
                back_y - 0.1 * around,
                0.0 - depth * theta.cos(),
            )
        })
        .collect()
}

fn ribcage(out: &mut Vec<Seg>) {
    let sternum_bottom = Vec3::new(0.0, 0.40, 0.098);
    for index in 0..RIBS {
        let reach = match index {
            0..7 => 0.94,
            7..10 => 0.86,
            _ => 0.55,
        };
        for s in [1.0, -1.0] {
            let points = rib(s, index, reach);
            line(out, &points);
            // False ribs: cartilage up to the sternum's foot.
            if (7..10).contains(&index)
                && let Some(end) = points.last()
            {
                out.push((*end, sternum_bottom + Vec3::new(s * 0.02, 0.0, 0.0)));
            }
        }
    }

    // Sternum: manubrium, body, xiphoid.
    ring(
        out,
        &[
            Vec3::new(0.022, 0.625, 0.08),
            Vec3::new(0.016, 0.585, 0.088),
            Vec3::new(0.013, 0.42, 0.1),
            Vec3::new(0.0, 0.38, 0.095),
            Vec3::new(-0.013, 0.42, 0.1),
            Vec3::new(-0.016, 0.585, 0.088),
            Vec3::new(-0.022, 0.625, 0.08),
        ],
    );
    out.push((Vec3::new(-0.016, 0.585, 0.088), Vec3::new(0.016, 0.585, 0.088)));

    for side in Side::both() {
        let s = side.s;
        // Clavicle, a gentle S.
        line(
            out,
            &[
                Vec3::new(s * 0.02, 0.63, 0.075),
                Vec3::new(s * 0.08, 0.635, 0.07),
                Vec3::new(s * 0.14, 0.645, 0.03),
                side.shoulder + Vec3::new(-s * 0.01, 0.025, 0.0),
            ],
        );
        // Scapula: blade, its spine and the acromion.
        let blade = [
            Vec3::new(s * 0.065, 0.61, -0.095),
            Vec3::new(s * 0.175, 0.62, -0.06),
            Vec3::new(s * 0.15, 0.53, -0.09),
            Vec3::new(s * 0.085, 0.44, -0.1),
        ];
        ring(out, &blade);
        line(
            out,
            &[
                Vec3::new(s * 0.07, 0.575, -0.105),
                Vec3::new(s * 0.16, 0.6, -0.08),
                side.shoulder + Vec3::new(0.0, 0.02, -0.02),
            ],
        );
    }
}

fn pelvis(out: &mut Vec<Seg>) {
    for side in Side::both() {
        let s = side.s;
        // Iliac wing: the crest arcs out and forward; lines fan to the socket.
        let crest: Vec<Vec3> = (0..=8)
            .map(|k| {
                let t = k as f32 / 8.0;
                let angle = -FRAC_PI_2 * 0.9 + t * PI * 0.75;
                Vec3::new(
                    s * (0.035 + 0.115 * angle.cos()),
                    0.115 + 0.03 * (t * PI).sin(),
                    0.0 + 0.075 * angle.sin(),
                )
            })
            .collect();
        line(out, &crest);
        let socket = side.hip + Vec3::new(-s * 0.012, 0.0, 0.0);
        for point in crest.iter().step_by(2) {
            out.push((*point, socket.lerp(*point, 0.15)));
        }
        ring(
            out,
            &ellipse(socket, Vec3::Y, Vec3::Z, (0.026, 0.026), 8),
        );

        // Pubis to the symphysis, ischium below, and the hole between.
        let symphysis = Vec3::new(s * 0.008, -0.075, 0.065);
        line(
            out,
            &[socket + Vec3::new(-s * 0.02, 0.0, 0.02), symphysis],
        );
        line(
            out,
            &[
                socket + Vec3::new(0.0, -0.02, -0.01),
                Vec3::new(s * 0.07, -0.12, -0.01),
                Vec3::new(s * 0.03, -0.11, 0.04),
                symphysis,
            ],
        );
        ring(
            out,
            &ellipse(
                Vec3::new(s * 0.055, -0.075, 0.03),
                Vec3::new(0.0, 0.6, -0.8),
                Vec3::X,
                (0.025, 0.016),
                8,
            ),
        );
    }
}

/// A long bone: its shaft as two lines and a knob at each end.
fn long_bone(out: &mut Vec<Seg>, a: Vec3, b: Vec3, width: f32, knob: f32) {
    let (u, v) = frame(b - a, Vec3::Z);
    for offset in [u * width, -u * width] {
        out.push((a + offset + (b - a) * 0.08, b + offset - (b - a) * 0.08));
    }
    for end in [a, b] {
        ring(out, &ellipse(end, u, v, (knob, knob * 0.8), 8));
    }
}

/// A chain of small bones with a tick at each joint.
fn phalanges(out: &mut Vec<Seg>, points: &[Vec3], tick: f32) {
    line(out, points);
    for pair in points.windows(2) {
        let (u, _) = frame(pair[1] - pair[0], Vec3::Z);
        out.push((pair[1] - u * tick, pair[1] + u * tick));
    }
}

fn arm_bones(out: &mut Vec<Seg>, side: &Side) {
    let s = side.s;
    // Humerus: head in the shoulder socket, condyles at the elbow.
    long_bone(out, side.shoulder, side.elbow, 0.008, 0.024);
    out.push((
        side.elbow + Vec3::new(-0.028, 0.0, 0.0),
        side.elbow + Vec3::new(0.028, 0.0, 0.0),
    ));

    // Radius (thumb side) and ulna.
    let across = Vec3::new(0.0, 0.0, 0.014);
    line(out, &[side.elbow + across, side.wrist + across * 1.8]);
    line(out, &[side.elbow - across * 1.2, side.wrist - across * 0.6]);
    out.push((
        side.elbow - across * 1.2,
        side.elbow - across * 1.2 + Vec3::new(0.0, 0.03, -0.012),
    ));

    // Carpals: a little lattice at the wrist.
    let carpal = side.wrist + (side.knuckles - side.wrist) * 0.3;
    for row in [-0.012, 0.012] {
        let y = Vec3::Y * row;
        line(
            out,
            &[
                carpal + y + Vec3::new(0.0, 0.0, 0.03),
                carpal + y + Vec3::new(s * 0.004, 0.0, 0.0),
                carpal + y + Vec3::new(0.0, 0.0, -0.03),
            ],
        );
    }

    // Metacarpals and phalanges, the thumb with one fewer.
    for (finger, (root, tip)) in side
        .finger_roots()
        .iter()
        .zip(side.fingertips())
        .enumerate()
    {
        out.push((carpal, *root));
        let curl = Vec3::new(-s * 0.012, 0.0, 0.0);
        let points = if finger == 0 {
            vec![*root, root.lerp(tip, 0.55) + curl * 0.5, tip]
        } else {
            vec![
                *root,
                root.lerp(tip, 0.45) + curl * 0.4,
                root.lerp(tip, 0.78) + curl,
                tip + curl * 0.8,
            ]
        };
        phalanges(out, &points, 0.006);
    }
}

fn leg_bones(out: &mut Vec<Seg>, side: &Side) {
    let s = side.s;
    // Femur: head in the socket, neck to the trochanter, shaft to the knee.
    let head = side.hip + Vec3::new(-s * 0.012, 0.0, 0.0);
    let trochanter = Vec3::new(s * 0.135, -0.07, -0.005);
    line(out, &[head, head + Vec3::new(s * 0.03, -0.02, 0.0), trochanter]);
    ring(out, &ellipse(head, Vec3::X, Vec3::Y, (0.018, 0.018), 8));
    let condyles = side.knee + Vec3::Y * 0.025;
    long_bone(out, trochanter, condyles, 0.009, 0.014);
    for offset in [-0.024, 0.024] {
        ring(
            out,
            &ellipse(
                condyles + Vec3::new(offset, -0.005, 0.0),
                Vec3::Y,
                Vec3::Z,
                (0.016, 0.02),
                8,
            ),
        );
    }
    // Kneecap.
    ring(
        out,
        &ellipse(
            side.knee + Vec3::new(0.0, 0.015, 0.05),
            Vec3::X,
            Vec3::Y,
            (0.017, 0.022),
            8,
        ),
    );

    // Tibia with its plateau, and the fibula beside it.
    let plateau = side.knee - Vec3::Y * 0.02;
    out.push((
        plateau + Vec3::new(-0.035, 0.0, 0.0),
        plateau + Vec3::new(0.035, 0.0, 0.0),
    ));
    long_bone(out, plateau, side.ankle + Vec3::new(-s * 0.01, 0.0, 0.0), 0.007, 0.012);
    line(
        out,
        &[
            plateau + Vec3::new(s * 0.03, -0.03, -0.01),
            side.ankle + Vec3::new(s * 0.022, 0.0, -0.01),
        ],
    );

    // Foot: heel and tarsals, then metatarsals and toes.
    let midfoot = Vec3::new(s * 0.115, -0.955, 0.04);
    ring(
        out,
        &[
            side.ankle,
            side.heel,
            side.heel + Vec3::new(0.0, -0.012, 0.03),
            midfoot,
        ],
    );
    for (big, (root, tip)) in side.toe_roots().iter().zip(side.toe_tips()).enumerate() {
        out.push((midfoot, *root));
        let points = if big == 0 {
            vec![*root, root.lerp(tip, 0.5), tip]
        } else {
            vec![*root, root.lerp(tip, 0.4), root.lerp(tip, 0.75), tip]
        };
        phalanges(out, &points, 0.004);
    }
}

/// Nerve trunks like the classic figure's, each sprouting a fine tree.
fn nerves(draft: &mut Draft, sides: &[Side; 2]) {
    let mut rng = Rng::new(0x5eed_1a7e);
    let mut trunks: Vec<(String, Vec<Vec3>, Branching)> = Vec::new();

    let torso_rules = Branching {
        spacing: 0.06,
        chance: 0.35,
        length: 0.05,
        shrink: 0.6,
        depth: 3,
        angle: (0.5, 1.2),
        reach: 0.07,
    };
    let limb_rules = Branching {
        spacing: 0.08,
        chance: 0.35,
        length: 0.05,
        shrink: 0.7,
        depth: 3,
        angle: (0.45, 0.9),
        reach: 0.035,
    };
    let leg_rules = Branching {
        reach: 0.05,
        length: 0.065,
        spacing: 0.09,
        ..limb_rules
    };

    trunks.push(("spinal_cord".to_owned(), cord_to(0.0), torso_rules));
    for side in sides {
        let s = side.s;
        let plexus = [
            Vec3::new(s * 0.10, 0.63, -0.03),
            Vec3::new(s * 0.185, 0.60, -0.02),
        ];
        let tips = side.fingertips();
        for (name, offset, tip) in [
            ("radial", Vec3::new(s * 0.014, 0.0, -0.01), tips[0]),
            ("median", Vec3::new(0.0, 0.0, 0.016), tips[2]),
            ("ulnar", Vec3::new(-s * 0.014, 0.0, -0.012), tips[4]),
        ] {
            let mut points = cord_to(0.64);
            points.extend([
                plexus[0],
                plexus[1],
                side.elbow + offset,
                side.wrist + offset,
                side.knuckles + offset * 0.5,
                tip,
            ]);
            trunks.push((side.name(name), points, limb_rules));
        }

        for index in [1, 3, 5, 7] {
            let mut points = rib(s, index, 0.85);
            for point in &mut points {
                *point += Vec3::new(0.0, -0.012, 0.006);
            }
            let mut path = cord_to(points.first().map_or(0.5, |p| p.y));
            path.extend(points);
            trunks.push((
                side.name(&format!("intercostal_{}", index / 2 + 1)),
                path,
                Branching {
                    chance: 0.15,
                    reach: 0.03,
                    length: 0.03,
                    depth: 2,
                    ..torso_rules
                },
            ));
        }

        let lumbar = Vec3::new(s * 0.04, 0.06, -0.06);
        let sciatic = [
            lumbar,
            Vec3::new(s * 0.09, -0.08, -0.06),
            Vec3::new(s * 0.10, -0.30, -0.045),
            side.knee + Vec3::new(0.0, 0.02, -0.04),
        ];
        let toes = side.toe_tips();
        for (name, rest) in [
            (
                "tibial",
                [
                    side.ankle + Vec3::new(-s * 0.012, 0.0, -0.03),
                    side.heel + Vec3::new(0.0, 0.01, 0.02),
                    toes[0] - Vec3::Z * 0.01,
                ],
            ),
            (
                "peroneal",
                [
                    side.knee + Vec3::new(s * 0.035, -0.06, 0.0),
                    side.ankle + Vec3::new(s * 0.01, 0.0, 0.03),
                    toes[4] - Vec3::Z * 0.01,
                ],
            ),
        ] {
            let mut points = cord_to(0.06);
            points.extend(sciatic);
            points.extend(rest);
            trunks.push((side.name(name), points, leg_rules));
        }
        let mut femoral = cord_to(0.06);
        femoral.extend([
            lumbar,
            Vec3::new(s * 0.09, -0.02, 0.06),
            Vec3::new(s * 0.085, -0.25, 0.06),
            side.knee + Vec3::new(-s * 0.03, 0.04, 0.03),
            side.ankle + Vec3::new(-s * 0.025, 0.0, 0.01),
        ]);
        trunks.push((side.name("femoral"), femoral, leg_rules));

        trunks.push((
            side.name("optic"),
            vec![
                BRAIN,
                Vec3::new(s * 0.022, 0.89, 0.045),
                Vec3::new(s * 0.031, 0.885, 0.08),
            ],
            Branching {
                chance: 0.0,
                ..limb_rules
            },
        ));
        trunks.push((
            side.name("facial"),
            vec![
                BRAIN,
                Vec3::new(s * 0.05, 0.86, 0.0),
                Vec3::new(s * 0.07, 0.83, 0.04),
                Vec3::new(s * 0.04, 0.80, 0.08),
            ],
            Branching {
                spacing: 0.015,
                chance: 0.9,
                length: 0.025,
                reach: 0.03,
                ..limb_rules
            },
        ));
    }
    trunks.push((
        "vagus".to_owned(),
        vec![
            BRAIN,
            Vec3::new(0.02, 0.80, 0.0),
            Vec3::new(0.03, 0.70, 0.005),
            Vec3::new(0.035, 0.55, 0.035),
            HEART,
        ],
        Branching {
            chance: 0.0,
            ..limb_rules
        },
    ));

    for (name, points, rules) in trunks {
        // The shared run down the cord is drawn by the spinal cord alone.
        let start = if name == "spinal_cord" {
            0
        } else {
            points
                .iter()
                .position(|p| p.x.abs() > 0.001 || p.z > 0.0)
                .map_or(0, |i| i.saturating_sub(1))
        };
        let own = points.get(start..).unwrap_or(&[]);
        line(&mut draft.nerves, own);
        let mut leaves = Vec::new();
        sprout(own, rules, &mut rng, &mut draft.nerves, &mut leaves);
        draft.paths.push((name, points));
    }
}

/// The brain stem and cerebellum only, low in the skull, so the skull
/// itself stays the brightest thing in the head as on a radiograph.
fn brain_stem() -> Vec<Seg> {
    let mut out = Vec::new();
    line(
        &mut out,
        &[BRAIN, Vec3::new(0.0, 0.86, -0.02), Vec3::new(0.0, 0.81, -0.02)],
    );
    ring(
        &mut out,
        &ellipse_from(
            Vec3::new(0.0, 0.84, -0.05),
            Vec3::X,
            Vec3::Z,
            (0.035, 0.022),
            8,
            0.0,
        ),
    );
    out
}
