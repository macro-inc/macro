//! Rebuilding TrueType programs that lack tables skrifa reads outlines
//! with: `head`, `maxp`, `hhea`, and `hmtx` are made up when missing (or
//! padded when short), and `head`'s `loca` format follows `loca`'s length.

use skrifa::{FontRef, Tag};

const HEAD: Tag = Tag::new(b"head");
const MAXP: Tag = Tag::new(b"maxp");
const HHEA: Tag = Tag::new(b"hhea");
const HMTX: Tag = Tag::new(b"hmtx");
const LOCA: Tag = Tag::new(b"loca");
const GLYF: Tag = Tag::new(b"glyf");

const HEAD_LEN: usize = 54;
const HHEA_LEN: usize = 36;
/// Where `head` keeps units per em and the `loca` format.
const UPEM_AT: usize = 18;
const LOCA_FORMAT_AT: usize = 50;
/// Where `hhea` keeps the number of long metrics.
const LONG_METRICS_AT: usize = 34;

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*data.get(at)?, *data.get(at + 1)?]))
}

fn i16_at(data: &[u8], at: usize) -> Option<i16> {
    u16_at(data, at).map(|v| v as i16)
}

/// How many long metrics an `hmtx` table holds: `hhea`'s count when the
/// table is long enough for it, else what its length allows.
fn old_long_metrics(hhea: &[u8], hmtx_len: usize, glyphs: u16) -> usize {
    let g = usize::from(glyphs);
    let fits = |n: usize| (1..=g).contains(&n) && n * 4 + (g - n) * 2 <= hmtx_len;
    let stated = usize::from(u16_at(hhea, LONG_METRICS_AT).unwrap_or(0));
    if fits(stated) {
        return stated;
    }
    // n·4 + (g − n)·2 = length.
    let solved = (hmtx_len / 2).saturating_sub(g);
    if fits(solved) {
        return solved;
    }
    (hmtx_len / 4).min(g)
}

/// A glyph's `xMin` from its `glyf` header (`None` for empty glyphs).
fn glyph_x_min(loca: &[u8], glyf: &[u8], long: bool, gid: usize) -> Option<i16> {
    let offset = |i: usize| -> Option<usize> {
        if long {
            let b = loca.get(i * 4..i * 4 + 4)?;
            Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        } else {
            Some(usize::from(u16_at(loca, i * 2)?) * 2)
        }
    };
    let (start, end) = (offset(gid)?, offset(gid + 1)?);
    if end <= start {
        return None;
    }
    i16_at(glyf, start.checked_add(2)?)
}

fn set_u16(data: &mut [u8], at: usize, value: u16) {
    if let Some(slot) = data.get_mut(at..at + 2) {
        slot.copy_from_slice(&value.to_be_bytes());
    }
}

fn default_head() -> Vec<u8> {
    let mut head = vec![0; HEAD_LEN];
    head[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
    set_u16(&mut head, UPEM_AT, 1000);
    head
}

/// Rebuilds a program; `None` when it has no `glyf` and `loca` to draw.
pub(super) fn rebuild(data: &[u8]) -> Option<Vec<u8>> {
    let font = FontRef::from_index(data, 0).ok()?;
    let mut tables: Vec<(Tag, Vec<u8>)> = font
        .table_directory
        .table_records()
        .iter()
        .filter_map(|r| {
            let start = r.offset() as usize;
            let end = start.checked_add(r.length() as usize)?;
            Some((r.tag(), data.get(start..end.min(data.len()))?.to_vec()))
        })
        .collect();
    let find = |tables: &[(Tag, Vec<u8>)], tag: Tag| tables.iter().position(|t| t.0 == tag);
    find(&tables, GLYF)?;
    let loca_len = tables[find(&tables, LOCA)?].1.len();

    let mut head = match find(&tables, HEAD) {
        Some(i) if tables[i].1.len() >= HEAD_LEN => tables[i].1.clone(),
        _ => default_head(),
    };
    let upem = u16_at(&head, UPEM_AT).unwrap_or(0);
    if !(16..=16384).contains(&upem) {
        set_u16(&mut head, UPEM_AT, 1000);
    }
    let upem = u16_at(&head, UPEM_AT).unwrap_or(1000);
    let maxp_glyphs = find(&tables, MAXP).and_then(|i| u16_at(&tables[i].1, 4));
    let mut long = u16_at(&head, LOCA_FORMAT_AT) == Some(1);
    if let Some(n) = maxp_glyphs {
        let entries = usize::from(n) + 1;
        if long && loca_len < entries * 4 && loca_len >= entries * 2 {
            long = false;
        } else if !long && loca_len >= entries * 4 {
            long = loca_len == entries * 4;
        }
    }
    set_u16(&mut head, LOCA_FORMAT_AT, u16::from(long));
    let glyphs = maxp_glyphs.unwrap_or_else(|| {
        let entries = loca_len / if long { 4 } else { 2 };
        u16::try_from(entries.saturating_sub(1)).unwrap_or(u16::MAX)
    });

    let mut maxp = match find(&tables, MAXP) {
        Some(i) if tables[i].1.len() >= 6 => tables[i].1.clone(),
        _ => [0x0000_5000u32.to_be_bytes().as_slice(), &[0, 0]].concat(),
    };
    set_u16(&mut maxp, 4, glyphs);

    let old_hmtx = find(&tables, HMTX).map_or_else(Vec::new, |i| tables[i].1.clone());
    let mut hhea = match find(&tables, HHEA) {
        Some(i) if tables[i].1.len() >= HHEA_LEN => tables[i].1.clone(),
        _ => {
            let mut h = vec![0; HHEA_LEN];
            h[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
            h
        }
    };
    let old_long = old_long_metrics(&hhea, old_hmtx.len(), glyphs);
    let x_min = {
        let loca = &tables[find(&tables, LOCA)?].1;
        let glyf = &tables[find(&tables, GLYF)?].1;
        move |gid: usize| glyph_x_min(loca, glyf, long, gid).unwrap_or(0)
    };
    // Every glyph a long metric: advances kept (the last long one for the
    // rest), side bearings kept or taken from the glyph's box, as skrifa
    // places outlines by them.
    let mut hmtx = Vec::with_capacity(usize::from(glyphs) * 4);
    let mut advance = upem / 2;
    for gid in 0..usize::from(glyphs) {
        let (adv, lsb) = if gid < old_long {
            (u16_at(&old_hmtx, gid * 4), i16_at(&old_hmtx, gid * 4 + 2))
        } else {
            (None, i16_at(&old_hmtx, old_long * 4 + (gid - old_long) * 2))
        };
        advance = adv.unwrap_or(advance);
        hmtx.extend(advance.to_be_bytes());
        hmtx.extend(lsb.unwrap_or_else(|| x_min(gid)).to_be_bytes());
    }
    set_u16(&mut hhea, LONG_METRICS_AT, glyphs.max(1));
    if hmtx.is_empty() {
        hmtx.extend([0; 4]);
    }

    for (tag, table) in [(HEAD, head), (MAXP, maxp), (HHEA, hhea), (HMTX, hmtx)] {
        match find(&tables, tag) {
            Some(i) => tables[i].1 = table,
            None => tables.push((tag, table)),
        }
    }
    tables.sort_by_key(|t| t.0);
    Some(assemble(&tables))
}

/// Writes an `sfnt` from its tables (sorted by tag).
pub(super) fn assemble(tables: &[(Tag, Vec<u8>)]) -> Vec<u8> {
    let count = tables.len() as u16;
    let pow = if count == 0 {
        0
    } else {
        15 - count.leading_zeros() as u16
    };
    let search = (1u16 << pow) * 16;
    let mut out = Vec::new();
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    for v in [count, search, pow, (count * 16).saturating_sub(search)] {
        out.extend_from_slice(&v.to_be_bytes());
    }
    let mut offset = 12 + tables.len() * 16;
    for (tag, table) in tables {
        out.extend_from_slice(&tag.to_be_bytes());
        out.extend_from_slice(&checksum(table).to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(table.len() as u32).to_be_bytes());
        offset += table.len().next_multiple_of(4);
    }
    for (_, table) in tables {
        out.extend_from_slice(table);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    out
}

fn checksum(table: &[u8]) -> u32 {
    table.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}
