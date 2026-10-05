//! Smart objects (`SoLd`, `PlLd`): the placed content's id, name, and
//! corners.
//!
//! `SoLd` (and `SoLE`) is `soLD`, a version (4 or 5), and a descriptor with
//! the instance id (`Idnt`), the placed content's id (`placed`), the
//! affine corners (`Trnf`), and the corners with perspective
//! (`nonAffineTransform`). `PlLd`, the older form Photoshop still writes
//! beside it, is binary: `plcL`, version 3, the instance id, page numbers,
//! the type, the corners, and the warp. The file name and whether the
//! content is linked live in the document's linked-file blocks (`lnk2`,
//! `lnkE`), not here.

use crate::binary::{Reader, Writer};
use crate::codec::descriptor::{self, Descriptor, Value};
use crate::error::{PsdError, Result};
use crate::model::SmartObject;

/// The parts of a `SoLd` block.
struct SoLd {
    /// Everything before the descriptor (`soLD`, version, 16).
    head: Vec<u8>,
    descriptor: Descriptor,
}

fn read_so_ld(data: &[u8]) -> Result<SoLd> {
    let mut r = Reader::new(data);
    if &r.sig()? != b"soLD" {
        return Err(PsdError::corrupt("smart object data without soLD"));
    }
    let version = r.u32()?;
    if !(4..=5).contains(&version) {
        return Err(PsdError::Unsupported(format!(
            "smart object data version {version}"
        )));
    }
    let (descriptor, _) = descriptor::read_versioned(&data[8..])?;
    Ok(SoLd {
        head: data[..12].to_vec(),
        descriptor,
    })
}

/// The parts of a `PlLd` block.
struct PlLd {
    id: String,
    /// Where the eight corner doubles start.
    corners_at: usize,
    corners: [f64; 8],
}

fn read_pl_ld(data: &[u8]) -> Result<PlLd> {
    let mut r = Reader::new(data);
    if &r.sig()? != b"plcL" {
        return Err(PsdError::corrupt("placed layer data without plcL"));
    }
    let version = r.u32()?;
    if version != 3 {
        return Err(PsdError::Unsupported(format!(
            "placed layer data version {version}"
        )));
    }
    let id = crate::binary::mac_roman(r.pascal(1)?);
    r.skip(16)?; // page, total pages, anti-alias policy, type
    let corners_at = r.pos();
    let mut corners = [0.0; 8];
    for c in &mut corners {
        *c = r.f64()?;
    }
    Ok(PlLd {
        id,
        corners_at,
        corners,
    })
}

/// Eight doubles from a list item.
fn corners_item(d: &Descriptor, key: &str) -> Option<[f64; 8]> {
    let list = d.list(key)?;
    let mut out = [0.0; 8];
    if list.len() != 8 {
        return None;
    }
    for (slot, v) in out.iter_mut().zip(list) {
        *slot = v.as_number()?;
    }
    Some(out)
}

fn corners_value(corners: &[f64; 8]) -> Value {
    Value::List(corners.iter().map(|&c| Value::Double(c)).collect())
}

/// Reads a `SoLd` (preferred, or `SoLE`) or `PlLd` block.
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<SmartObject> {
    match key {
        b"PlLd" => {
            let p = read_pl_ld(data)?;
            Ok(SmartObject {
                id: p.id,
                file_name: None,
                corners: p.corners,
                linked: false,
            })
        }
        b"SoLd" | b"SoLE" => {
            let s = read_so_ld(data)?;
            let d = &s.descriptor;
            let id = d
                .text("placed")
                .or_else(|| d.text("Idnt"))
                .unwrap_or_default()
                .to_string();
            let corners = corners_item(d, "nonAffineTransform")
                .or_else(|| corners_item(d, "Trnf"))
                .ok_or_else(|| PsdError::corrupt("smart object without corners"))?;
            Ok(SmartObject {
                id,
                file_name: None,
                corners,
                linked: false,
            })
        }
        _ => Err(PsdError::invalid(format!(
            "{} is not a smart object block",
            String::from_utf8_lossy(key)
        ))),
    }
}

/// The affine map taking three points to three others (top left, top
/// right, bottom left), as `[a, b, c, d, e, f]` for `x' = a x + c y + e`,
/// `y' = b x + d y + f`; `None` when the first three are collinear.
fn affine_between(from: &[f64; 8], to: &[f64; 8]) -> Option<[f64; 6]> {
    let (x0, y0, x1, y1, x3, y3) = (from[0], from[1], from[2], from[3], from[6], from[7]);
    let (u0, v0, u1, v1, u3, v3) = (to[0], to[1], to[2], to[3], to[6], to[7]);
    let (ax, ay, bx, by) = (x1 - x0, y1 - y0, x3 - x0, y3 - y0);
    let det = ax * by - bx * ay;
    if det.abs() < 1e-12 {
        return None;
    }
    let (pu, pv, qu, qv) = (u1 - u0, v1 - v0, u3 - u0, v3 - v0);
    // Solve [a c; b d] [ax bx; ay by] = [pu qu; pv qv].
    let a = (pu * by - qu * ay) / det;
    let c = (qu * ax - pu * bx) / det;
    let b = (pv * by - qv * ay) / det;
    let d = (qv * ax - pv * bx) / det;
    let e = u0 - a * x0 - c * y0;
    let f = v0 - b * x0 - d * y0;
    Some([a, b, c, d, e, f])
}

fn apply(m: &[f64; 6], points: &[f64; 8]) -> [f64; 8] {
    let mut out = [0.0; 8];
    for i in 0..4 {
        let (x, y) = (points[2 * i], points[2 * i + 1]);
        out[2 * i] = m[0] * x + m[2] * y + m[4];
        out[2 * i + 1] = m[1] * x + m[3] * y + m[5];
    }
    out
}

/// Rewrites a `SoLd` or `PlLd` block with new corners (the placement's
/// transform), keeping everything else. In `SoLd`, the corners replace the
/// perspective corners, and the affine corners move by the affine map the
/// edit applied; the original comes back unchanged when it cannot be read.
pub fn encode_corners(key: &[u8; 4], original: &[u8], corners: &[f64; 8]) -> Vec<u8> {
    match key {
        b"PlLd" => {
            let Ok(p) = read_pl_ld(original) else {
                return original.to_vec();
            };
            let mut out = original.to_vec();
            for (i, c) in corners.iter().enumerate() {
                let at = p.corners_at + 8 * i;
                out[at..at + 8].copy_from_slice(&c.to_be_bytes());
            }
            out
        }
        b"SoLd" | b"SoLE" => {
            let Ok(mut s) = read_so_ld(original) else {
                return original.to_vec();
            };
            let d = &mut s.descriptor;
            let affine = corners_item(d, "Trnf");
            match corners_item(d, "nonAffineTransform") {
                Some(old) => {
                    let moved = match (affine, affine_between(&old, corners)) {
                        (Some(trnf), Some(m)) => apply(&m, &trnf),
                        _ => *corners,
                    };
                    if affine != Some(moved) {
                        d.set("Trnf", corners_value(&moved));
                    }
                    if old != *corners {
                        d.set("nonAffineTransform", corners_value(corners));
                    }
                }
                None => {
                    if affine != Some(*corners) {
                        d.set("Trnf", corners_value(corners));
                    }
                }
            }
            let mut w = Writer::new();
            w.bytes(&s.head);
            descriptor::write_to(&mut w, &s.descriptor);
            w.into_bytes()
        }
        _ => original.to_vec(),
    }
}

#[cfg(test)]
mod test;
