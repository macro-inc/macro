//! Vector masks (`vmsk`, or `vsms` in newer files): path records with
//! points in fixed 8.24 fractions of the canvas, read into canvas pixels.
//!
//! A mask is a version (3), flags (invert, not linked, disabled), and
//! 26-byte records: a path fill rule record, the initial fill rule, then
//! each subpath's length record (closed or open, its operation, fill rule,
//! and live shape index) followed by its knots, each point stored as
//! (vertical, horizontal) fractions of the canvas. Masks Photoshop wrote
//! re-encode byte for byte.

use crate::binary::{Reader, Writer};
use crate::error::{PsdError, Result};
use crate::model::{Knot, PathOp, Subpath, VectorMask};

/// The only version Photoshop writes.
const VERSION: u32 = 3;
/// Fixed 8.24 numbers have 24 fraction bits.
const FIXED_ONE: f64 = 16_777_216.0;
/// Every record is a selector and 24 bytes.
const RECORD_BODY: usize = 24;

const CLOSED_LENGTH: u16 = 0;
const CLOSED_LINKED: u16 = 1;
const CLOSED_UNLINKED: u16 = 2;
const OPEN_LENGTH: u16 = 3;
const OPEN_LINKED: u16 = 4;
const OPEN_UNLINKED: u16 = 5;
const PATH_FILL_RULE: u16 = 6;
const CLIPBOARD: u16 = 7;
const INITIAL_FILL_RULE: u16 = 8;

const EVEN_ODD: u16 = 1;
const NONZERO: u16 = 2;

/// Reads a vector mask on a `width × height` canvas.
pub fn decode(data: &[u8], width: u32, height: u32) -> Result<VectorMask> {
    let mut r = Reader::new(data);
    let version = r.u32()?;
    if version != VERSION {
        return Err(PsdError::Unsupported(format!(
            "vector mask version {version}"
        )));
    }
    let flags = r.u32()?;
    let mut mask = VectorMask {
        subpaths: Vec::new(),
        invert: flags & 1 != 0,
        unlinked: flags & 2 != 0,
        disabled: flags & 4 != 0,
        fill_all: false,
    };
    let (w, h) = (f64::from(width), f64::from(height));
    // Trailing bytes shorter than a record are alignment padding.
    while r.remaining() >= 2 + RECORD_BODY {
        let selector = r.u16()?;
        let mut body = r.take(RECORD_BODY)?;
        match selector {
            CLOSED_LENGTH | OPEN_LENGTH => {
                body.u16()?; // the knot count, which the knots that follow give
                let op = match body.i16()? {
                    0 => PathOp::Exclude,
                    2 => PathOp::Subtract,
                    3 => PathOp::Intersect,
                    _ => PathOp::Combine,
                };
                let nonzero = body.u16()? == NONZERO;
                body.u32()?;
                let shape = body.u32()?;
                mask.subpaths.push(Subpath {
                    closed: selector == CLOSED_LENGTH,
                    op,
                    knots: Vec::new(),
                    nonzero,
                    shape,
                });
            }
            CLOSED_LINKED | CLOSED_UNLINKED | OPEN_LINKED | OPEN_UNLINKED => {
                let mut point = || -> Result<(f64, f64)> {
                    let y = f64::from(body.i32()?) / FIXED_ONE * h;
                    let x = f64::from(body.i32()?) / FIXED_ONE * w;
                    Ok((x, y))
                };
                let knot = Knot {
                    before: point()?,
                    anchor: point()?,
                    after: point()?,
                    linked: selector == CLOSED_LINKED || selector == OPEN_LINKED,
                };
                if mask.subpaths.is_empty() {
                    mask.subpaths.push(Subpath {
                        closed: selector <= CLOSED_UNLINKED,
                        op: PathOp::Combine,
                        knots: Vec::new(),
                        nonzero: false,
                        shape: 0,
                    });
                }
                if let Some(subpath) = mask.subpaths.last_mut() {
                    subpath.knots.push(knot);
                }
            }
            PATH_FILL_RULE | CLIPBOARD => {}
            INITIAL_FILL_RULE => mask.fill_all = body.u16()? == 1,
            _ => {
                return Err(PsdError::corrupt(format!(
                    "unknown vector mask record {selector}"
                )));
            }
        }
    }
    Ok(mask)
}

/// Writes a vector mask on a `width × height` canvas.
pub fn encode(mask: &VectorMask, width: u32, height: u32) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(VERSION);
    w.u32(u32::from(mask.invert) | u32::from(mask.unlinked) << 1 | u32::from(mask.disabled) << 2);
    w.u16(PATH_FILL_RULE);
    w.zeros(RECORD_BODY);
    w.u16(INITIAL_FILL_RULE);
    w.u16(u16::from(mask.fill_all));
    w.zeros(RECORD_BODY - 2);
    let fixed = |v: f64, size: u32| -> i32 {
        if size == 0 {
            return 0;
        }
        (v / f64::from(size) * FIXED_ONE)
            .round()
            .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
    };
    for subpath in &mask.subpaths {
        w.u16(if subpath.closed {
            CLOSED_LENGTH
        } else {
            OPEN_LENGTH
        });
        w.u16(subpath.knots.len().min(usize::from(u16::MAX)) as u16);
        w.i16(match subpath.op {
            PathOp::Exclude => 0,
            PathOp::Combine => 1,
            PathOp::Subtract => 2,
            PathOp::Intersect => 3,
        });
        w.u16(if subpath.nonzero { NONZERO } else { EVEN_ODD });
        w.u32(0);
        w.u32(subpath.shape);
        w.zeros(10);
        let (linked, unlinked) = if subpath.closed {
            (CLOSED_LINKED, CLOSED_UNLINKED)
        } else {
            (OPEN_LINKED, OPEN_UNLINKED)
        };
        for knot in subpath.knots.iter().take(usize::from(u16::MAX)) {
            w.u16(if knot.linked { linked } else { unlinked });
            for (x, y) in [knot.before, knot.anchor, knot.after] {
                w.i32(fixed(y, height));
                w.i32(fixed(x, width));
            }
        }
    }
    w.into_bytes()
}

#[cfg(test)]
mod test;
