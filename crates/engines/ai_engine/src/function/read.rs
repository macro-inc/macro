//! Reading helpers the graphics resources share: values that may be
//! indirect, number arrays, and a big-endian bit reader for packed samples.

use crate::pdf::{Dict, Object, Resolve};

/// A dictionary value with references followed (`Null` when missing).
pub(crate) fn get(pdf: &dyn Resolve, dict: &Dict, key: &str) -> Object {
    dict.get(key).map(|o| pdf.resolve(o)).unwrap_or_default()
}

/// A number, following a reference.
pub(crate) fn number(pdf: &dyn Resolve, o: &Object) -> Option<f32> {
    match o {
        Object::Ref(_) => pdf.resolve(o).as_f64().map(|v| v as f32),
        _ => o.as_f64().map(|v| v as f32),
    }
}

/// A dictionary value as a number.
pub(crate) fn dict_number(pdf: &dyn Resolve, dict: &Dict, key: &str) -> Option<f32> {
    dict.get(key).and_then(|o| number(pdf, o))
}

/// A dictionary value as an integer (whole reals included).
pub(crate) fn dict_int(pdf: &dyn Resolve, dict: &Dict, key: &str) -> Option<i64> {
    get(pdf, dict, key).as_i64()
}

/// A dictionary value as a boolean.
pub(crate) fn dict_bool(pdf: &dyn Resolve, dict: &Dict, key: &str) -> Option<bool> {
    get(pdf, dict, key).as_bool()
}

/// An array of numbers (references followed); `None` when anything else
/// is in it or every value is not finite.
pub(crate) fn numbers(pdf: &dyn Resolve, o: &Object) -> Option<Vec<f32>> {
    let o = pdf.resolve(o);
    let values = o
        .as_array()?
        .iter()
        .map(|v| number(pdf, v).filter(|v| v.is_finite()))
        .collect::<Option<Vec<f32>>>()?;
    Some(values)
}

/// A dictionary value as an array of numbers.
pub(crate) fn dict_numbers(pdf: &dyn Resolve, dict: &Dict, key: &str) -> Option<Vec<f32>> {
    dict.get(key).and_then(|o| numbers(pdf, o))
}

/// Number pairs (`[min max min max …]`) as intervals; an odd last value
/// is dropped.
pub(crate) fn pairs(values: &[f32]) -> Vec<[f32; 2]> {
    values.chunks_exact(2).map(|p| [p[0], p[1]]).collect()
}

/// Maps `x` from `[x0, x1]` to `[y0, y1]` (to `y0` when the source
/// interval is empty).
pub(crate) fn lerp_map(x: f32, x0: f32, x1: f32, y0: f32, y1: f32) -> f32 {
    if x1 == x0 {
        y0
    } else {
        y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    }
}

/// Clamps to `[lo, hi]` in either order; `NaN` becomes the low end.
pub(crate) fn clamp(x: f32, a: f32, b: f32) -> f32 {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    if x.is_nan() { lo } else { x.clamp(lo, hi) }
}

/// Reads big-endian bit fields, most significant bit first.
pub(crate) struct Bits<'a> {
    data: &'a [u8],
    /// Position in bits.
    at: usize,
}

impl<'a> Bits<'a> {
    /// A reader at the start of `data`.
    pub(crate) fn new(data: &'a [u8]) -> Bits<'a> {
        Bits { data, at: 0 }
    }

    /// The next `n` bits (`1..=32`) as an unsigned value; `None` past the
    /// end.
    pub(crate) fn read(&mut self, n: u32) -> Option<u32> {
        if n == 0 || n > 32 || self.remaining() < n as usize {
            return None;
        }
        let mut value: u64 = 0;
        let mut left = n as usize;
        while left > 0 {
            let byte = self.data[self.at / 8];
            let offset = self.at % 8;
            let take = (8 - offset).min(left);
            let bits = (byte >> (8 - offset - take)) & ((1u16 << take) - 1) as u8;
            value = (value << take) | u64::from(bits);
            left -= take;
            self.at += take;
        }
        Some(value as u32)
    }

    /// Skips to the next byte boundary.
    pub(crate) fn align(&mut self) {
        self.at = self.at.div_ceil(8) * 8;
    }

    /// Bits left.
    pub(crate) fn remaining(&self) -> usize {
        (self.data.len() * 8).saturating_sub(self.at)
    }
}

/// The largest value `bits` bits hold, as a float (`2^bits - 1`).
pub(crate) fn max_value(bits: u32) -> f32 {
    ((1u64 << bits.min(32)) - 1) as f32
}
