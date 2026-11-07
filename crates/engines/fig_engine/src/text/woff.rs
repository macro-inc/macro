//! WOFF and WOFF2 font containers, unpacked to plain OpenType (`sfnt`)
//! bytes. Web font services (Google Fonts among them) serve WOFF2, whose
//! tables are Brotli-compressed and whose `glyf`, `loca`, and `hmtx` tables
//! may be transformed; both are undone here, following the
//! [WOFF2 specification](https://www.w3.org/TR/WOFF2/).

use std::borrow::Cow;
use std::io::Read;

const WOFF: u32 = u32::from_be_bytes(*b"wOFF");
const WOFF2: u32 = u32::from_be_bytes(*b"wOF2");
const GLYF: u32 = u32::from_be_bytes(*b"glyf");
const LOCA: u32 = u32::from_be_bytes(*b"loca");
const HMTX: u32 = u32::from_be_bytes(*b"hmtx");
const HHEA: u32 = u32::from_be_bytes(*b"hhea");
const HEAD: u32 = u32::from_be_bytes(*b"head");

/// The font as `sfnt` bytes: unpacked when `bytes` is WOFF or WOFF2,
/// borrowed otherwise. `None` for a damaged container.
pub(crate) fn to_sfnt(bytes: &[u8]) -> Option<Cow<'_, [u8]>> {
    match be32(bytes, 0)? {
        WOFF => woff1(bytes).map(Cow::Owned),
        WOFF2 => woff2(bytes).map(Cow::Owned),
        _ => Some(Cow::Borrowed(bytes)),
    }
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// An `sfnt` from its flavor and `(tag, data)` tables (any order).
fn assemble(flavor: u32, mut tables: Vec<(u32, Vec<u8>)>) -> Vec<u8> {
    tables.sort_by_key(|t| t.0);
    let n = tables.len() as u16;
    let mut pow = 1u16;
    while pow * 2 <= n {
        pow *= 2;
    }
    let search_range = pow * 16;
    let mut out = Vec::new();
    out.extend_from_slice(&flavor.to_be_bytes());
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(&search_range.to_be_bytes());
    out.extend_from_slice(&(pow.max(1).ilog2() as u16).to_be_bytes());
    out.extend_from_slice(&(n * 16 - search_range).to_be_bytes());
    let mut offset = 12 + 16 * tables.len();
    for (tag, data) in &tables {
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&checksum(data).to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        offset += data.len().next_multiple_of(4);
    }
    for (_, data) in &tables {
        out.extend_from_slice(data);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    out
}

fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, c| {
        let mut word = [0u8; 4];
        word[..c.len()].copy_from_slice(c);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

fn woff1(b: &[u8]) -> Option<Vec<u8>> {
    let flavor = be32(b, 4)?;
    let count = usize::from(be16(b, 12)?);
    let mut tables = Vec::with_capacity(count);
    for k in 0..count {
        let at = 44 + 20 * k;
        let tag = be32(b, at)?;
        let offset = be32(b, at + 4)? as usize;
        let comp = be32(b, at + 8)? as usize;
        let orig = be32(b, at + 12)? as usize;
        let raw = b.get(offset..offset.checked_add(comp)?)?;
        let data = if comp < orig {
            miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(raw, orig).ok()?
        } else {
            raw.to_vec()
        };
        tables.push((tag, data));
    }
    Some(assemble(flavor, tables))
}

/// Tags WOFF2 names by index.
const KNOWN_TAGS: [&[u8; 4]; 63] = [
    b"cmap", b"head", b"hhea", b"hmtx", b"maxp", b"name", b"OS/2", b"post", b"cvt ", b"fpgm",
    b"glyf", b"loca", b"prep", b"CFF ", b"VORG", b"EBDT", b"EBLC", b"gasp", b"hdmx", b"kern",
    b"LTSH", b"PCLT", b"VDMX", b"vhea", b"vmtx", b"BASE", b"GDEF", b"GPOS", b"GSUB", b"EBSC",
    b"JSTF", b"MATH", b"CBDT", b"CBLC", b"COLR", b"CPAL", b"SVG ", b"sbix", b"acnt", b"avar",
    b"bdat", b"bloc", b"bsln", b"cvar", b"fdsc", b"feat", b"fmtx", b"fvar", b"gvar", b"hsty",
    b"just", b"lcar", b"mort", b"morx", b"opbd", b"prop", b"trak", b"Zapf", b"Silf", b"Glat",
    b"Gloc", b"Feat", b"Sill",
];

/// A cursor over big-endian data.
struct Cursor<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn new(b: &'a [u8]) -> Self {
        Cursor { b, at: 0 }
    }

    fn bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.at..self.at.checked_add(n)?)?;
        self.at += n;
        Some(s)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.bytes(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.bytes(2)?.try_into().ok()?))
    }

    fn i16(&mut self) -> Option<i16> {
        Some(self.u16()? as i16)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.bytes(4)?.try_into().ok()?))
    }

    fn base128(&mut self) -> Option<u32> {
        let mut v = 0u32;
        for k in 0..5 {
            let byte = self.u8()?;
            if k == 0 && byte == 0x80 {
                return None;
            }
            if v & 0xFE00_0000 != 0 {
                return None;
            }
            v = (v << 7) | u32::from(byte & 0x7F);
            if byte & 0x80 == 0 {
                return Some(v);
            }
        }
        None
    }

    /// `255UInt16`.
    fn u16_255(&mut self) -> Option<u16> {
        match self.u8()? {
            253 => self.u16(),
            254 => Some(u16::from(self.u8()?) + 253 * 2),
            255 => Some(u16::from(self.u8()?) + 253),
            c => Some(u16::from(c)),
        }
    }

    /// The rest of the data from here, as its own cursor of `n` bytes.
    fn take(&mut self, n: usize) -> Option<Cursor<'a>> {
        self.bytes(n).map(Cursor::new)
    }
}

struct Entry {
    tag: u32,
    /// Transformed (`glyf`/`loca` version 0, `hmtx` version 1).
    transformed: bool,
    length: usize,
}

fn woff2(b: &[u8]) -> Option<Vec<u8>> {
    let mut c = Cursor::new(b);
    c.bytes(4)?;
    let flavor = c.u32()?;
    c.u32()?; // length
    let count = usize::from(c.u16()?);
    c.u16()?; // reserved
    c.u32()?; // totalSfntSize
    let compressed_len = c.u32()? as usize;
    c.bytes(24)?; // versions, metadata, private data
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let flags = c.u8()?;
        let tag = match flags & 0x3F {
            63 => c.u32()?,
            k => u32::from_be_bytes(*KNOWN_TAGS[usize::from(k)]),
        };
        let version = flags >> 6;
        let orig = c.base128()? as usize;
        let transformed = if tag == GLYF || tag == LOCA {
            version == 0
        } else {
            version != 0
        };
        let length = if transformed {
            c.base128()? as usize
        } else {
            orig
        };
        entries.push(Entry {
            tag,
            transformed,
            length,
        });
    }
    if flavor == u32::from_be_bytes(*b"ttcf") {
        // Collections are not served for the web; not supported.
        return None;
    }
    let total: usize = entries.iter().map(|e| e.length).sum();
    let compressed = c.bytes(compressed_len)?;
    let mut data = Vec::with_capacity(total);
    brotli_decompressor::Decompressor::new(compressed, 4096)
        .take(total as u64 + 1)
        .read_to_end(&mut data)
        .ok()?;
    if data.len() != total {
        return None;
    }
    let mut at = 0;
    let mut raw: Vec<(u32, &[u8], bool)> = Vec::with_capacity(count);
    for e in &entries {
        raw.push((e.tag, &data[at..at + e.length], e.transformed));
        at += e.length;
    }
    let find = |tag: u32| raw.iter().find(|t| t.0 == tag);
    let mut tables: Vec<(u32, Vec<u8>)> = Vec::with_capacity(count);
    let mut x_mins: Option<Vec<i16>> = None;
    if let Some(&(_, glyf, true)) = find(GLYF) {
        let rebuilt = rebuild_glyf(glyf)?;
        x_mins = Some(rebuilt.x_mins);
        tables.push((GLYF, rebuilt.glyf));
        tables.push((LOCA, rebuilt.loca));
    }
    for &(tag, bytes, transformed) in &raw {
        if transformed && (tag == GLYF || tag == LOCA) {
            continue;
        }
        let table = if transformed && tag == HMTX {
            let hhea = find(HHEA)?.1;
            let metrics = usize::from(be16(hhea, 34)?);
            rebuild_hmtx(bytes, metrics, x_mins.as_deref()?)?
        } else if tag == HEAD && x_mins.is_some() {
            // `indexToLocFormat`: the rebuilt `loca` is long.
            let mut head = bytes.to_vec();
            head.get_mut(50..52)?.copy_from_slice(&1u16.to_be_bytes());
            head
        } else {
            bytes.to_vec()
        };
        tables.push((tag, table));
    }
    Some(assemble(flavor, tables))
}

struct Glyf {
    glyf: Vec<u8>,
    loca: Vec<u8>,
    /// Each glyph's `xMin` (for `hmtx` side bearings).
    x_mins: Vec<i16>,
}

/// Composite glyph flags.
const ARG_WORDS: u16 = 0x0001;
const HAS_SCALE: u16 = 0x0008;
const MORE: u16 = 0x0020;
const XY_SCALE: u16 = 0x0040;
const TWO_BY_TWO: u16 = 0x0080;
const INSTRUCTIONS: u16 = 0x0100;

fn rebuild_glyf(t: &[u8]) -> Option<Glyf> {
    let mut c = Cursor::new(t);
    c.u16()?; // reserved
    let options = c.u16()?;
    let num_glyphs = usize::from(c.u16()?);
    // Rebuilt glyphs can be longer than the originals (two-byte deltas),
    // so offsets are always written long.
    c.u16()?; // indexFormat
    let mut sizes = [0usize; 7];
    for s in &mut sizes {
        *s = c.u32()? as usize;
    }
    let mut contours = c.take(sizes[0])?;
    let mut points = c.take(sizes[1])?;
    let mut flags = c.take(sizes[2])?;
    let mut glyphs = c.take(sizes[3])?;
    let mut composites = c.take(sizes[4])?;
    let mut bbox = c.take(sizes[5])?;
    let mut instructions = c.take(sizes[6])?;
    let bitmap_len = num_glyphs.div_ceil(32) * 4;
    let bbox_bitmap = bbox.bytes(bitmap_len)?;
    let overlap = if options & 1 != 0 {
        Some(c.bytes(num_glyphs.div_ceil(8))?)
    } else {
        None
    };
    let bit = |map: &[u8], i: usize| map[i >> 3] & (0x80 >> (i & 7)) != 0;

    let mut glyf = Vec::new();
    let mut offsets = Vec::with_capacity(num_glyphs + 1);
    let mut x_mins = Vec::with_capacity(num_glyphs);
    for i in 0..num_glyphs {
        offsets.push(glyf.len());
        let n_contours = contours.i16()?;
        let explicit_bbox = bit(bbox_bitmap, i);
        let mut x_min = 0;
        match n_contours {
            0 => {
                if explicit_bbox {
                    return None;
                }
            }
            n if n > 0 => {
                let mut ends = Vec::with_capacity(n as usize);
                let mut total = 0usize;
                for _ in 0..n {
                    total += usize::from(points.u16_255()?);
                    ends.push(total.checked_sub(1)? as u16);
                }
                let mut on = Vec::with_capacity(total);
                let mut xs = Vec::with_capacity(total);
                let mut ys = Vec::with_capacity(total);
                let (mut x, mut y) = (0i32, 0i32);
                for _ in 0..total {
                    let f = flags.u8()?;
                    let (dx, dy) = triplet(f & 0x7F, &mut glyphs)?;
                    x += dx;
                    y += dy;
                    on.push(f & 0x80 == 0);
                    xs.push(x);
                    ys.push(y);
                }
                let ins_len = usize::from(glyphs.u16_255()?);
                let ins = instructions.bytes(ins_len)?;
                let b = if explicit_bbox {
                    [bbox.i16()?, bbox.i16()?, bbox.i16()?, bbox.i16()?]
                } else {
                    let min_max = |v: &[i32]| {
                        (
                            v.iter().copied().min().unwrap_or(0) as i16,
                            v.iter().copied().max().unwrap_or(0) as i16,
                        )
                    };
                    let (x0, x1) = min_max(&xs);
                    let (y0, y1) = min_max(&ys);
                    [x0, y0, x1, y1]
                };
                x_min = b[0];
                glyf.extend_from_slice(&n_contours.to_be_bytes());
                for v in b {
                    glyf.extend_from_slice(&v.to_be_bytes());
                }
                for e in ends {
                    glyf.extend_from_slice(&e.to_be_bytes());
                }
                glyf.extend_from_slice(&(ins_len as u16).to_be_bytes());
                glyf.extend_from_slice(ins);
                let overlaps = overlap.is_some_and(|m| bit(m, i));
                for (k, &o) in on.iter().enumerate() {
                    // Plain flags with two-byte deltas; OVERLAP_SIMPLE on the first.
                    let mut f = u8::from(o);
                    if k == 0 && overlaps {
                        f |= 0x40;
                    }
                    glyf.push(f);
                }
                for v in [&xs, &ys] {
                    let mut prev = 0i32;
                    for &p in v.iter() {
                        glyf.extend_from_slice(&((p - prev) as i16).to_be_bytes());
                        prev = p;
                    }
                }
            }
            _ => {
                if !explicit_bbox {
                    return None;
                }
                let b = [bbox.i16()?, bbox.i16()?, bbox.i16()?, bbox.i16()?];
                x_min = b[0];
                glyf.extend_from_slice(&(-1i16).to_be_bytes());
                for v in b {
                    glyf.extend_from_slice(&v.to_be_bytes());
                }
                let start = composites.at;
                let mut has_instructions = false;
                loop {
                    let f = composites.u16()?;
                    composites.u16()?; // glyph index
                    let mut skip = if f & ARG_WORDS != 0 { 4 } else { 2 };
                    if f & HAS_SCALE != 0 {
                        skip += 2;
                    } else if f & XY_SCALE != 0 {
                        skip += 4;
                    } else if f & TWO_BY_TWO != 0 {
                        skip += 8;
                    }
                    composites.bytes(skip)?;
                    has_instructions |= f & INSTRUCTIONS != 0;
                    if f & MORE == 0 {
                        break;
                    }
                }
                glyf.extend_from_slice(&composites.b[start..composites.at]);
                if has_instructions {
                    let ins_len = usize::from(glyphs.u16_255()?);
                    glyf.extend_from_slice(&(ins_len as u16).to_be_bytes());
                    glyf.extend_from_slice(instructions.bytes(ins_len)?);
                }
            }
        }
        x_mins.push(x_min);
        glyf.resize(glyf.len().next_multiple_of(4), 0);
    }
    offsets.push(glyf.len());
    let mut loca = Vec::with_capacity(offsets.len() * 4);
    for o in offsets {
        loca.extend_from_slice(&(o as u32).to_be_bytes());
    }
    Some(Glyf { glyf, loca, x_mins })
}

/// One point's deltas from its flag (high bit cleared) and the glyph stream.
fn triplet(flag: u8, data: &mut Cursor) -> Option<(i32, i32)> {
    let sign = |f: u8, v: i32| if f & 1 != 0 { v } else { -v };
    let f = i32::from(flag);
    Some(if flag < 10 {
        let b0 = i32::from(data.u8()?);
        (0, sign(flag, ((f & 14) << 7) + b0))
    } else if flag < 20 {
        let b0 = i32::from(data.u8()?);
        (sign(flag, (((f - 10) & 14) << 7) + b0), 0)
    } else if flag < 84 {
        let b0 = f - 20;
        let b1 = i32::from(data.u8()?);
        (
            sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)),
            sign(flag >> 1, 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F)),
        )
    } else if flag < 120 {
        let b0 = f - 84;
        let (d0, d1) = (i32::from(data.u8()?), i32::from(data.u8()?));
        (
            sign(flag, 1 + ((b0 / 12) << 8) + d0),
            sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + d1),
        )
    } else if flag < 124 {
        let d = data.bytes(3)?;
        let (d0, b2, d2) = (i32::from(d[0]), i32::from(d[1]), i32::from(d[2]));
        (
            sign(flag, (d0 << 4) + (b2 >> 4)),
            sign(flag >> 1, ((b2 & 0x0F) << 8) + d2),
        )
    } else {
        let d = data.bytes(4)?;
        (
            sign(flag, (i32::from(d[0]) << 8) + i32::from(d[1])),
            sign(flag >> 1, (i32::from(d[2]) << 8) + i32::from(d[3])),
        )
    })
}

fn rebuild_hmtx(t: &[u8], metrics: usize, x_mins: &[i16]) -> Option<Vec<u8>> {
    let mut c = Cursor::new(t);
    let flags = c.u8()?;
    let mut advances = Vec::with_capacity(metrics);
    for _ in 0..metrics {
        advances.push(c.u16()?);
    }
    let mut out = Vec::with_capacity(x_mins.len() * 4);
    for (k, adv) in advances.iter().enumerate() {
        let lsb = if flags & 1 != 0 {
            *x_mins.get(k)?
        } else {
            c.i16()?
        };
        out.extend_from_slice(&adv.to_be_bytes());
        out.extend_from_slice(&lsb.to_be_bytes());
    }
    for x_min in x_mins.iter().skip(metrics) {
        let lsb = if flags & 2 != 0 { *x_min } else { c.i16()? };
        out.extend_from_slice(&lsb.to_be_bytes());
    }
    Some(out)
}

#[cfg(test)]
mod test;
