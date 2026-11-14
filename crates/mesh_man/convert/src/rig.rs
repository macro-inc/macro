//! Joints of a figure and the nerves routed along them, named as on the
//! hand-made mesh man so a caller firing a nerve by name hits every figure.

use std::f32::consts::{PI, TAU};

use glam::Vec3;

use crate::mesh::Mesh;

/// The joints of one side, in figure units.
#[derive(Clone, Copy, Debug)]
pub struct Side {
    pub shoulder: Vec3,
    pub elbow: Vec3,
    pub wrist: Vec3,
    /// Thumb first.
    pub fingertips: [Vec3; 5],
    pub hip: Vec3,
    pub knee: Vec3,
    pub ankle: Vec3,
    pub heel: Vec3,
    pub toe: Vec3,
    pub eye: Vec3,
}

pub struct Rig {
    pub brain: Vec3,
    /// The cord's route, top (neck) to bottom (sacrum).
    pub spine: Vec<Vec3>,
    pub heart: Vec3,
    pub left: Side,
    pub right: Side,
}

impl Rig {
    /// The cord from the brain down to height `y`.
    fn cord_to(&self, y: f32) -> Vec<Vec3> {
        let mut points = vec![self.brain];
        let mut previous = self.brain;
        for &v in &self.spine {
            if v.y <= y {
                let t = (previous.y - y) / (previous.y - v.y).max(1e-6);
                points.push(previous.lerp(v, t));
                return points;
            }
            points.push(v);
            previous = v;
        }
        points
    }

    fn from_cord(&self, y: f32, rest: &[Vec3]) -> Vec<Vec3> {
        let mut points = self.cord_to(y);
        points.extend_from_slice(rest);
        points
    }

    /// Every nerve, in the mesh man's order.
    pub fn nerves(&self, skin: &Mesh) -> Vec<(String, Vec<Vec3>)> {
        let mut out = Vec::new();
        let bottom = self.spine.last().map_or(-0.0, |p| p.y);
        out.push(("spinal_cord".to_owned(), self.cord_to(bottom)));
        for (label, side, s) in [("left", &self.left, 1.0_f32), ("right", &self.right, -1.0)] {
            let name = |n: &str| format!("{label}_{n}");
            let neck_y = side.shoulder.y + 0.02;
            let root = self.cord_to(neck_y).last().copied().unwrap_or(self.brain);
            let plexus = [
                root.lerp(side.shoulder, 0.4) + Vec3::new(0.0, 0.0, -0.01),
                root.lerp(side.shoulder, 0.85),
            ];
            let arm = side.elbow - side.shoulder;
            let across = arm.cross(Vec3::Z).normalize_or_zero() * 0.014;
            let front = arm.cross(across).normalize_or_zero() * 0.014;
            for (nerve, offset, tip) in [
                ("radial", across * s, side.fingertips[0]),
                ("median", front, side.fingertips[2]),
                ("ulnar", -across * s, side.fingertips[4]),
            ] {
                out.push((
                    name(nerve),
                    self.from_cord(
                        neck_y,
                        &[plexus[0], plexus[1], side.elbow + offset, side.wrist + offset, tip],
                    ),
                ));
            }

            // Intercostals: around the torso at four heights.
            let pelvis_y = bottom;
            for index in 1..5 {
                let y = side.shoulder.y - 0.06 - index as f32 * (side.shoulder.y - pelvis_y) * 0.11;
                let (centre, half) = torso_section(skin, y);
                let back = self.cord_to(y).last().copied().unwrap_or(centre);
                let points = (0..10).map(|k| {
                    let theta = k as f32 / 9.0 * PI * 0.86;
                    Vec3::new(
                        centre.x + s * half.x * 0.82 * theta.sin(),
                        y - 0.05 * (1.0 - theta.cos()) / 2.0,
                        centre.z - half.y * 0.8 * theta.cos(),
                    )
                });
                let mut path = self.cord_to(y);
                path.push(back.lerp(Vec3::new(centre.x, y, centre.z - half.y * 0.8), 0.5));
                path.extend(points.skip(1));
                out.push((name(&format!("intercostal_{index}")), path));
            }

            let lumbar = Vec3::new(s * 0.04, bottom + 0.02, self.spine.last().map_or(0.0, |p| p.z));
            let lumbar_y = lumbar.y + 0.03;
            let back = Vec3::new(0.0, 0.0, -0.035);
            let sciatic = [
                lumbar,
                side.hip + back + Vec3::new(-s * 0.01, -0.05, 0.0),
                side.hip.lerp(side.knee, 0.5) + back,
                side.knee + back,
            ];
            let mut tibial = sciatic.to_vec();
            tibial.extend([side.ankle + back * 0.8, side.heel, side.toe + Vec3::new(-s * 0.02, 0.0, -0.02)]);
            out.push((name("tibial"), self.from_cord(lumbar_y, &tibial)));
            let mut peroneal = sciatic.to_vec();
            peroneal.extend([
                side.knee + Vec3::new(s * 0.035, -0.06, 0.0),
                side.ankle + Vec3::new(s * 0.012, 0.0, 0.03),
                side.toe + Vec3::new(s * 0.01, 0.01, 0.0),
            ]);
            out.push((name("peroneal"), self.from_cord(lumbar_y, &peroneal)));
            out.push((
                name("femoral"),
                self.from_cord(
                    lumbar_y,
                    &[
                        lumbar,
                        side.hip + Vec3::new(-s * 0.01, -0.03, 0.05),
                        side.hip.lerp(side.knee, 0.5) + Vec3::new(-s * 0.01, 0.0, 0.05),
                        side.knee + Vec3::new(-s * 0.03, 0.04, 0.03),
                        side.ankle + Vec3::new(-s * 0.025, 0.0, 0.01),
                    ],
                ),
            ));
            out.push((
                name("optic"),
                vec![self.brain, self.brain.lerp(side.eye, 0.5), side.eye],
            ));
        }
        let neck = self.spine.first().copied().unwrap_or(self.brain);
        out.push((
            "vagus".to_owned(),
            vec![
                self.brain,
                neck + Vec3::new(0.02, 0.0, 0.03),
                neck.lerp(self.heart, 0.5) + Vec3::new(0.02, 0.0, 0.02),
                self.heart,
            ],
        ));
        out
    }
}

/// The torso's centre and half width/depth at height `y`, from the skin's
/// vertices in a thin band, keeping those near the middle (not the arms).
fn torso_section(skin: &Mesh, y: f32) -> (Vec3, glam::Vec2) {
    let band: Vec<Vec3> = skin
        .positions
        .iter()
        .copied()
        .filter(|p| (p.y - y).abs() < 0.02 && p.x.abs() < 0.2)
        .collect();
    if band.is_empty() {
        return (Vec3::new(0.0, y, 0.0), glam::Vec2::new(0.12, 0.08));
    }
    let (lo, hi) = band.iter().fold(
        (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY)),
        |(lo, hi), p| (lo.min(*p), hi.max(*p)),
    );
    let centre = (lo + hi) * 0.5;
    (
        Vec3::new(centre.x, y, centre.z),
        glam::Vec2::new((hi.x - lo.x) / 2.0, (hi.z - lo.z) / 2.0),
    )
}

/// An ellipse polyline, closed.
pub fn ellipse(centre: Vec3, u: Vec3, v: Vec3, ru: f32, rv: f32, n: usize) -> Vec<Vec3> {
    (0..=n)
        .map(|k| {
            let a = k as f32 / n as f32 * TAU;
            centre + u * (ru * a.cos()) + v * (rv * a.sin())
        })
        .collect()
}

/// Ribs hung on the spine between `top` and `bottom`, sized from the skin.
pub fn rib_cage(top: Vec3, bottom: Vec3, skin: &Mesh) -> Vec<Vec<Vec3>> {
    let mut out = Vec::new();
    let count = 7;
    for index in 0..count {
        let back = top.lerp(bottom, index as f32 / (count as f32 + 1.0) * 0.9);
        let (centre, half) = torso_section(skin, back.y);
        let reach = if index >= 5 { 0.72 } else { 1.0 };
        for s in [1.0_f32, -1.0] {
            out.push(
                (0..10)
                    .map(|k| {
                        let theta = k as f32 / 9.0 * PI * reach;
                        Vec3::new(
                            centre.x + s * half.x * 0.78 * theta.sin(),
                            back.y - 0.06 * (1.0 - theta.cos()) / 2.0,
                            centre.z - half.y * 0.75 * theta.cos(),
                        )
                    })
                    .collect(),
            );
        }
    }
    out
}

/// Three wavy loops for a brain centred at `centre`.
pub fn brain_loops(centre: Vec3, radius: f32) -> Vec<Vec<Vec3>> {
    [(-0.02, 1.0), (0.01, 0.9), (0.035, 0.65)]
        .iter()
        .map(|&(dy, r)| {
            (0..=28)
                .map(|k| {
                    let a = k as f32 / 28.0 * TAU;
                    let wobble = 1.0 + 0.14 * (a * 7.0).sin();
                    centre
                        + Vec3::new(
                            radius * r * wobble * a.cos(),
                            dy + 0.006 * (a * 5.0).cos(),
                            radius * r * 1.15 * wobble * a.sin(),
                        )
                })
                .collect()
        })
        .collect()
}
