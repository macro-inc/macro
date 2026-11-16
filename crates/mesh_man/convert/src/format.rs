//! The `.mmf` writer. Little endian throughout:
//!
//! ```text
//! "MMF1"
//! u8 name length, name bytes (UTF-8)
//! u8 core kind (0 none, 1 heart, 2 reactor), point
//! u32 polyline count, then per polyline:
//!     u8 kind (0 skin, 1 bone, 2 extra, 3 brain, 4 nerve line)
//!     u16 point count, points
//! u16 nerve count, then per nerve:
//!     u8 name length, name bytes, u16 point count, points
//! point = 3 x i16, each coordinate * 32000, in figure units
//! ```

use std::fs;
use std::path::Path;

use glam::Vec3;

pub const SCALE: f32 = 32000.0;

#[derive(Clone, Copy, Debug)]
pub enum Kind {
    Skin = 0,
    Bone = 1,
    Extra = 2,
    Brain = 3,
}

pub struct Out {
    name: String,
    core: Option<Vec3>,
    lines: Vec<(Kind, Vec<Vec3>)>,
    nerves: Vec<(String, Vec<Vec3>)>,
}

impl Out {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            core: None,
            lines: Vec::new(),
            nerves: Vec::new(),
        }
    }

    pub fn core_heart(&mut self, at: Vec3) {
        self.core = Some(at);
    }

    pub fn lines(&mut self, kind: Kind, lines: &[Vec<Vec3>]) {
        for line in lines {
            for chunk in line.chunks(u16::MAX as usize - 1) {
                if chunk.len() >= 2 {
                    self.lines.push((kind, chunk.to_vec()));
                }
            }
        }
    }

    pub fn nerve(&mut self, name: &str, points: &[Vec3]) {
        self.nerves.push((name.to_owned(), points.to_vec()));
    }

    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        let mut bytes = b"MMF1".to_vec();
        let point = |bytes: &mut Vec<u8>, p: Vec3| {
            for v in p.clamp(Vec3::splat(-1.0), Vec3::splat(1.0)).to_array() {
                bytes.extend(((v * SCALE).round() as i16).to_le_bytes());
            }
        };
        bytes.push(self.name.len() as u8);
        bytes.extend(self.name.as_bytes());
        match self.core {
            Some(p) => {
                bytes.push(1);
                point(&mut bytes, p);
            }
            None => {
                bytes.push(0);
                point(&mut bytes, Vec3::ZERO);
            }
        }
        bytes.extend((self.lines.len() as u32).to_le_bytes());
        let mut counts = [0usize; 4];
        for (kind, line) in &self.lines {
            bytes.push(*kind as u8);
            bytes.extend((line.len() as u16).to_le_bytes());
            for p in line {
                point(&mut bytes, *p);
            }
            counts[*kind as usize] += line.len() - 1;
        }
        bytes.extend((self.nerves.len() as u16).to_le_bytes());
        for (name, points) in &self.nerves {
            bytes.push(name.len() as u8);
            bytes.extend(name.as_bytes());
            bytes.extend((points.len() as u16).to_le_bytes());
            for p in points {
                point(&mut bytes, *p);
            }
        }
        eprintln!(
            "{}: skin {} bone {} extra {} brain {} segments, {} nerves, {} KB",
            self.name,
            counts[0],
            counts[1],
            counts[2],
            counts[3],
            self.nerves.len(),
            bytes.len() / 1024
        );
        fs::write(path, bytes)
    }
}
