//! The figure, authored in code: joints, skin rings, bones and nerve paths.
//!
//! Units: the figure is 2.0 tall, feet at `y = -1`, crown at `y = +1`, origin at
//! the pelvis, `+x` the figure's left, `+z` the way it faces.

use std::f32::consts::{PI, TAU};

use glam::Vec3;

/// Which tissue a static segment belongs to; it picks the segment's layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tissue {
    Skin,
    Bone,
}

/// One straight piece of the static figure.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Segment {
    pub a: Vec3,
    pub b: Vec3,
    pub tissue: Tissue,
}

/// A nerve: a named polyline from the brain outward, with cumulative lengths.
#[derive(Clone, Debug)]
pub(crate) struct NervePath {
    pub name: String,
    pub points: Vec<Vec3>,
    /// `lengths[i]` is the distance along the path from `points[0]` to `points[i]`.
    pub lengths: Vec<f32>,
}

impl NervePath {
    fn new(name: String, points: Vec<Vec3>) -> Self {
        let mut lengths = Vec::with_capacity(points.len());
        let mut total = 0.0;
        let mut previous = points.first().copied().unwrap_or(Vec3::ZERO);

        for point in &points {
            total += point.distance(previous);
            lengths.push(total);
            previous = *point;
        }

        Self {
            name,
            points,
            lengths,
        }
    }

    /// The path's total length.
    pub fn length(&self) -> f32 {
        self.lengths.last().copied().unwrap_or(0.0)
    }

    /// The point at distance `s` along the path, clamped to its ends.
    pub fn point_at(&self, s: f32) -> Vec3 {
        let s = s.clamp(0.0, self.length());

        for (index, pair) in self.points.windows(2).enumerate() {
            let start = self.lengths.get(index).copied().unwrap_or(0.0);
            let end = self.lengths.get(index + 1).copied().unwrap_or(start);

            if s <= end {
                let span = end - start;
                let t = if span > 0.0 { (s - start) / span } else { 0.0 };
                return pair[0].lerp(pair[1], t);
            }
        }

        self.points.last().copied().unwrap_or(Vec3::ZERO)
    }

    /// The far end of the path.
    pub fn end(&self) -> Vec3 {
        self.points.last().copied().unwrap_or(Vec3::ZERO)
    }
}

/// The whole static figure.
#[derive(Clone, Debug)]
pub(crate) struct Model {
    pub segments: Vec<Segment>,
    /// The brain's folds, drawn with the nerves.
    pub brain: Vec<(Vec3, Vec3)>,
    pub nerves: Vec<NervePath>,
    /// Centre of the heart loop, at the end of the vagus nerve.
    pub heart: Vec3,
}

/// Points per skin ring on a limb.
const LIMB_RING: usize = 8;
/// Points per skin ring on the torso, which is wider.
const TORSO_RING: usize = 12;
/// Points per skull and rib curve.
const CURVE_POINTS: usize = 16;

const BRAIN: Vec3 = Vec3::new(0.0, 0.905, -0.005);
const HEAD: Vec3 = Vec3::new(0.0, 0.875, 0.01);
const HEART: Vec3 = Vec3::new(0.045, 0.43, 0.05);

/// The spine's centre line, crown to tailbone (also the spinal cord's route).
const SPINE: [Vec3; 6] = [
    Vec3::new(0.0, 0.79, -0.02),
    Vec3::new(0.0, 0.70, -0.04),
    Vec3::new(0.0, 0.56, -0.075),
    Vec3::new(0.0, 0.36, -0.085),
    Vec3::new(0.0, 0.16, -0.065),
    Vec3::new(0.0, 0.02, -0.07),
];

/// The joints of one side; `s` is `+1` for the figure's left, `-1` for its right.
#[derive(Clone, Copy)]
struct Side {
    s: f32,
    shoulder: Vec3,
    elbow: Vec3,
    wrist: Vec3,
    knuckles: Vec3,
    hip: Vec3,
    knee: Vec3,
    ankle: Vec3,
    heel: Vec3,
    toe: Vec3,
}

impl Side {
    fn new(s: f32) -> Self {
        Self {
            s,
            shoulder: Vec3::new(s * 0.20, 0.62, -0.01),
            elbow: Vec3::new(s * 0.30, 0.34, -0.03),
            wrist: Vec3::new(s * 0.38, 0.09, 0.0),
            knuckles: Vec3::new(s * 0.405, 0.0, 0.01),
            hip: Vec3::new(s * 0.095, -0.04, 0.0),
            knee: Vec3::new(s * 0.10, -0.50, 0.01),
            ankle: Vec3::new(s * 0.10, -0.93, -0.01),
            heel: Vec3::new(s * 0.10, -0.965, -0.045),
            toe: Vec3::new(s * 0.125, -0.975, 0.16),
        }
    }

    /// Fingertips, thumb first, fanned out from the knuckles.
    fn fingertips(&self) -> [Vec3; 5] {
        let s = self.s;
        [
            Vec3::new(s * 0.385, -0.02, 0.07),
            Vec3::new(s * 0.415, -0.10, 0.045),
            Vec3::new(s * 0.43, -0.115, 0.02),
            Vec3::new(s * 0.44, -0.105, -0.005),
            Vec3::new(s * 0.445, -0.085, -0.025),
        ]
    }

    /// Where each finger leaves the palm, thumb first.
    fn finger_roots(&self) -> [Vec3; 5] {
        let s = self.s;
        [
            Vec3::new(s * 0.375, 0.06, 0.04),
            Vec3::new(s * 0.40, 0.0, 0.035),
            Vec3::new(s * 0.41, -0.005, 0.012),
            Vec3::new(s * 0.415, 0.0, -0.01),
            Vec3::new(s * 0.415, 0.01, -0.03),
        ]
    }
}

impl Model {
    /// Builds the figure. Pure and deterministic.
    pub fn build() -> Self {
        let mut segments = Vec::new();
        let sides = [Side::new(1.0), Side::new(-1.0)];

        skin(&mut segments, &sides);
        skeleton(&mut segments, &sides);

        let mut nerves = vec![NervePath::new("spinal_cord".to_owned(), cord_down_to(0.02))];
        for side in &sides {
            side_nerves(&mut nerves, side);
        }

        nerves.push(NervePath::new(
            "vagus".to_owned(),
            vec![
                BRAIN,
                Vec3::new(0.02, 0.80, 0.0),
                Vec3::new(0.03, 0.70, 0.005),
                Vec3::new(0.035, 0.55, 0.035),
                HEART,
            ],
        ));

        Self {
            segments,
            brain: brain_folds(),
            nerves,
            heart: HEART,
        }
    }
}

/// Pushes the segments of a closed loop.
fn push_loop(out: &mut Vec<Segment>, points: &[Vec3], tissue: Tissue) {
    for (index, a) in points.iter().enumerate() {
        let b = points
            .get((index + 1) % points.len())
            .copied()
            .unwrap_or(*a);
        out.push(Segment { a: *a, b, tissue });
    }
}

/// Pushes the segments of an open polyline.
fn push_line(out: &mut Vec<Segment>, points: &[Vec3], tissue: Tissue) {
    for pair in points.windows(2) {
        out.push(Segment {
            a: pair[0],
            b: pair[1],
            tissue,
        });
    }
}

/// An ellipse of `n` points around `centre` in the plane of `u` and `v`.
fn ellipse(centre: Vec3, u: Vec3, v: Vec3, ru: f32, rv: f32, n: usize) -> Vec<Vec3> {
    (0..n)
        .map(|k| {
            let angle = k as f32 / n as f32 * TAU;
            centre + u * (ru * angle.cos()) + v * (rv * angle.sin())
        })
        .collect()
}

/// One cross-section of a swept skin tube.
struct Ring {
    centre: Vec3,
    u: Vec3,
    v: Vec3,
    ru: f32,
    rv: f32,
}

/// Sweeps rings along a tube: each ring is a loop, and matching points of
/// neighbouring rings are joined by longitudinal lines. Together they read as
/// a wireframe mesh.
fn sweep(out: &mut Vec<Segment>, rings: &[Ring], n: usize) {
    let loops: Vec<Vec<Vec3>> = rings
        .iter()
        .map(|ring| ellipse(ring.centre, ring.u, ring.v, ring.ru, ring.rv, n))
        .collect();

    for points in &loops {
        push_loop(out, points, Tissue::Skin);
    }

    for pair in loops.windows(2) {
        for (a, b) in pair[0].iter().zip(&pair[1]) {
            out.push(Segment {
                a: *a,
                b: *b,
                tissue: Tissue::Skin,
            });
        }
    }
}

/// Rings along a limb from `a` to `b`. `profile` holds `(t, ru, rv)`: the
/// position along the bone and the radii across (`u`) and front-to-back (`v`).
/// `reference` is any direction not parallel to the bone; it orients the rings
/// so neighbouring limbs' longitudinal lines line up.
fn limb(out: &mut Vec<Segment>, a: Vec3, b: Vec3, reference: Vec3, profile: &[(f32, f32, f32)]) {
    let direction = (b - a).normalize_or_zero();
    let u = direction.cross(reference).normalize_or_zero();
    let v = u.cross(direction);

    let rings: Vec<Ring> = profile
        .iter()
        .map(|&(t, ru, rv)| Ring {
            centre: a.lerp(b, t),
            u,
            v,
            ru,
            rv,
        })
        .collect();

    sweep(out, &rings, LIMB_RING);
}

fn skin(out: &mut Vec<Segment>, sides: &[Side; 2]) {
    // Torso, hips to neck: (height, half width, half depth, forward offset).
    let torso = [
        (-0.10, 0.165, 0.095, 0.0),
        (0.0, 0.175, 0.105, 0.0),
        (0.12, 0.155, 0.095, 0.0),
        (0.24, 0.135, 0.09, 0.005),
        (0.36, 0.15, 0.10, 0.01),
        (0.48, 0.175, 0.11, 0.01),
        (0.58, 0.19, 0.105, 0.0),
        (0.65, 0.165, 0.08, -0.01),
        (0.69, 0.10, 0.065, -0.01),
        (0.72, 0.055, 0.05, -0.005),
        (0.78, 0.05, 0.05, 0.0),
    ];
    let rings: Vec<Ring> = torso
        .iter()
        .map(|&(y, rx, rz, z)| Ring {
            centre: Vec3::new(0.0, y, z),
            u: Vec3::X,
            v: Vec3::Z,
            ru: rx,
            rv: rz,
        })
        .collect();
    sweep(out, &rings, TORSO_RING);

    // Head: an ellipsoid of latitude rings and longitude lines.
    let radii = Vec3::new(0.085, 0.125, 0.10);
    let latitudes = 6;
    let longitudes = 10;
    let mut lattice: Vec<Vec<Vec3>> = Vec::new();
    for i in 1..latitudes {
        let polar = i as f32 / latitudes as f32 * PI;
        let y = HEAD.y + radii.y * polar.cos();
        let ring = ellipse(
            Vec3::new(HEAD.x, y, HEAD.z),
            Vec3::X,
            Vec3::Z,
            radii.x * polar.sin(),
            radii.z * polar.sin(),
            longitudes,
        );
        push_loop(out, &ring, Tissue::Skin);
        lattice.push(ring);
    }
    let crown = HEAD + Vec3::Y * radii.y;
    let chin = HEAD - Vec3::Y * radii.y;
    for k in 0..longitudes {
        let mut meridian = vec![crown];
        meridian.extend(lattice.iter().filter_map(|ring| ring.get(k).copied()));
        meridian.push(chin);
        push_line(out, &meridian, Tissue::Skin);
    }

    for side in sides {
        limb(
            out,
            side.shoulder,
            side.elbow,
            Vec3::Z,
            &[(0.0, 0.055, 0.055), (0.45, 0.05, 0.048), (1.0, 0.04, 0.04)],
        );
        limb(
            out,
            side.elbow,
            side.wrist,
            Vec3::Z,
            &[(0.0, 0.04, 0.04), (0.35, 0.042, 0.038), (1.0, 0.026, 0.022)],
        );
        limb(
            out,
            side.wrist,
            side.knuckles,
            Vec3::Z,
            &[(0.0, 0.026, 0.022), (1.0, 0.018, 0.04)],
        );
        limb(
            out,
            side.hip,
            side.knee,
            Vec3::Z,
            &[(0.0, 0.085, 0.085), (0.4, 0.072, 0.075), (1.0, 0.05, 0.052)],
        );
        limb(
            out,
            side.knee,
            side.ankle,
            Vec3::Z,
            &[(0.0, 0.05, 0.052), (0.3, 0.052, 0.058), (1.0, 0.03, 0.032)],
        );
        limb(
            out,
            side.heel,
            side.toe,
            Vec3::Y,
            &[(0.0, 0.03, 0.03), (0.5, 0.04, 0.028), (1.0, 0.035, 0.015)],
        );

        // Fingers are single skin strokes; their bones sit inside.
        for (root, tip) in side.finger_roots().iter().zip(side.fingertips()) {
            out.push(Segment {
                a: *root,
                b: tip,
                tissue: Tissue::Skin,
            });
        }
    }
}

/// The points of one rib (or the nerve running under it) from the spine
/// round to `reach` of the way to the sternum. Ribs slope down toward the front.
fn rib_curve(s: f32, back_y: f32, half_width: f32, reach: f32) -> Vec<Vec3> {
    let points = CURVE_POINTS / 2 + 2;

    (0..points)
        .map(|k| {
            let theta = k as f32 / (points - 1) as f32 * PI * reach;
            let around = (1.0 - theta.cos()) / 2.0;
            Vec3::new(
                s * half_width * theta.sin(),
                back_y - 0.07 * around,
                0.01 - 0.085 * theta.cos(),
            )
        })
        .collect()
}

/// Half widths of the seven ribs, top to bottom.
const RIB_WIDTHS: [f32; 7] = [0.075, 0.105, 0.125, 0.138, 0.145, 0.142, 0.132];

fn rib_back_y(index: usize) -> f32 {
    0.60 - index as f32 * 0.04
}

fn skeleton(out: &mut Vec<Segment>, sides: &[Side; 2]) {
    // Skull: three crossed rings, eye sockets and a jaw.
    let skull = HEAD + Vec3::new(0.0, 0.01, 0.0);
    let radii = Vec3::new(0.072, 0.1, 0.085);
    push_loop(
        out,
        &ellipse(skull, Vec3::X, Vec3::Z, radii.x, radii.z, CURVE_POINTS),
        Tissue::Bone,
    );
    push_loop(
        out,
        &ellipse(skull, Vec3::Y, Vec3::Z, radii.y, radii.z, CURVE_POINTS),
        Tissue::Bone,
    );
    push_loop(
        out,
        &ellipse(skull, Vec3::X, Vec3::Y, radii.x, radii.y, CURVE_POINTS),
        Tissue::Bone,
    );
    for s in [1.0, -1.0] {
        let socket = Vec3::new(s * 0.032, 0.885, 0.085);
        push_loop(
            out,
            &ellipse(socket, Vec3::X, Vec3::Y, 0.02, 0.016, 8),
            Tissue::Bone,
        );
    }
    push_line(
        out,
        &[
            Vec3::new(0.066, 0.85, 0.0),
            Vec3::new(0.055, 0.795, 0.045),
            Vec3::new(0.0, 0.772, 0.075),
            Vec3::new(-0.055, 0.795, 0.045),
            Vec3::new(-0.066, 0.85, 0.0),
        ],
        Tissue::Bone,
    );

    // Spine, with a cross tick per vertebra.
    push_line(out, &SPINE, Tissue::Bone);
    let vertebrae = 22;
    let cord = NervePath::new(String::new(), SPINE.to_vec());
    for k in 0..vertebrae {
        let centre = cord.point_at(cord.length() * k as f32 / (vertebrae - 1) as f32);
        out.push(Segment {
            a: centre - Vec3::X * 0.022,
            b: centre + Vec3::X * 0.022,
            tissue: Tissue::Bone,
        });
        out.push(Segment {
            a: centre,
            b: centre - Vec3::Z * 0.025,
            tissue: Tissue::Bone,
        });
    }

    // Rib cage: seven ribs a side; the lowest two float short of the sternum.
    for (index, half_width) in RIB_WIDTHS.iter().enumerate() {
        let reach = if index >= 5 { 0.72 } else { 1.0 };
        for s in [1.0, -1.0] {
            push_line(
                out,
                &rib_curve(s, rib_back_y(index), *half_width, reach),
                Tissue::Bone,
            );
        }
    }
    push_line(
        out,
        &[
            Vec3::new(0.0, 0.60, 0.085),
            Vec3::new(0.0, 0.42, 0.098),
            Vec3::new(0.0, 0.38, 0.09),
        ],
        Tissue::Bone,
    );

    // Pelvis: the iliac crest ring, the inlet, sockets and pubis.
    push_loop(
        out,
        &ellipse(
            Vec3::new(0.0, 0.08, -0.005),
            Vec3::X,
            Vec3::Z,
            0.14,
            0.075,
            CURVE_POINTS,
        ),
        Tissue::Bone,
    );
    push_loop(
        out,
        &ellipse(
            Vec3::new(0.0, -0.005, 0.0),
            Vec3::X,
            Vec3::Z,
            0.08,
            0.055,
            CURVE_POINTS / 2 + 2,
        ),
        Tissue::Bone,
    );
    push_line(
        out,
        &[Vec3::new(0.0, 0.02, -0.07), Vec3::new(0.0, -0.08, -0.05)],
        Tissue::Bone,
    );

    for side in sides {
        let s = side.s;

        // Shoulder girdle: clavicle and a scapula triangle.
        push_line(
            out,
            &[
                Vec3::new(s * 0.015, 0.62, 0.08),
                side.shoulder + Vec3::Y * 0.02,
            ],
            Tissue::Bone,
        );
        push_loop(
            out,
            &[
                Vec3::new(s * 0.07, 0.60, -0.09),
                Vec3::new(s * 0.17, 0.615, -0.065),
                Vec3::new(s * 0.09, 0.44, -0.09),
            ],
            Tissue::Bone,
        );

        // Hip sockets and pubis.
        push_line(
            out,
            &[
                Vec3::new(s * 0.13, 0.08, 0.02),
                side.hip,
                Vec3::new(s * 0.02, -0.06, 0.06),
            ],
            Tissue::Bone,
        );

        // Long bones; paired bones in the forearm and shin.
        push_line(out, &[side.shoulder, side.elbow], Tissue::Bone);
        push_line(out, &[side.hip, side.knee], Tissue::Bone);
        let across = Vec3::new(0.0, 0.0, 0.012);
        push_line(
            out,
            &[side.elbow + across, side.wrist + across],
            Tissue::Bone,
        );
        push_line(
            out,
            &[side.elbow - across, side.wrist - across],
            Tissue::Bone,
        );
        let beside = Vec3::new(s * 0.02, 0.0, -0.008);
        push_line(out, &[side.knee, side.ankle], Tissue::Bone);
        push_line(
            out,
            &[side.knee + beside + Vec3::Y * -0.03, side.ankle + beside],
            Tissue::Bone,
        );

        // Hand: metacarpals and fingers. Foot: heel and metatarsal fan.
        for (root, tip) in side.finger_roots().iter().zip(side.fingertips()) {
            push_line(out, &[side.wrist, *root, tip], Tissue::Bone);
        }
        push_line(out, &[side.ankle, side.heel], Tissue::Bone);
        for offset in [-0.03, 0.0, 0.03] {
            push_line(
                out,
                &[side.ankle, side.toe + Vec3::new(s * offset, 0.0, -0.01)],
                Tissue::Bone,
            );
        }

        // Joints: a small diamond marks each.
        for joint in [
            side.shoulder,
            side.elbow,
            side.wrist,
            side.hip,
            side.knee,
            side.ankle,
        ] {
            push_loop(
                out,
                &[
                    joint + Vec3::Y * 0.02,
                    joint + Vec3::X * 0.02,
                    joint - Vec3::Y * 0.02,
                    joint - Vec3::X * 0.02,
                ],
                Tissue::Bone,
            );
        }
    }
}

/// The spinal cord from the brain down to height `y`, following the spine.
fn cord_down_to(y: f32) -> Vec<Vec3> {
    let mut points = vec![BRAIN];
    let mut previous = BRAIN;

    for vertebra in SPINE {
        if vertebra.y <= y {
            let t = (previous.y - y) / (previous.y - vertebra.y);
            points.push(previous.lerp(vertebra, t));
            return points;
        }
        points.push(vertebra);
        previous = vertebra;
    }

    points
}

/// A path that runs down the cord to `y`, then on through `rest`.
fn from_cord(y: f32, rest: &[Vec3]) -> Vec<Vec3> {
    let mut points = cord_down_to(y);
    points.extend_from_slice(rest);
    points
}

fn side_nerves(out: &mut Vec<NervePath>, side: &Side) {
    let s = side.s;
    let name = |nerve: &str| {
        let label = if s > 0.0 { "left" } else { "right" };
        format!("{label}_{nerve}")
    };

    // Brachial plexus: three arm nerves, each to its own fingers.
    let plexus = [
        Vec3::new(s * 0.10, 0.63, -0.03),
        Vec3::new(s * 0.185, 0.60, -0.02),
    ];
    let tips = side.fingertips();
    let arm = [
        ("radial", Vec3::new(s * 0.014, 0.0, -0.01), tips[0]),
        ("median", Vec3::new(0.0, 0.0, 0.016), tips[2]),
        ("ulnar", Vec3::new(-s * 0.014, 0.0, -0.012), tips[4]),
    ];
    for (nerve, offset, tip) in arm {
        out.push(NervePath::new(
            name(nerve),
            from_cord(
                0.64,
                &[
                    plexus[0],
                    plexus[1],
                    side.elbow + offset,
                    side.wrist + offset,
                    side.knuckles + offset * 0.5,
                    tip,
                ],
            ),
        ));
    }

    // Intercostals: under ribs two to five.
    for index in 1..5 {
        let back_y = rib_back_y(index) - 0.012;
        let half_width = RIB_WIDTHS.get(index).copied().unwrap_or(0.1) - 0.006;
        out.push(NervePath::new(
            name(&format!("intercostal_{index}")),
            from_cord(back_y, &rib_curve(s, back_y, half_width, 0.86)),
        ));
    }

    // Lumbar plexus into the leg: sciatic splitting at the knee, and femoral.
    let lumbar = Vec3::new(s * 0.04, 0.08, -0.06);
    let sciatic = [
        lumbar,
        Vec3::new(s * 0.09, -0.06, -0.06),
        Vec3::new(s * 0.10, -0.30, -0.045),
        side.knee + Vec3::new(0.0, 0.02, -0.04),
    ];
    let mut tibial = sciatic.to_vec();
    tibial.extend([
        side.ankle + Vec3::new(-s * 0.012, 0.0, -0.03),
        side.heel + Vec3::new(0.0, 0.0, 0.02),
        side.toe + Vec3::new(-s * 0.02, 0.0, -0.03),
    ]);
    out.push(NervePath::new(name("tibial"), from_cord(0.08, &tibial)));

    let mut peroneal = sciatic.to_vec();
    peroneal.extend([
        side.knee + Vec3::new(s * 0.035, -0.06, 0.0),
        side.ankle + Vec3::new(s * 0.01, 0.0, 0.03),
        side.toe + Vec3::new(s * 0.01, 0.01, -0.01),
    ]);
    out.push(NervePath::new(name("peroneal"), from_cord(0.08, &peroneal)));

    out.push(NervePath::new(
        name("femoral"),
        from_cord(
            0.08,
            &[
                lumbar,
                Vec3::new(s * 0.09, -0.02, 0.06),
                Vec3::new(s * 0.085, -0.25, 0.06),
                side.knee + Vec3::new(-s * 0.03, 0.04, 0.03),
                side.ankle + Vec3::new(-s * 0.025, 0.0, 0.01),
            ],
        ),
    ));

    // Optic nerve: a short run from the brain to the eye.
    out.push(NervePath::new(
        name("optic"),
        vec![
            BRAIN,
            Vec3::new(s * 0.022, 0.89, 0.045),
            Vec3::new(s * 0.032, 0.885, 0.08),
        ],
    ));
}

/// Wavy loops over the top of the skull for the cortex, and a midline fissure.
fn brain_folds() -> Vec<(Vec3, Vec3)> {
    let mut out = Vec::new();
    let mut pairs = |points: &[Vec3], closed: bool| {
        let count = if closed {
            points.len()
        } else {
            points.len() - 1
        };
        for index in 0..count {
            let a = points.get(index).copied().unwrap_or(Vec3::ZERO);
            let b = points.get((index + 1) % points.len()).copied().unwrap_or(a);
            out.push((a, b));
        }
    };

    for (height, radius) in [(0.885, 0.06), (0.915, 0.055), (0.945, 0.04)] {
        let points: Vec<Vec3> = (0..28)
            .map(|k| {
                let angle = k as f32 / 28.0 * TAU;
                let wobble = 1.0 + 0.14 * (angle * 7.0).sin();
                Vec3::new(
                    radius * wobble * angle.cos(),
                    height + 0.006 * (angle * 5.0).cos(),
                    -0.005 + radius * 1.15 * wobble * angle.sin(),
                )
            })
            .collect();
        pairs(&points, true);
    }

    let fissure: Vec<Vec3> = (0..=10)
        .map(|k| {
            let angle = k as f32 / 10.0 * PI;
            Vec3::new(0.0, 0.88 + 0.08 * angle.sin(), -0.005 - 0.075 * angle.cos())
        })
        .collect();
    pairs(&fissure, false);

    out
}
