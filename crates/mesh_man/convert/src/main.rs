//! Turns downloaded meshes into mesh man figures: compact line data in the
//! `.mmf` format that `mesh_man`'s `assets` module reads.
//!
//! Lines come from slicing each mesh with evenly spaced planes (contour
//! rings, like the hand-made mesh man's skin rings), simplified and stored as
//! quantised polylines. Nerves are routed along the figure's joints (from a
//! glTF skin or from bone meshes) with the mesh man's nerve names.

mod format;
mod mesh;
mod rig;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use glam::{Mat4, Quat, Vec3};

use crate::format::{Kind, Out};
use crate::mesh::{Mesh, SliceSpec};
use crate::rig::{Rig, Side};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// BodyParts3D (partof, OBJ, mm) into a skeleton + brain + skin figure.
    Anatomical {
        /// Directory holding `partof_element_parts.txt` and `obj/`.
        bp3d: PathBuf,
        /// Where to write the `.mmf`.
        out: PathBuf,
        #[arg(long, default_value = "ANATOMICAL")]
        name: String,
    },
    /// A rigged glTF character, posed at one animation frame.
    Rigged {
        glb: PathBuf,
        out: PathBuf,
        #[arg(long, default_value = "RIGGED")]
        name: String,
        /// Animation to pose with (by name); none keeps the bind pose.
        #[arg(long)]
        animation: Option<String>,
        /// Seconds into the animation.
        #[arg(long, default_value_t = 0.0)]
        time: f32,
        /// Slice spacing for the skin, in figure units.
        #[arg(long, default_value_t = 0.06)]
        skin_step: f32,
    },
    /// Lists a glTF's animations and joints.
    Inspect { glb: PathBuf },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    match Cli::parse().command {
        Command::Anatomical { bp3d, out, name } => anatomical(&bp3d, &out, &name),
        Command::Rigged {
            glb,
            out,
            name,
            animation,
            time,
            skin_step,
        } => rigged(&glb, &out, &name, animation.as_deref(), time, skin_step),
        Command::Inspect { glb } => inspect(&glb),
    }
}

// ---------------------------------------------------------------- BodyParts3D

/// BodyParts3D element files by English name, and concept memberships.
struct Bp3d {
    dir: PathBuf,
    /// element id -> English name.
    names: HashMap<String, String>,
    /// concept id -> element ids.
    concepts: HashMap<String, Vec<String>>,
}

impl Bp3d {
    fn open(root: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = root.join("obj/partof_BP3D_4.0_obj_99");
        let mut names = HashMap::new();
        for entry in fs::read_dir(&dir)? {
            let path = entry?.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let text = fs::read_to_string(&path)?;
            let name = text
                .lines()
                .take(20)
                .find_map(|line| line.strip_prefix("# English name :"))
                .unwrap_or("")
                .trim()
                .to_owned();
            names.insert(id.to_owned(), name);
        }
        let mut concepts: HashMap<String, Vec<String>> = HashMap::new();
        for line in fs::read_to_string(root.join("partof_element_parts.txt"))?.lines() {
            let fields: Vec<&str> = line.split('\t').collect();
            if let [concept, _, element] = fields[..] {
                concepts
                    .entry(concept.to_owned())
                    .or_default()
                    .push(element.trim().to_owned());
            }
        }
        Ok(Self {
            dir,
            names,
            concepts,
        })
    }

    fn ids_where(&self, keep: impl Fn(&str) -> bool) -> Vec<String> {
        let mut ids: Vec<String> = self
            .names
            .iter()
            .filter(|(_, name)| keep(&name.to_ascii_lowercase()))
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// Loads each element as its own mesh, mapped by `f`.
    fn load_each(&self, ids: &[String], f: impl Fn(Vec3) -> Vec3 + Copy) -> Vec<Mesh> {
        ids.iter()
            .map(|id| {
                let mut mesh = self.load(std::slice::from_ref(id));
                mesh.map(f);
                mesh
            })
            .filter(|mesh| !mesh.positions.is_empty())
            .collect()
    }

    fn named(&self, name: &str) -> Vec<String> {
        self.ids_where(|n| n == name.to_ascii_lowercase())
    }

    /// Loads elements into one mesh, mm in BodyParts3D axes (x left, -y
    /// front, z up) mapped to figure axes (x left, y up, z front).
    fn load(&self, ids: &[String]) -> Mesh {
        let mut mesh = Mesh::default();
        for id in ids {
            let path = self.dir.join(format!("{id}.obj"));
            let Ok((models, _)) = tobj::load_obj(&path, &tobj::GPU_LOAD_OPTIONS) else {
                eprintln!("skip {id}");
                continue;
            };
            for model in models {
                let m = &model.mesh;
                let points = m
                    .positions
                    .chunks_exact(3)
                    .map(|p| Vec3::new(p[0], p[2], -p[1]));
                mesh.append(points, m.indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]));
            }
        }
        mesh.weld();
        mesh
    }
}

const BONE_WORDS: &[&str] = &[
    "bone", "vertebra", " rib", "femur", "tibia", "fibula", "patella", "humerus", "radius",
    "ulna", "scapula", "clavicle", "sternum", "sacrum", "coccyx", "phalanx", "metacarpal",
    "metatarsal", "scaphoid", "lunate", "triquetral", "pisiform", "trapezium", "trapezoid",
    "capitate", "hamate", "talus", "calcaneus", "cuboid", "cuneiform", "navicular", "maxilla",
    "mandible", "vomer", "ethmoid", "xiphoid", "costal cartilage", "manubrium", "atlas", "axis",
];
const NOT_BONE: &[&str] = &[
    "artery", "vein", "muscle", "nerve", "ligament", "branch", "disk", "fascia", "tract",
];

fn is_bone(name: &str) -> bool {
    let padded = format!(" {name}");
    BONE_WORDS.iter().any(|w| padded.contains(w)) && !NOT_BONE.iter().any(|w| name.contains(w))
}

fn anatomical(root: &Path, out_path: &Path, name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let bp = Bp3d::open(root)?;

    let skin_ids = bp.named("skin");
    let mut skin = bp.load(&skin_ids);
    let (low, high) = skin.bounds();
    let hips = bp.load(&bp.ids_where(|n| n.ends_with("hip bone")));
    let (hip_low, hip_high) = hips.bounds();
    let pelvis = (hip_low + hip_high) * 0.5;
    let height = high.y - low.y;
    let scale = 2.0 / height;
    let to_figure = move |p: Vec3| {
        let q = (p - Vec3::new(0.0, low.y, pelvis.z)) * scale;
        Vec3::new(q.x, q.y - 1.0, q.z)
    };
    skin.map(to_figure);

    let bone_ids = bp.ids_where(is_bone);
    let mut bones = bp.load(&bone_ids);
    bones.map(to_figure);

    let nervous: HashSet<String> = bp
        .concepts
        .get("FMA7157")
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .collect();
    let brain_ids: Vec<String> = nervous
        .iter()
        .filter(|id| {
            let n = bp.names.get(*id).map(|s| s.to_ascii_lowercase()).unwrap_or_default();
            !n.contains("ventricle") && !n.contains("canal") && !n.contains("aqueduct")
        })
        .cloned()
        .collect();
    let mut brain = bp.load(&brain_ids);
    brain.map(to_figure);

    let heart_ids = bp.concepts.get("FMA7088").cloned().unwrap_or_default();
    let mut heart = bp.load(&heart_ids);
    heart.map(to_figure);

    let piece = |name: &str| {
        let mut mesh = bp.load(&bp.named(name));
        mesh.map(to_figure);
        mesh
    };

    // Joints from the bones' ends.
    let side = |label: &str| -> Side {
        let humerus = piece(&format!("{label} humerus"));
        let radius = piece(&format!("{label} radius"));
        let femur = piece(&format!("{label} femur"));
        let tibia = piece(&format!("{label} tibia"));
        let calcaneus = piece(&format!("{label} calcaneus"));
        let fingers = ["thumb", "index finger", "middle finger", "ring finger", "little finger"]
            .map(|f| piece(&format!("distal phalanx of {label} {f}")).lowest());
        let toe = piece(&format!("distal phalanx of {label} big toe")).centroid();
        Side {
            shoulder: humerus.end_centroid(true, 0.06),
            elbow: humerus.end_centroid(false, 0.06),
            wrist: radius.end_centroid(false, 0.06),
            fingertips: fingers,
            hip: femur.end_centroid(true, 0.06),
            knee: femur.end_centroid(false, 0.05),
            ankle: tibia.end_centroid(false, 0.05),
            heel: calcaneus.centroid(),
            toe,
            eye: piece(&format!("{label} cornea")).centroid(),
        }
    };
    let left = side("left");
    let right = side("right");

    let mut spine: Vec<Vec3> = bp
        .ids_where(|n| n.ends_with(" vertebra") && !n.contains("disk") || n == "atlas" || n == "axis")
        .iter()
        .map(|id| {
            let mut m = bp.load(std::slice::from_ref(id));
            m.map(to_figure);
            m.centroid()
        })
        .collect();
    let sacrum = piece("sacrum");
    if !sacrum.positions.is_empty() {
        spine.push(sacrum.centroid());
    }
    spine.sort_by(|a, b| b.y.total_cmp(&a.y));
    // Run the cord behind the vertebral bodies, in the canal.
    let spine: Vec<Vec3> = spine.iter().map(|p| *p - Vec3::Z * 0.012).collect();

    let rig = Rig {
        brain: brain.centroid(),
        spine,
        heart: heart.centroid(),
        left,
        right,
    };

    let mut out = Out::new(name);
    out.core_heart(rig.heart);
    let skin_spec = SliceSpec {
        steps: [0.2, 0.06, 0.25],
        tolerance: 0.006,
        min_extent: 0.02,
    };
    out.lines(Kind::Skin, &skin.contours(&skin_spec));
    let bone_lines: Vec<Vec<Vec3>> = bp
        .load_each(&bone_ids, to_figure)
        .iter()
        .flat_map(|part| part.part_outlines([true, false, true], 0.09, 0.004, 0.012))
        .collect();
    out.lines(Kind::Bone, &bone_lines);
    let heart_spec = SliceSpec {
        steps: [0.0, 0.02, 0.0],
        tolerance: 0.003,
        min_extent: 0.01,
    };
    out.lines(Kind::Extra, &heart.contours(&heart_spec));
    let brain_spec = SliceSpec {
        steps: [0.05, 0.035, 0.0],
        tolerance: 0.004,
        min_extent: 0.015,
    };
    out.lines(Kind::Brain, &brain.contours(&brain_spec));
    let torso = skin.clone();
    for (nerve, points) in rig.nerves(&torso) {
        out.nerve(&nerve, &points);
    }
    out.write(out_path)?;
    Ok(())
}

// ---------------------------------------------------------------- glTF

fn inspect(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let (doc, _, _) = gltf::import(path)?;
    for animation in doc.animations() {
        let mut end = 0.0_f32;
        for channel in animation.channels() {
            let max = channel
                .sampler()
                .input()
                .max()
                .and_then(|v| v.as_array().and_then(|a| a.first()).and_then(|x| x.as_f64()))
                .unwrap_or(0.0) as f32;
            end = end.max(max);
        }
        println!("animation {:?} {end:.2}s", animation.name());
    }
    for skin in doc.skins() {
        let joints: Vec<String> = skin.joints().map(|j| j.name().unwrap_or("?").to_owned()).collect();
        println!("skin {:?}: {} joints: {}", skin.name(), joints.len(), joints.join(" "));
    }
    for mesh in doc.meshes() {
        println!("mesh {:?} {} primitives", mesh.name(), mesh.primitives().count());
    }
    Ok(())
}

/// Local transforms of every node, at an animation time.
fn posed_locals(doc: &gltf::Document, buffers: &[gltf::buffer::Data], animation: Option<&str>, time: f32) -> Vec<(Vec3, Quat, Vec3)> {
    let mut locals: Vec<(Vec3, Quat, Vec3)> = doc
        .nodes()
        .map(|node| {
            let (t, r, s) = node.transform().decomposed();
            (Vec3::from(t), Quat::from_array(r), Vec3::from(s))
        })
        .collect();
    let Some(wanted) = animation else {
        return locals;
    };
    let Some(anim) = doc.animations().find(|a| a.name() == Some(wanted)) else {
        eprintln!("no animation {wanted}");
        return locals;
    };
    for channel in anim.channels() {
        let reader = channel.reader(|b| Some(&buffers[b.index()]));
        let Some(inputs) = reader.read_inputs() else { continue };
        let inputs: Vec<f32> = inputs.collect();
        let Some(outputs) = reader.read_outputs() else { continue };
        // Find the keyframe pair around `time`.
        let k = inputs.iter().rposition(|t| *t <= time).unwrap_or(0);
        let k1 = (k + 1).min(inputs.len().saturating_sub(1));
        let span = inputs[k1] - inputs[k];
        let f = if span > 0.0 { ((time - inputs[k]) / span).clamp(0.0, 1.0) } else { 0.0 };
        let node = channel.target().node().index();
        let cubic = channel.sampler().interpolation() == gltf::animation::Interpolation::CubicSpline;
        let pick = |i: usize| if cubic { i * 3 + 1 } else { i };
        match outputs {
            gltf::animation::util::ReadOutputs::Translations(it) => {
                let v: Vec<[f32; 3]> = it.collect();
                let a = Vec3::from(v[pick(k)]);
                let b = Vec3::from(v[pick(k1)]);
                locals[node].0 = a.lerp(b, f);
            }
            gltf::animation::util::ReadOutputs::Rotations(it) => {
                let v: Vec<[f32; 4]> = it.into_f32().collect();
                let a = Quat::from_array(v[pick(k)]);
                let b = Quat::from_array(v[pick(k1)]);
                locals[node].1 = a.slerp(b, f).normalize();
            }
            gltf::animation::util::ReadOutputs::Scales(it) => {
                let v: Vec<[f32; 3]> = it.collect();
                locals[node].2 = Vec3::from(v[pick(k)]).lerp(Vec3::from(v[pick(k1)]), f);
            }
            gltf::animation::util::ReadOutputs::MorphTargetWeights(_) => {}
        }
    }
    locals
}

fn rigged(
    path: &Path,
    out_path: &Path,
    name: &str,
    animation: Option<&str>,
    time: f32,
    skin_step: f32,
) -> Result<(), Box<dyn std::error::Error>> {
    let (doc, buffers, _) = gltf::import(path)?;
    let locals = posed_locals(&doc, &buffers, animation, time);

    // Global transforms through the node tree.
    let mut parent = vec![None; doc.nodes().count()];
    for node in doc.nodes() {
        for child in node.children() {
            parent[child.index()] = Some(node.index());
        }
    }
    let mut global = vec![None::<Mat4>; parent.len()];
    fn resolve(i: usize, parent: &[Option<usize>], locals: &[(Vec3, Quat, Vec3)], global: &mut [Option<Mat4>]) -> Mat4 {
        if let Some(m) = global[i] {
            return m;
        }
        let (t, r, s) = locals[i];
        let local = Mat4::from_scale_rotation_translation(s, r, t);
        let m = match parent[i] {
            Some(p) => resolve(p, parent, locals, global) * local,
            None => local,
        };
        global[i] = Some(m);
        m
    }
    for i in 0..parent.len() {
        resolve(i, &parent, &locals, &mut global);
    }
    let global: Vec<Mat4> = global.into_iter().map(|m| m.unwrap_or(Mat4::IDENTITY)).collect();

    // Skinned mesh vertices.
    let mut mesh = Mesh::default();
    let mut joint_world: HashMap<String, Vec3> = HashMap::new();
    let mut bones: Vec<(Vec3, Vec3)> = Vec::new();
    for node in doc.nodes() {
        let Some(gmesh) = node.mesh() else { continue };
        let skin = node.skin();
        let joint_mats: Vec<Mat4> = match &skin {
            Some(skin) => {
                let reader = skin.reader(|b| Some(&buffers[b.index()]));
                let ibms: Vec<Mat4> = reader
                    .read_inverse_bind_matrices()
                    .map(|it| it.map(|m| Mat4::from_cols_array_2d(&m)).collect())
                    .unwrap_or_default();
                skin.joints()
                    .enumerate()
                    .map(|(k, j)| global[j.index()] * ibms.get(k).copied().unwrap_or(Mat4::IDENTITY))
                    .collect()
            }
            None => Vec::new(),
        };
        for primitive in gmesh.primitives() {
            let reader = primitive.reader(|b| Some(&buffers[b.index()]));
            let Some(positions) = reader.read_positions() else { continue };
            let positions: Vec<Vec3> = positions.map(Vec3::from).collect();
            let joints: Option<Vec<[u16; 4]>> = reader.read_joints(0).map(|j| j.into_u16().collect());
            let weights: Option<Vec<[f32; 4]>> = reader.read_weights(0).map(|w| w.into_f32().collect());
            let posed: Vec<Vec3> = positions
                .iter()
                .enumerate()
                .map(|(i, p)| match (&joints, &weights) {
                    (Some(js), Some(ws)) if !joint_mats.is_empty() => {
                        let mut m = Mat4::ZERO;
                        for c in 0..4 {
                            let w = ws[i][c];
                            if w > 0.0 {
                                m += joint_mats[js[i][c] as usize] * w;
                            }
                        }
                        m.transform_point3(*p)
                    }
                    _ => global[node.index()].transform_point3(*p),
                })
                .collect();
            let indices: Vec<u32> = match reader.read_indices() {
                Some(it) => it.into_u32().collect(),
                None => (0..posed.len() as u32).collect(),
            };
            mesh.append(posed.into_iter(), indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]));
        }
        if let Some(skin) = skin {
            let joint_set: HashSet<usize> = skin.joints().map(|j| j.index()).collect();
            for j in skin.joints() {
                let name = j.name().unwrap_or("").replace("mixamorig:", "").replace("mixamorig_", "");
                let p = global[j.index()].transform_point3(Vec3::ZERO);
                joint_world.insert(name, p);
                if let Some(pi) = parent[j.index()]
                    && joint_set.contains(&pi)
                {
                    bones.push((global[pi].transform_point3(Vec3::ZERO), p));
                }
            }
        }
    }
    mesh.weld();

    // Normalise on the mesh height, centred on the hips joint.
    let (low, high) = mesh.bounds();
    let hips = joint_world.get("Hips").copied().unwrap_or((low + high) * 0.5);
    let scale = 2.0 / (high.y - low.y);
    let to_figure = move |p: Vec3| {
        let q = (p - Vec3::new(hips.x, low.y, hips.z)) * scale;
        Vec3::new(q.x, q.y - 1.0, q.z)
    };
    mesh.map(to_figure);
    for p in joint_world.values_mut() {
        *p = to_figure(*p);
    }
    let bones: Vec<(Vec3, Vec3)> = bones.into_iter().map(|(a, b)| (to_figure(a), to_figure(b))).collect();

    let j = |n: &str| joint_world.get(n).copied().unwrap_or_else(|| {
        eprintln!("missing joint {n}");
        Vec3::ZERO
    });
    let head = j("Head");
    let top = joint_world.get("HeadTop_End").copied().unwrap_or(head + Vec3::Y * 0.2);
    let side = |l: &str| Side {
        shoulder: j(&format!("{l}Arm")),
        elbow: j(&format!("{l}ForeArm")),
        wrist: j(&format!("{l}Hand")),
        fingertips: ["Thumb", "Index", "Middle", "Ring", "Pinky"].map(|f| {
            joint_world
                .get(&format!("{l}Hand{f}4"))
                .or_else(|| joint_world.get(&format!("{l}Hand{f}3")))
                .copied()
                .unwrap_or(j(&format!("{l}Hand")))
        }),
        hip: j(&format!("{l}UpLeg")),
        knee: j(&format!("{l}Leg")),
        ankle: j(&format!("{l}Foot")),
        heel: j(&format!("{l}Foot")) + Vec3::new(0.0, -0.04, -0.03),
        toe: joint_world.get(&format!("{l}Toe_End")).copied().unwrap_or(j(&format!("{l}ToeBase"))),
        eye: head.lerp(top, 0.45) + Vec3::Z * 0.09 + Vec3::X * if l == "Left" { 0.03 } else { -0.03 },
    };
    let brain = head.lerp(top, 0.6);
    let spine = vec![
        head.lerp(top, 0.15),
        j("Neck"),
        j("Spine2"),
        j("Spine1"),
        j("Spine"),
        j("Hips"),
    ];
    let spine: Vec<Vec3> = spine.into_iter().map(|p| p - Vec3::Z * 0.03).collect();
    let heart = j("Spine2").lerp(j("Spine1"), 0.4) + Vec3::new(0.03, 0.0, 0.05);
    let rig = Rig {
        brain,
        spine,
        heart,
        left: side("Left"),
        right: side("Right"),
    };

    let mut out = Out::new(name);
    out.core_heart(rig.heart);
    let skin_spec = SliceSpec {
        steps: [0.2, skin_step, 0.25],
        tolerance: 0.006,
        min_extent: 0.02,
    };
    out.lines(Kind::Skin, &mesh.contours(&skin_spec));
    let joint_mark = 0.018;
    let mut bone_lines: Vec<Vec<Vec3>> = bones.iter().map(|(a, b)| vec![*a, *b]).collect();
    for name in [
        "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm",
        "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
    ] {
        if let Some(p) = joint_world.get(name) {
            let d = joint_mark;
            bone_lines.push(vec![
                *p + Vec3::Y * d,
                *p + Vec3::X * d,
                *p - Vec3::Y * d,
                *p - Vec3::X * d,
                *p + Vec3::Y * d,
            ]);
        }
    }
    // A skull ring and a rib cage hung on the spine joints, so the stick
    // skeleton reads as bones.
    let skull_centre = head.lerp(top, 0.5);
    for (u, v) in [(Vec3::X, Vec3::Z), (Vec3::Y, Vec3::Z), (Vec3::X, Vec3::Y)] {
        bone_lines.push(rig::ellipse(skull_centre, u, v, 0.075, 0.09, 18));
    }
    bone_lines.extend(rig::rib_cage(j("Spine2") - Vec3::Z * 0.02, j("Spine") - Vec3::Z * 0.02, &mesh));
    out.lines(Kind::Bone, &bone_lines);
    // A small brain: three wavy loops in the skull.
    out.lines(Kind::Brain, &rig::brain_loops(brain, 0.055));
    for (nerve, points) in rig.nerves(&mesh) {
        out.nerve(&nerve, &points);
    }
    out.write(out_path)?;
    Ok(())
}
