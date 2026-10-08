//! TrueType programs from the bundled Inter (SIL OFL): as is, with tables
//! removed or mislabeled, and with symbol and Mac `cmap` tables in place of
//! its Unicode ones.

use super::*;

/// Inter: 2048 units per em; `A` is glyph 2, `Adieresis` 3, `a` 507.
pub(crate) const INTER: &[u8] = include_bytes!("../../../../fig_engine/fonts/InterVariable.ttf");

/// `A`'s control box and advance in em.
const A_BOX: [f32; 4] = [52.0 / 2048.0, 0.0, 1361.0 / 2048.0, 1490.0 / 2048.0];
const A_ADVANCE: f32 = 1413.0 / 2048.0;

fn tables(data: &[u8]) -> Vec<(Tag, Vec<u8>)> {
    let font = FontRef::new(data).unwrap();
    font.table_directory
        .table_records()
        .iter()
        .map(|r| {
            let start = r.offset() as usize;
            (r.tag(), data[start..start + r.length() as usize].to_vec())
        })
        .collect()
}

/// Inter with tables changed: `None` removes one.
pub(crate) fn inter_with(changes: &[(&[u8; 4], Option<Vec<u8>>)]) -> Vec<u8> {
    let mut tables = tables(INTER);
    for (tag, table) in changes {
        let tag = Tag::new(tag);
        tables.retain(|t| t.0 != tag);
        if let Some(table) = table {
            tables.push((tag, table.clone()));
        }
    }
    tables.sort_by_key(|t| t.0);
    repair::assemble(&tables)
}

/// A `cmap` with a (1, 0) table (`A` at 0x41, `Adieresis` at 0x80) and a
/// (3, 0) table (`A` at 0xF041).
pub(crate) fn symbol_cmap() -> Vec<u8> {
    let mut mac = vec![0, 0, 1, 6, 0, 0];
    let mut ids = [0u8; 256];
    ids[0x41] = 2;
    ids[0x80] = 3;
    mac.extend(ids);
    let mut symbol = Vec::new();
    let delta = 2u16.wrapping_sub(0xF041);
    for v in [
        4u16, 32, 0, 4, 4, 1, 0, 0xF041, 0xFFFF, 0, 0xF041, 0xFFFF, delta, 1, 0, 0,
    ] {
        symbol.extend(v.to_be_bytes());
    }
    let mut cmap = vec![0, 0, 0, 2];
    let mac_at = 4 + 2 * 8;
    for (platform, encoding, offset) in [(1u16, 0u16, mac_at), (3, 0, mac_at + mac.len())] {
        cmap.extend(platform.to_be_bytes());
        cmap.extend(encoding.to_be_bytes());
        cmap.extend((offset as u32).to_be_bytes());
    }
    [cmap, mac, symbol].concat()
}

fn parse(data: Vec<u8>) -> TrueType {
    TrueType::parse(data.into()).unwrap()
}

fn bbox(font: &TrueType, gid: u32) -> [f32; 4] {
    let b = font.path(gid).unwrap().bounds();
    [b.left(), b.top(), b.right(), b.bottom()]
}

fn assert_box(got: [f32; 4], want: [f32; 4]) {
    let close = got.iter().zip(want).all(|(g, w)| (g - w).abs() < 1e-4);
    assert!(close, "{got:?} != {want:?}");
}

#[test]
fn reads_outlines_and_advances() {
    let font = parse(INTER.to_vec());
    assert_eq!(font.glyph_count(), 2937);
    assert_box(bbox(&font, 2), A_BOX);
    assert!((font.advance(2).unwrap() - A_ADVANCE).abs() < 1e-5);
    // Glyph 0 of a real font draws its box; past the end, nothing.
    assert!(font.path(5000).is_none());
    assert_eq!(font.glyph_chars().get(&2), Some(&'A'));
}

#[test]
fn finds_glyphs_by_name_and_code() {
    let font = parse(INTER.to_vec());
    // Names through the Unicode table, then `post`.
    assert_eq!(font.simple_gid(0x41, Some("A"), true), Some(2));
    assert_eq!(font.simple_gid(0x80, Some("Euro"), true), Some(1316));
    assert_eq!(font.simple_gid(0x80, Some("uni20AC"), true), Some(1316));
    assert_eq!(font.post_gid("a"), Some(507));
    // Codes through the Unicode table when names fail.
    assert_eq!(font.simple_gid(0x41, None, false), Some(2));
    assert_eq!(font.simple_gid(0x41, Some("nosuchglyph"), true), Some(2));
    assert_eq!(font.unicode_gid('a'), Some(507));
}

#[test]
fn reads_symbol_and_mac_tables() {
    let font = parse(inter_with(&[(b"cmap", Some(symbol_cmap()))]));
    // Symbolic fonts: codes through (3, 0) at 0xF000 + code.
    assert_eq!(font.simple_gid(0x41, None, false), Some(2));
    // Names through Mac Roman codes into (1, 0).
    assert_eq!(font.simple_gid(0x99, Some("Adieresis"), true), Some(3));
    // And `post` names.
    assert_eq!(font.simple_gid(0x61, Some("a"), true), Some(507));
    assert_eq!(font.simple_gid(0x42, None, false), None);
}

#[test]
fn numbers_glyphs_by_code_without_cmap() {
    let font = parse(inter_with(&[(b"cmap", None), (b"post", None)]));
    assert_eq!(font.simple_gid(2, Some("A"), true), Some(2));
    assert_eq!(font.simple_gid(7, None, false), Some(7));
}

#[test]
fn repairs_missing_and_mislabeled_tables() {
    let stripped = inter_with(&[(b"hhea", None), (b"hmtx", None), (b"maxp", None)]);
    assert!(
        FontRef::new(&stripped)
            .is_ok_and(|f| f.outline_glyphs().format() != Some(OutlineGlyphFormat::Glyf))
    );
    let font = parse(stripped);
    assert_box(bbox(&font, 2), A_BOX);
    assert!(font.glyph_count() >= 2937);

    // `head` claiming short `loca` offsets for a long table.
    let mut head = tables(INTER)
        .into_iter()
        .find(|t| t.0 == Tag::new(b"head"))
        .unwrap()
        .1;
    head[50..52].copy_from_slice(&0u16.to_be_bytes());
    let font = parse(inter_with(&[(b"head", Some(head))]));
    assert_box(bbox(&font, 2), A_BOX);

    // No `head` at all.
    let font = parse(inter_with(&[(b"head", None)]));
    assert_box(bbox(&font, 2), A_BOX.map(|v| v * 2048.0 / 1000.0));
}

#[test]
fn finds_cff_tables_in_opentype() {
    assert_eq!(TrueType::cff_table(INTER), None);
    let otf = inter_with(&[(b"CFF ", Some(vec![1, 0, 4, 4]))]);
    let (range, upem) = TrueType::cff_table(&otf).unwrap();
    assert_eq!(&otf[range], &[1, 0, 4, 4]);
    assert_eq!(upem, Some(2048));
}

#[test]
fn rejects_what_is_not_truetype() {
    assert!(TrueType::parse(Arc::from(&b""[..])).is_none());
    assert!(TrueType::parse(Arc::from(&b"true\0\0\0\0"[..])).is_none());
    let no_glyf = inter_with(&[(b"glyf", None)]);
    assert!(TrueType::parse(no_glyf.into()).is_none());
    let cut: Arc<[u8]> = INTER[..INTER.len() / 3].into();
    if let Some(font) = TrueType::parse(cut) {
        for gid in [0, 2, 100, 2000] {
            let _ = (font.path(gid), font.advance(gid));
        }
    }
}
