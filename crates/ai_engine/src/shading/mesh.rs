//! Mesh shading data (types 4 to 7): vertices and patches packed as bit
//! fields, decoded through the `Decode` array into triangles (free-form
//! and lattice) and tensor-product patches (Coons patches gain the four
//! inner control points their boundary implies).
//!
//! Each vertex of a triangle mesh, and each patch, starts at a byte
//! boundary, as Adobe's readers (and Ghostscript and PDFium) expect.

use crate::error::{AiError, Result};
use crate::function::Function;
use crate::function::read::{Bits, dict_int, dict_numbers, max_value};
use crate::pdf::{Resolve, Stream};

/// Vertices a triangle mesh may have.
const MAX_VERTICES: usize = 1 << 20;
/// Patches a patch mesh may have.
const MAX_PATCHES: usize = 1 << 18;

/// The control points' `(i, j)` (`i` along `u`, `j` along `v`) in the
/// order a patch lists them: the boundary from `p00` around, then (tensor
/// patches) the inner four.
const ORDER: [(usize, usize); 16] = [
    (0, 0),
    (0, 1),
    (0, 2),
    (0, 3),
    (1, 3),
    (2, 3),
    (3, 3),
    (3, 2),
    (3, 1),
    (3, 0),
    (2, 0),
    (1, 0),
    (1, 1),
    (1, 2),
    (2, 2),
    (2, 1),
];

/// A decoded mesh.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Mesh {
    /// 4 to 7.
    pub(super) shading_type: u8,
    /// Triangle vertices (types 4 and 5), in shading space.
    pub(super) points: Vec<[f32; 2]>,
    /// Colors: `ncomp` values each, per vertex or patch corner.
    pub(super) colors: Vec<f32>,
    /// Values per color: the color space's components, or one `t` when
    /// the colors come from `function`.
    pub(super) ncomp: usize,
    /// Triangles, as vertex indexes, in painting order.
    pub(super) triangles: Vec<[u32; 3]>,
    /// Patches (types 6 and 7), in painting order.
    pub(super) patches: Vec<Patch>,
    /// Colors from `t`.
    pub(super) function: Option<Function>,
    /// The interval `t` is decoded to (when there is a function).
    pub(super) t_range: [f32; 2],
}

/// A tensor-product patch.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Patch {
    /// Control points `p[i][j]`.
    pub(super) points: [[[f32; 2]; 4]; 4],
    /// The colors (indexes into [`Mesh::colors`]) at `p00`, `p03`, `p33`,
    /// and `p30`.
    pub(super) corners: [u32; 4],
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("mesh shading: {what}"))
}

/// Reads packed values through the `Decode` ranges.
struct Reader<'a> {
    bits: Bits<'a>,
    coord_bits: u32,
    comp_bits: u32,
    flag_bits: u32,
    /// `[min, max]` for x, y, then each color value.
    decode: Vec<[f32; 2]>,
}

impl Reader<'_> {
    fn sample(&mut self, bits: u32, [lo, hi]: [f32; 2]) -> Option<f32> {
        let raw = self.bits.read(bits)? as f32;
        Some(lo + raw * (hi - lo) / max_value(bits))
    }

    fn point(&mut self) -> Option<[f32; 2]> {
        let x = self.sample(self.coord_bits, self.decode[0])?;
        let y = self.sample(self.coord_bits, self.decode[1])?;
        Some([x, y])
    }

    fn color(&mut self, out: &mut Vec<f32>) -> Option<()> {
        for i in 2..self.decode.len() {
            let v = self.sample(self.comp_bits, self.decode[i])?;
            out.push(v);
        }
        Some(())
    }

    fn flag(&mut self) -> Option<u32> {
        self.bits.read(self.flag_bits).map(|f| f & 3)
    }
}

impl Mesh {
    /// Reads a mesh shading's data; `n` is its color space's components.
    pub(super) fn parse(
        pdf: &dyn Resolve,
        stream: &Stream,
        shading_type: u8,
        n: usize,
        function: Option<Function>,
    ) -> Result<Mesh> {
        let dict = &stream.dict;
        let bits = |key: &str, allowed: &[i64]| {
            dict_int(pdf, dict, key)
                .filter(|b| allowed.contains(b))
                .map(|b| b as u32)
                .ok_or_else(|| corrupt(&format!("bad {key}")))
        };
        let coord_bits = bits("BitsPerCoordinate", &[1, 2, 4, 8, 12, 16, 24, 32])?;
        let comp_bits = bits("BitsPerComponent", &[1, 2, 4, 8, 12, 16])?;
        let flag_bits = if shading_type == 5 {
            0
        } else {
            bits("BitsPerFlag", &[2, 4, 8])?
        };
        let ncomp = if function.is_some() { 1 } else { n };
        let decode = dict_numbers(pdf, dict, "Decode")
            .filter(|d| d.len() >= 4 + 2 * ncomp)
            .ok_or_else(|| corrupt("bad Decode"))?;
        let decode: Vec<[f32; 2]> = decode
            .chunks_exact(2)
            .take(2 + ncomp)
            .map(|p| [p[0], p[1]])
            .collect();
        let t_range = decode[2];
        let data = pdf.stream_data(stream)?;
        let mut reader = Reader {
            bits: Bits::new(&data),
            coord_bits,
            comp_bits,
            flag_bits,
            decode,
        };
        let mut mesh = Mesh {
            shading_type,
            points: Vec::new(),
            colors: Vec::new(),
            ncomp,
            triangles: Vec::new(),
            patches: Vec::new(),
            function,
            t_range,
        };
        match shading_type {
            4 => mesh.free_form(&mut reader),
            5 => {
                let per_row = dict_int(pdf, dict, "VerticesPerRow")
                    .and_then(|v| usize::try_from(v).ok())
                    .filter(|&v| v >= 2)
                    .ok_or_else(|| corrupt("bad VerticesPerRow"))?;
                mesh.lattice(&mut reader, per_row);
            }
            _ => mesh.patches(&mut reader, shading_type == 7),
        }
        Ok(mesh)
    }

    /// Reads one vertex (point and color); its index.
    fn vertex(&mut self, reader: &mut Reader<'_>) -> Option<u32> {
        let p = reader.point()?;
        let len = self.colors.len();
        if reader.color(&mut self.colors).is_none() {
            self.colors.truncate(len);
            return None;
        }
        self.points.push(p);
        Some((self.points.len() - 1) as u32)
    }

    /// Type 4: each vertex's flag starts a triangle (0) or continues from
    /// the last one's two later vertices (1) or its first and last (2).
    fn free_form(&mut self, reader: &mut Reader<'_>) {
        let mut pending: Vec<u32> = Vec::new();
        let mut last: Option<[u32; 3]> = None;
        while self.points.len() < MAX_VERTICES {
            let Some(flag) = reader.flag() else { break };
            let Some(v) = self.vertex(reader) else { break };
            reader.bits.align();
            if !pending.is_empty() {
                // The flags of a new triangle's second and third vertices
                // are ignored.
                pending.push(v);
                if let [a, b, c] = pending[..] {
                    self.triangles.push([a, b, c]);
                    last = Some([a, b, c]);
                    pending.clear();
                }
                continue;
            }
            let triangle = match (flag, last) {
                (1, Some([_, b, c])) => [b, c, v],
                (2, Some([a, _, c])) => [a, c, v],
                _ => {
                    pending.push(v);
                    continue;
                }
            };
            self.triangles.push(triangle);
            last = Some(triangle);
        }
    }

    /// Type 5: rows of `per_row` vertices; each cell between two rows is
    /// two triangles.
    fn lattice(&mut self, reader: &mut Reader<'_>, per_row: usize) {
        while self.points.len() < MAX_VERTICES {
            if self.vertex(reader).is_none() {
                break;
            }
            reader.bits.align();
        }
        let rows = self.points.len() / per_row;
        for r in 0..rows.saturating_sub(1) {
            for c in 0..per_row - 1 {
                let v00 = (r * per_row + c) as u32;
                let (v01, v10) = (v00 + 1, v00 + per_row as u32);
                let v11 = v10 + 1;
                self.triangles.push([v00, v01, v10]);
                self.triangles.push([v01, v11, v10]);
            }
        }
    }

    /// Types 6 and 7: a flag, then the control points and corner colors
    /// that are new; a nonzero flag shares an edge with the last patch.
    fn patches(&mut self, reader: &mut Reader<'_>, tensor: bool) {
        let count = if tensor { 16 } else { 12 };
        // The last patch's points (in listing order) and corner colors.
        let mut last: Option<([[f32; 2]; 16], [u32; 4])> = None;
        while self.patches.len() < MAX_PATCHES {
            let Some(flag) = reader.flag() else { break };
            let mut points = [[0.0f32; 2]; 16];
            let mut corners = [0u32; 4];
            let (first_point, first_color) = match (flag, &last) {
                (0, _) => (0, 0),
                (f, Some((p, c))) => {
                    // The shared edge, and its two colors, in the new
                    // patch's terms.
                    let (edge, colors) = match f {
                        1 => ([p[3], p[4], p[5], p[6]], [c[1], c[2]]),
                        2 => ([p[6], p[7], p[8], p[9]], [c[2], c[3]]),
                        _ => ([p[9], p[10], p[11], p[0]], [c[3], c[0]]),
                    };
                    points[..4].copy_from_slice(&edge);
                    corners[..2].copy_from_slice(&colors);
                    (4, 2)
                }
                // A shared edge with no patch before: unusable data.
                (_, None) => break,
            };
            let mut complete = true;
            for p in &mut points[first_point..count] {
                match reader.point() {
                    Some(v) => *p = v,
                    None => {
                        complete = false;
                        break;
                    }
                }
            }
            for corner in &mut corners[first_color..] {
                if !complete {
                    break;
                }
                let len = self.colors.len();
                if reader.color(&mut self.colors).is_none() {
                    self.colors.truncate(len);
                    complete = false;
                    break;
                }
                *corner = (len / self.ncomp.max(1)) as u32;
            }
            if !complete {
                break;
            }
            reader.bits.align();
            if !tensor {
                coons_interior(&mut points);
            }
            let mut grid = [[[0.0f32; 2]; 4]; 4];
            for (p, &(i, j)) in points.iter().zip(&ORDER) {
                grid[i][j] = *p;
            }
            self.patches.push(Patch {
                points: grid,
                corners,
            });
            last = Some((points, corners));
        }
    }
}

/// A Coons patch's inner control points, from its boundary (listing
/// order), making it the equivalent tensor patch.
fn coons_interior(p: &mut [[f32; 2]; 16]) {
    // Listing order: 0 p00, 1 p01, 2 p02, 3 p03, 4 p13, 5 p23, 6 p33,
    // 7 p32, 8 p31, 9 p30, 10 p20, 11 p10.
    let (p00, p01, p02, p03, p13, p23, p33, p32, p31, p30, p20, p10) =
        (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
    // Each inner point: its corner −4, the corner's two neighbors 6, the
    // two corners beside it −2, the points across from those neighbors 3,
    // and the opposite corner −1, over 9.
    let inner = |corner, near: [usize; 2], beside: [usize; 2], across: [usize; 2], opposite| {
        let terms = [
            (-4.0, corner),
            (6.0, near[0]),
            (6.0, near[1]),
            (-2.0, beside[0]),
            (-2.0, beside[1]),
            (3.0, across[0]),
            (3.0, across[1]),
            (-1.0, opposite),
        ];
        let mut out = [0.0f32; 2];
        for (w, k) in terms {
            let q: [f32; 2] = p[k];
            out[0] += w * q[0];
            out[1] += w * q[1];
        }
        [out[0] / 9.0, out[1] / 9.0]
    };
    let p11 = inner(p00, [p01, p10], [p03, p30], [p31, p13], p33);
    let p12 = inner(p03, [p02, p13], [p00, p33], [p32, p10], p30);
    let p22 = inner(p33, [p32, p23], [p30, p03], [p02, p20], p00);
    let p21 = inner(p30, [p31, p20], [p33, p00], [p01, p23], p03);
    // Listing order 12 to 15: p11, p12, p22, p21.
    p[12] = p11;
    p[13] = p12;
    p[14] = p22;
    p[15] = p21;
}
