//! Library keys and versions. A key names an asset across files (40 hex
//! digits, as Figma's); a version is a hash of what the asset looks like
//! and holds, so a publish can tell what changed since the last one.
//!
//! The hash covers the modeled properties of the asset's layers (not the
//! geometry, glyph layout, or instance layout Figma derives from them),
//! with numbers at the precision files store them, and the versions of the
//! components, styles, and variables it uses: a component changes when a
//! component nested in it does.

use super::dependencies;
use crate::document::{Document, NodeIdx};
use crate::model::{Guid, Props};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

/// SHA-1 of `data`.
pub(crate) fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let t = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 20];
    for (i, x) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// A new asset's key: 40 hex digits from the library's `seed` (its
/// document id) and the asset's id there.
pub fn key_for(seed: &str, guid: Guid) -> String {
    hex(&sha1(format!("macro-library:{seed}:{guid}").as_bytes()))
}

/// The digits of a version.
const VERSION_DIGITS: usize = 16;

/// `text` with every decimal number written at `f32` precision (what a
/// saved file keeps), so a version survives saving and reopening.
fn at_file_precision(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let boundary = i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
        if boundary
            && (c.is_ascii_digit()
                || (c == b'-' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)))
        {
            let start = i;
            i += 1;
            while i < bytes.len()
                && (bytes[i].is_ascii_digit()
                    || bytes[i] == b'.'
                    || bytes[i] == b'e'
                    || ((bytes[i] == b'-' || bytes[i] == b'+') && bytes[i - 1] == b'e'))
            {
                i += 1;
            }
            let token = &text[start..i];
            match token.parse::<f64>() {
                Ok(v) if token.contains(['.', 'e']) => {
                    let _ = write!(out, "{}", v as f32);
                }
                _ => out.push_str(token),
            }
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    out
}

/// What saving does not keep as it is, or the engine derives again.
fn strip(p: &mut Props) {
    p.parent = None;
    p.position = None;
    p.fill_geometry = None;
    p.stroke_geometry = None;
    p.text_layout = None;
    p.derived = None;
    p.generated = None;
    p.recomputed = false;
    p.library = None;
    p.key = None;
    p.macro_data = None;
    p.sort_position = None;
    if let Some(symbol) = &p.symbol {
        let mut s = (**symbol).clone();
        s.overrides = s
            .overrides
            .iter()
            .map(|o| {
                let mut o = o.clone();
                strip(&mut o);
                o
            })
            .collect();
        p.symbol = Some(std::sync::Arc::new(s));
    }
}

/// One layer's part of a version.
fn canonical(doc: &Document, i: NodeIdx) -> String {
    let mut p = doc.props(i).clone();
    strip(&mut p);
    // A vector network by its content, not its place in the blob list.
    crate::edit::remap_props(&mut p, &mut |b| {
        let bytes = doc.blobs.bytes(b).unwrap_or_default();
        let d = sha1(bytes);
        u32::from_be_bytes([d[0], d[1], d[2], d[3]])
    });
    at_file_precision(&format!("{p:?}"))
}

/// Versions of assets, each computed once.
#[derive(Default)]
pub(crate) struct Versions {
    done: HashMap<NodeIdx, String>,
    visiting: HashSet<NodeIdx>,
}

impl Versions {
    /// The version of the asset at `i` (with what it holds).
    pub(crate) fn of(&mut self, doc: &Document, i: NodeIdx) -> String {
        if let Some(v) = self.done.get(&i) {
            return v.clone();
        }
        if !self.visiting.insert(i) {
            return "cycle".into();
        }
        let mut text = String::new();
        let mut deps: Vec<Guid> = Vec::new();
        let mut inside: HashSet<NodeIdx> = HashSet::new();
        let mut stack = vec![(i, 0usize)];
        while let Some((n, depth)) = stack.pop() {
            inside.insert(n);
            let _ = writeln!(text, "{depth} {}", canonical(doc, n));
            dependencies(doc.props(n), &mut deps);
            for &c in doc.node(n).children.iter().rev() {
                if !doc.node(c).removed {
                    stack.push((c, depth + 1));
                }
            }
        }
        for g in deps {
            let Some(d) = doc.find(crate::edit::guid_of(doc, g)) else {
                continue;
            };
            if inside.contains(&d) || doc.node(d).removed {
                continue;
            }
            let v = self.of(doc, d);
            let _ = writeln!(text, "uses {v}");
        }
        self.visiting.remove(&i);
        let v = hex(&sha1(text.as_bytes()))[..VERSION_DIGITS].to_owned();
        self.done.insert(i, v.clone());
        v
    }
}

#[cfg(test)]
mod test;
