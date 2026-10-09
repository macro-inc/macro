//! Turning outline commands into paths, through an affine map.

use skrifa::outline::OutlinePen;
use tiny_skia::{Path, PathBuilder};

/// Path commands a glyph may emit before the rest are dropped.
const MAX_COMMANDS: usize = 200_000;

/// Builds a [`Path`] from outline commands mapped by `[a b c d e f]`
/// (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`).
pub(super) struct Pen {
    pb: PathBuilder,
    m: [f32; 6],
    commands: usize,
}

impl Pen {
    /// A pen mapping through `m`.
    pub(super) fn new(m: [f32; 6]) -> Pen {
        Pen {
            pb: PathBuilder::new(),
            m,
            commands: 0,
        }
    }

    /// A pen scaling both axes by `s`.
    pub(super) fn scale(s: f32) -> Pen {
        Pen::new([s, 0.0, 0.0, s, 0.0, 0.0])
    }

    /// Maps later commands through `m` (to draw several glyphs into one
    /// path).
    pub(super) fn set_map(&mut self, m: [f32; 6]) {
        self.m = m;
    }

    fn map(&self, x: f32, y: f32) -> (f32, f32) {
        let [a, b, c, d, e, f] = self.m;
        (a * x + c * y + e, b * x + d * y + f)
    }

    fn take(&mut self, points: &[f32]) -> bool {
        self.commands += 1;
        self.commands <= MAX_COMMANDS && points.iter().all(|v| v.is_finite())
    }

    /// The path drawn; `None` when nothing was.
    pub(super) fn finish(self) -> Option<Path> {
        self.pb.finish()
    }
}

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        if self.take(&[x, y]) {
            let (x, y) = self.map(x, y);
            self.pb.move_to(x, y);
        }
    }

    fn line_to(&mut self, x: f32, y: f32) {
        if self.take(&[x, y]) {
            let (x, y) = self.map(x, y);
            self.pb.line_to(x, y);
        }
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        if self.take(&[x1, y1, x, y]) {
            let (x1, y1) = self.map(x1, y1);
            let (x, y) = self.map(x, y);
            self.pb.quad_to(x1, y1, x, y);
        }
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        if self.take(&[x1, y1, x2, y2, x, y]) {
            let (x1, y1) = self.map(x1, y1);
            let (x2, y2) = self.map(x2, y2);
            let (x, y) = self.map(x, y);
            self.pb.cubic_to(x1, y1, x2, y2, x, y);
        }
    }

    fn close(&mut self) {
        if self.take(&[]) {
            self.pb.close();
        }
    }
}
