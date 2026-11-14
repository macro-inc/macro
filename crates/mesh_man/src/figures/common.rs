//! Shared geometry for the procedural figures: a draft of line layers, small
//! shape helpers, a seeded random source, the joints of each side and a
//! branching nerve tree.

use std::f32::consts::TAU;

use glam::Vec3;

use crate::figure::Core;
use crate::palette::Look;

/// A straight piece in figure space.
pub(crate) type Seg = (Vec3, Vec3);

/// A figure as its builder leaves it: line layers and nerve paths.
#[derive(Clone, Debug, Default)]
pub(crate) struct Draft {
    pub skin: Vec<Seg>,
    pub bones: Vec<Seg>,
    /// Nerve lines drawn once (trees); pulses run on `paths`.
    pub nerves: Vec<Seg>,
    /// A fourth layer: muscles, armour plates, organs.
    pub extra: Vec<Seg>,
    /// The brain's folds, drawn with the nerves.
    pub brain: Vec<Seg>,
    /// Named polylines from the brain outward, for pulses.
    pub paths: Vec<(String, Vec<Vec3>)>,
    /// Groups of paths (by index) that fire together, so one pulse forks
    /// where they part.
    pub forks: Vec<Vec<usize>>,
    pub look: Look,
    pub core: Option<Core>,
}

/// The segments of an open polyline.
pub(crate) fn line(out: &mut Vec<Seg>, points: &[Vec3]) {
    out.extend(points.windows(2).map(|pair| (pair[0], pair[1])));
}

/// The segments of a closed loop.
pub(crate) fn ring(out: &mut Vec<Seg>, points: &[Vec3]) {
    line(out, points);
    if let (Some(last), Some(first)) = (points.last(), points.first())
        && points.len() > 2
    {
        out.push((*last, *first));
    }
}

/// `n` points round an ellipse about `centre` in the plane of `u` and `v`,
/// from `start` radians.
pub(crate) fn ellipse_from(
    centre: Vec3,
    u: Vec3,
    v: Vec3,
    radii: (f32, f32),
    n: usize,
    start: f32,
) -> Vec<Vec3> {
    (0..n)
        .map(|k| {
            let angle = start + k as f32 / n as f32 * TAU;
            centre + u * (radii.0 * angle.cos()) + v * (radii.1 * angle.sin())
        })
        .collect()
}

/// `n` points round an ellipse about `centre` in the plane of `u` and `v`.
pub(crate) fn ellipse(centre: Vec3, u: Vec3, v: Vec3, radii: (f32, f32), n: usize) -> Vec<Vec3> {
    ellipse_from(centre, u, v, radii, n, 0.0)
}

/// An arc of an ellipse, `n + 1` points from angle `from` to `to`.
pub(crate) fn arc(
    centre: Vec3,
    u: Vec3,
    v: Vec3,
    radii: (f32, f32),
    from: f32,
    to: f32,
    n: usize,
) -> Vec<Vec3> {
    (0..=n)
        .map(|k| {
            let angle = from + (to - from) * k as f32 / n.max(1) as f32;
            centre + u * (radii.0 * angle.cos()) + v * (radii.1 * angle.sin())
        })
        .collect()
}

/// Two axes across `direction`, so rings on a limb sit square to it.
pub(crate) fn frame(direction: Vec3, reference: Vec3) -> (Vec3, Vec3) {
    let direction = direction.normalize_or_zero();
    let u = direction.cross(reference).normalize_or_zero();
    let v = u.cross(direction);
    (u, v)
}

/// A small seeded xorshift source: the figures are random-looking but the
/// same every run.
#[derive(Clone, Debug)]
pub(crate) struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    /// A value in `[0, 1)`.
    pub fn unit(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 40) as f32 / (1u64 << 24) as f32
    }

    /// A value in `[low, high)`.
    pub fn range(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.unit()
    }
}

/// Where the nerves start.
pub(crate) const BRAIN: Vec3 = Vec3::new(0.0, 0.905, -0.005);
/// Centre of the head.
pub(crate) const HEAD: Vec3 = Vec3::new(0.0, 0.875, 0.01);
/// Centre of the heart.
pub(crate) const HEART: Vec3 = Vec3::new(0.045, 0.43, 0.05);

/// The spine's centre line, neck to tailbone.
pub(crate) const SPINE: [Vec3; 6] = [
    Vec3::new(0.0, 0.79, -0.02),
    Vec3::new(0.0, 0.70, -0.04),
    Vec3::new(0.0, 0.56, -0.075),
    Vec3::new(0.0, 0.36, -0.085),
    Vec3::new(0.0, 0.16, -0.065),
    Vec3::new(0.0, 0.02, -0.07),
];

/// Torso cross sections, hips to neck: (height, half width, half depth,
/// forward offset).
pub(crate) const TORSO: [(f32, f32, f32, f32); 11] = [
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

/// The torso section at height `y`, interpolated: (half width, half depth,
/// forward offset).
pub(crate) fn torso_at(y: f32) -> (f32, f32, f32) {
    let first = TORSO[0];
    let mut previous = first;
    for section in TORSO {
        if y <= section.0 {
            let span = section.0 - previous.0;
            let t = if span > 0.0 {
                ((y - previous.0) / span).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let lerp = |a: f32, b: f32| a + (b - a) * t;
            return (
                lerp(previous.1, section.1),
                lerp(previous.2, section.2),
                lerp(previous.3, section.3),
            );
        }
        previous = section;
    }
    (previous.1, previous.2, previous.3)
}

/// A point on the spine at height `y`.
pub(crate) fn spine_at(y: f32) -> Vec3 {
    let mut previous = SPINE[0];
    for vertebra in SPINE {
        if y >= vertebra.y {
            let span = previous.y - vertebra.y;
            let t = if span > 0.0 {
                (previous.y - y) / span
            } else {
                0.0
            };
            return previous.lerp(vertebra, t.clamp(0.0, 1.0));
        }
        previous = vertebra;
    }
    previous
}

/// The spinal cord from the brain down to height `y`.
pub(crate) fn cord_to(y: f32) -> Vec<Vec3> {
    let mut points = vec![BRAIN];
    for vertebra in SPINE {
        if vertebra.y <= y {
            points.push(spine_at(y));
            return points;
        }
        points.push(vertebra);
    }
    points
}

/// The joints of one side; `s` is `+1` for the figure's left.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Side {
    pub s: f32,
    pub shoulder: Vec3,
    pub elbow: Vec3,
    pub wrist: Vec3,
    pub knuckles: Vec3,
    pub hip: Vec3,
    pub knee: Vec3,
    pub ankle: Vec3,
    pub heel: Vec3,
    pub toe: Vec3,
}

impl Side {
    pub fn new(s: f32) -> Self {
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

    pub fn both() -> [Self; 2] {
        [Self::new(1.0), Self::new(-1.0)]
    }

    /// `left_` or `right_` and the name.
    pub fn name(&self, nerve: &str) -> String {
        let label = if self.s > 0.0 { "left" } else { "right" };
        format!("{label}_{nerve}")
    }

    /// Fingertips, thumb first.
    pub fn fingertips(&self) -> [Vec3; 5] {
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
    pub fn finger_roots(&self) -> [Vec3; 5] {
        let s = self.s;
        [
            Vec3::new(s * 0.375, 0.06, 0.04),
            Vec3::new(s * 0.40, 0.0, 0.035),
            Vec3::new(s * 0.41, -0.005, 0.012),
            Vec3::new(s * 0.415, 0.0, -0.01),
            Vec3::new(s * 0.415, 0.01, -0.03),
        ]
    }

    /// Toe tips, big toe first (innermost).
    pub fn toe_tips(&self) -> [Vec3; 5] {
        let s = self.s;
        [
            Vec3::new(s * 0.085, -0.975, 0.165),
            Vec3::new(s * 0.11, -0.978, 0.16),
            Vec3::new(s * 0.13, -0.98, 0.15),
            Vec3::new(s * 0.148, -0.982, 0.138),
            Vec3::new(s * 0.163, -0.984, 0.122),
        ]
    }

    /// Where each toe's metatarsal ends (the ball of the foot).
    pub fn toe_roots(&self) -> [Vec3; 5] {
        let s = self.s;
        [
            Vec3::new(s * 0.088, -0.97, 0.11),
            Vec3::new(s * 0.108, -0.972, 0.105),
            Vec3::new(s * 0.125, -0.975, 0.098),
            Vec3::new(s * 0.14, -0.977, 0.088),
            Vec3::new(s * 0.152, -0.979, 0.075),
        ]
    }
}

/// Limb skin profiles: `(t, radius across, radius front to back)` along a
/// bone, matching the classic figure.
pub(crate) const UPPER_ARM: [(f32, f32, f32); 3] =
    [(0.0, 0.055, 0.055), (0.45, 0.05, 0.048), (1.0, 0.04, 0.04)];
pub(crate) const FOREARM: [(f32, f32, f32); 3] =
    [(0.0, 0.04, 0.04), (0.35, 0.042, 0.038), (1.0, 0.026, 0.022)];
pub(crate) const HAND: [(f32, f32, f32); 2] = [(0.0, 0.026, 0.022), (1.0, 0.018, 0.04)];
pub(crate) const THIGH: [(f32, f32, f32); 3] =
    [(0.0, 0.085, 0.085), (0.4, 0.072, 0.075), (1.0, 0.05, 0.052)];
pub(crate) const SHIN: [(f32, f32, f32); 3] =
    [(0.0, 0.05, 0.052), (0.3, 0.052, 0.058), (1.0, 0.03, 0.032)];
pub(crate) const FOOT: [(f32, f32, f32); 3] =
    [(0.0, 0.03, 0.03), (0.5, 0.04, 0.028), (1.0, 0.035, 0.015)];

/// The radii of a profile at `t`, interpolated.
pub(crate) fn profile_at(profile: &[(f32, f32, f32)], t: f32) -> (f32, f32) {
    let mut previous = profile.first().copied().unwrap_or((0.0, 0.0, 0.0));
    for &point in profile {
        if t <= point.0 {
            let span = point.0 - previous.0;
            let k = if span > 0.0 {
                ((t - previous.0) / span).clamp(0.0, 1.0)
            } else {
                0.0
            };
            return (
                previous.1 + (point.1 - previous.1) * k,
                previous.2 + (point.2 - previous.2) * k,
            );
        }
        previous = point;
    }
    (previous.1, previous.2)
}

/// A limb's skin profile: `(t, radius across, radius front to back)`.
pub(crate) type Profile = &'static [(f32, f32, f32)];

/// Every limb of a side as `(from, to, reference, profile)`.
pub(crate) fn limbs(side: &Side) -> [(Vec3, Vec3, Vec3, Profile); 6] {
    [
        (side.shoulder, side.elbow, Vec3::Z, &UPPER_ARM),
        (side.elbow, side.wrist, Vec3::Z, &FOREARM),
        (side.wrist, side.knuckles, Vec3::Z, &HAND),
        (side.hip, side.knee, Vec3::Z, &THIGH),
        (side.knee, side.ankle, Vec3::Z, &SHIN),
        (side.heel, side.toe, Vec3::Y, &FOOT),
    ]
}

/// How a nerve tree branches.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Branching {
    /// Distance between sprout points along a trunk.
    pub spacing: f32,
    /// Chance of a sprout at each point.
    pub chance: f32,
    /// Length of a first-order branch.
    pub length: f32,
    /// Each order's length relative to its parent.
    pub shrink: f32,
    /// Orders below the trunk.
    pub depth: u8,
    /// Angle off the parent, in radians, low to high.
    pub angle: (f32, f32),
    /// Farthest a branch may stray from its trunk.
    pub reach: f32,
}

/// Branches growing off a trunk polyline, recursively, L-system style: each
/// branch is a segment that forks into two shorter ones. Returns the tree's
/// segments and its leaf paths (sprout point onward).
pub(crate) fn sprout(
    trunk: &[Vec3],
    rules: Branching,
    rng: &mut Rng,
    out: &mut Vec<Seg>,
    leaves: &mut Vec<Vec<Vec3>>,
) {
    for pair in trunk.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let span = a.distance(b);
        let steps = (span / rules.spacing).floor() as usize;
        let direction = (b - a).normalize_or_zero();
        for step in 1..=steps {
            if rng.unit() > rules.chance {
                continue;
            }
            let origin = a.lerp(b, step as f32 / (steps + 1) as f32);
            let mut path = vec![origin];
            grow(
                origin,
                origin,
                direction,
                direction,
                rules.length,
                rules.depth,
                rules,
                rng,
                out,
                &mut path,
                leaves,
            );
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "recursive state of one branch; a struct would only rename it"
)]
fn grow(
    root: Vec3,
    from: Vec3,
    parent: Vec3,
    trunk: Vec3,
    length: f32,
    depth: u8,
    rules: Branching,
    rng: &mut Rng,
    out: &mut Vec<Seg>,
    path: &mut Vec<Vec3>,
    leaves: &mut Vec<Vec<Vec3>>,
) {
    if depth == 0 || length < 0.004 {
        leaves.push(path.clone());
        return;
    }

    // Turn off the parent by a random angle about a random axis across it.
    let (u, v) = frame(
        parent,
        if parent.y.abs() > 0.9 {
            Vec3::X
        } else {
            Vec3::Y
        },
    );
    let spin = rng.range(0.0, TAU);
    let axis = u * spin.cos() + v * spin.sin();
    let angle = rng.range(rules.angle.0, rules.angle.1);
    let direction = (parent * angle.cos() + axis * angle.sin()).normalize_or_zero();

    let mut to = from + direction * length;
    // Keep it near the trunk: clamp the part across the trunk.
    let offset = to - root;
    let along = trunk * offset.dot(trunk);
    let across = offset - along;
    if across.length() > rules.reach {
        to = root + along + across.normalize_or_zero() * rules.reach;
    }
    to = to.clamp(Vec3::splat(-0.99), Vec3::splat(0.99));

    out.push((from, to));
    path.push(to);

    let next = rules.shrink * length;
    let children = if depth > 1 { 2 } else { 1 };
    for _ in 0..children {
        let mut branch = path.clone();
        grow(
            root,
            to,
            direction,
            trunk,
            next * rng.range(0.8, 1.15),
            depth - 1,
            rules,
            rng,
            out,
            &mut branch,
            leaves,
        );
    }
}

/// A plain skeleton for one side, like the classic figure's: half a rib
/// cage, collarbone, hip, long bones, fingers and a foot fan.
pub(crate) fn simple_bones(out: &mut Vec<Seg>, side: &Side) {
    let s = side.s;
    // Half a rib cage and the sternum.
    for index in 0..7 {
        let back_y = 0.6 - index as f32 * 0.04;
        let width = [0.075, 0.105, 0.125, 0.138, 0.145, 0.142, 0.132]
            .get(index)
            .copied()
            .unwrap_or(0.1);
        let points: Vec<Vec3> = (0..9)
            .map(|k| {
                let theta = k as f32 / 8.0 * std::f32::consts::PI * 0.95;
                let around = (1.0 - theta.cos()) / 2.0;
                Vec3::new(
                    s * width * theta.sin(),
                    back_y - 0.07 * around,
                    0.01 - 0.085 * theta.cos(),
                )
            })
            .collect();
        line(out, &points);
    }
    line(
        out,
        &[Vec3::new(0.0, 0.6, 0.085), Vec3::new(0.0, 0.4, 0.095)],
    );
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
            Vec3::new(s * 0.02, -0.06, 0.06),
        ],
    );

    line(out, &[side.shoulder, side.elbow]);
    let across = Vec3::new(0.0, 0.0, 0.012);
    line(out, &[side.elbow + across, side.wrist + across]);
    line(out, &[side.elbow - across, side.wrist - across]);
    line(out, &[side.hip, side.knee]);
    line(out, &[side.knee, side.ankle]);
    line(
        out,
        &[
            side.knee + Vec3::new(s * 0.02, -0.03, -0.008),
            side.ankle + Vec3::new(s * 0.02, 0.0, -0.008),
        ],
    );
    for (root, tip) in side.finger_roots().iter().zip(side.fingertips()) {
        line(out, &[side.wrist, *root, tip]);
    }
    line(out, &[side.ankle, side.heel]);
    for offset in [-0.03, 0.0, 0.03] {
        line(
            out,
            &[side.ankle, side.toe + Vec3::new(s * offset, 0.0, -0.01)],
        );
    }
}
