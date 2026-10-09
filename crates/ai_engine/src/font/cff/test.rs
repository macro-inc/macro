//! CFF fonts built here: a name-keyed font with a custom charset and
//! encoding, local and global subroutines, flex, hint masks, and an
//! `endchar` accent; and a CID-keyed font with two font dicts of their own
//! matrices and subroutines.

use super::*;
use skrifa::raw::ps::string::STANDARD_STRINGS;

/// An INDEX with four-byte offsets.
pub(crate) fn index(items: &[Vec<u8>]) -> Vec<u8> {
    let mut out = (items.len() as u16).to_be_bytes().to_vec();
    if items.is_empty() {
        return out;
    }
    out.push(4);
    let mut offset = 1u32;
    out.extend(offset.to_be_bytes());
    for item in items {
        offset += item.len() as u32;
        out.extend(offset.to_be_bytes());
    }
    for item in items {
        out.extend(item);
    }
    out
}

/// A DICT integer in its five-byte form (so sizes do not depend on it).
fn int(v: i32) -> Vec<u8> {
    [vec![29], v.to_be_bytes().to_vec()].concat()
}

/// A DICT real number.
fn real(s: &str) -> Vec<u8> {
    let mut nibbles: Vec<u8> = s
        .bytes()
        .map(|b| match b {
            b'0'..=b'9' => b - b'0',
            b'.' => 0xA,
            b'-' => 0xE,
            _ => panic!("digit {b}"),
        })
        .collect();
    nibbles.push(0xF);
    if nibbles.len() % 2 == 1 {
        nibbles.push(0xF);
    }
    let mut out = vec![30];
    out.extend(nibbles.chunks(2).map(|p| (p[0] << 4) | p[1]));
    out
}

fn matrix(values: &str) -> Vec<u8> {
    let mut out: Vec<u8> = values.split_whitespace().flat_map(real).collect();
    out.extend([12, 7]);
    out
}

fn t2_number(out: &mut Vec<u8>, v: i32) {
    match v {
        -107..=107 => out.push((v + 139) as u8),
        108..=1131 => {
            let v = v - 108;
            out.extend([(v / 256 + 247) as u8, (v % 256) as u8]);
        }
        -1131..=-108 => {
            let v = -v - 108;
            out.extend([(v / 256 + 251) as u8, (v % 256) as u8]);
        }
        _ => {
            out.push(28);
            out.extend((v as i16).to_be_bytes());
        }
    }
}

/// A Type 2 charstring from operators and numbers written out (`#C0` is a
/// raw byte, for hint masks).
pub(crate) fn t2(src: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for token in src.split_whitespace() {
        if let Some(hex) = token.strip_prefix('#') {
            out.push(u8::from_str_radix(hex, 16).unwrap());
            continue;
        }
        if let Ok(v) = token.parse::<i32>() {
            t2_number(&mut out, v);
            continue;
        }
        let op: &[u8] = match token {
            "hstem" => &[1],
            "vstem" => &[3],
            "vmoveto" => &[4],
            "rlineto" => &[5],
            "hlineto" => &[6],
            "vlineto" => &[7],
            "rrcurveto" => &[8],
            "callsubr" => &[10],
            "return" => &[11],
            "endchar" => &[14],
            "hstemhm" => &[18],
            "hintmask" => &[19],
            "rmoveto" => &[21],
            "hmoveto" => &[22],
            "vstemhm" => &[23],
            "callgsubr" => &[29],
            "vhcurveto" => &[30],
            "hvcurveto" => &[31],
            "flex" => &[12, 35],
            _ => panic!("unknown operator {token}"),
        };
        out.extend_from_slice(op);
    }
    out
}

fn sid(name: &str, custom: &mut Vec<Vec<u8>>) -> u16 {
    if let Some(at) = STANDARD_STRINGS.iter().position(|s| *s == name) {
        return at as u16;
    }
    custom.push(name.as_bytes().to_vec());
    (STANDARD_STRINGS.len() + custom.len() - 1) as u16
}

/// Name-keyed glyphs: name, code in the built-in encoding, charstring.
pub(crate) const GLYPHS: [(&str, u8, &str); 9] = [
    (".notdef", 0, "endchar"),
    (
        "A",
        65,
        "500 100 0 rmoveto 300 0 rlineto 0 400 rlineto -300 0 rlineto endchar",
    ),
    (
        "B",
        66,
        "50 50 rmoveto 200 0 rlineto -107 callsubr -107 callgsubr endchar",
    ),
    (
        "C",
        67,
        "100 100 rmoveto 50 20 50 0 50 0 50 0 50 0 50 -20 50 flex 0 -100 rlineto \
         -300 0 rlineto endchar",
    ),
    (
        "D",
        68,
        "100 50 hstemhm 20 30 hintmask #C0 50 0 rmoveto 500 hlineto 300 vlineto -500 hlineto \
         endchar",
    ),
    (
        "E",
        69,
        "100 100 rmoveto 50 50 50 50 50 50 rrcurveto 30 40 50 60 hvcurveto \
         10 20 30 40 vhcurveto endchar",
    ),
    (
        "acute",
        194,
        "100 500 rmoveto 100 0 rlineto 0 100 rlineto -100 0 rlineto endchar",
    ),
    ("Aacute", 201, "500 100 50 65 194 endchar"),
    (
        "A.alt",
        202,
        "600 0 0 rmoveto 10 0 rlineto 0 10 rlineto endchar",
    ),
];

/// A name-keyed CFF with the font matrix given (none: the default).
pub(crate) fn name_keyed(font_matrix: Option<&str>) -> Vec<u8> {
    let mut strings = Vec::new();
    let sids: Vec<u16> = GLYPHS[1..].iter().map(|g| sid(g.0, &mut strings)).collect();
    let mut charset = vec![0u8];
    for s in &sids {
        charset.extend(s.to_be_bytes());
    }
    let mut encoding = vec![0u8, (GLYPHS.len() - 1) as u8];
    encoding.extend(GLYPHS[1..].iter().map(|g| g.1));
    let charstrings = index(&GLYPHS.map(|g| t2(g.2)));
    let subrs = index(&[t2("0 200 rlineto return")]);
    // Private: nominalWidthX 0, defaultWidthX 250, Subrs right after it.
    let private = [int(0), vec![21], int(250), vec![20], int(18), vec![19]].concat();
    assert_eq!(private.len(), 18);

    let header = [1u8, 0, 4, 4];
    let names = index(&[b"TestCFF".to_vec()]);
    let gsubrs = index(&[t2("-200 0 rlineto return")]);
    let top = |offsets: [i32; 5]| {
        let mut d = Vec::new();
        d.extend(int(offsets[0]));
        d.push(15);
        d.extend(int(offsets[1]));
        d.push(16);
        d.extend(int(offsets[2]));
        d.push(17);
        d.extend(int(offsets[3]));
        d.extend(int(offsets[4]));
        d.push(18);
        if let Some(m) = font_matrix {
            d.extend(matrix(m));
        }
        d
    };
    let top_len = index(&[top([0; 5])]).len();
    let strings = index(&strings);
    let base = header.len() + names.len() + top_len + strings.len() + gsubrs.len();
    let charset_at = base;
    let encoding_at = charset_at + charset.len();
    let charstrings_at = encoding_at + encoding.len();
    let private_at = charstrings_at + charstrings.len();
    let top = index(&[top([
        charset_at as i32,
        encoding_at as i32,
        charstrings_at as i32,
        private.len() as i32,
        private_at as i32,
    ])]);
    [
        header.to_vec(),
        names,
        top,
        strings,
        gsubrs,
        charset,
        encoding,
        charstrings,
        private,
        subrs,
    ]
    .concat()
}

/// A CID-keyed CFF: GIDs 1–3 are CIDs 100, 101, and 500; GID 1 uses font
/// dict 0, GIDs 2 and 3 font dict 1, whose matrix halves glyphs and whose
/// subroutine draws GID 3's side.
pub(crate) fn cid_keyed() -> Vec<u8> {
    let square = "0 0 rmoveto 500 0 rlineto 0 500 rlineto -500 0 rlineto endchar";
    let charstrings = index(&[
        t2("endchar"),
        t2(square),
        t2(square),
        t2("0 0 rmoveto 500 0 rlineto -107 callsubr -500 0 rlineto endchar"),
    ]);
    let mut strings = Vec::new();
    let adobe = sid("Adobe", &mut strings);
    let identity = sid("Identity", &mut strings);
    let strings = index(&strings);
    // Charset format 2: GID 1–2 → CID 100–101, GID 3 → CID 500.
    let mut charset = vec![2u8];
    for (first, left) in [(100u16, 1u16), (500, 0)] {
        charset.extend(first.to_be_bytes());
        charset.extend(left.to_be_bytes());
    }
    // FDSelect format 3: GIDs 0–1 → FD 0, 2–3 → FD 1.
    let mut fd_select = vec![3u8, 0, 2];
    fd_select.extend([0, 0, 0, 0, 2, 1, 0, 4]);
    let subrs = index(&[t2("0 500 rlineto return")]);
    // Private dicts: FD 0 has no subroutines; FD 1's follow its dict.
    let private0 = [int(0), vec![20]].concat();
    let private1 = [int(0), vec![20], int(12), vec![19]].concat();
    assert_eq!(private1.len(), 12);

    let header = [1u8, 0, 4, 4];
    let names = index(&[b"TestCID".to_vec()]);
    let gsubrs = index(&[]);
    let top = |offsets: [i32; 4]| {
        let mut d = Vec::new();
        d.extend(int(i32::from(adobe)));
        d.extend(int(i32::from(identity)));
        d.extend(int(0));
        d.extend([12, 30]);
        d.extend(matrix("1 0 0 1 0 0"));
        d.extend(int(offsets[0]));
        d.push(15);
        d.extend(int(offsets[1]));
        d.push(17);
        d.extend(int(offsets[2]));
        d.extend([12, 36]);
        d.extend(int(offsets[3]));
        d.extend([12, 37]);
        d
    };
    let font_dict = |private_len: usize, private_at: usize, m: &str| {
        [
            matrix(m),
            int(private_len as i32),
            int(private_at as i32),
            vec![18],
        ]
        .concat()
    };
    let top_len = index(&[top([0; 4])]).len();
    let fd_array_len = index(&[
        font_dict(0, 0, "0.001 0 0 0.001 0 0"),
        font_dict(0, 0, "0.0005 0 0 0.0005 0 0"),
    ])
    .len();
    let base = header.len() + names.len() + top_len + strings.len() + gsubrs.len();
    let charset_at = base;
    let charstrings_at = charset_at + charset.len();
    let fd_array_at = charstrings_at + charstrings.len();
    let fd_select_at = fd_array_at + fd_array_len;
    let private0_at = fd_select_at + fd_select.len();
    let private1_at = private0_at + private0.len();
    let fd_array = index(&[
        font_dict(private0.len(), private0_at, "0.001 0 0 0.001 0 0"),
        font_dict(private1.len(), private1_at, "0.0005 0 0 0.0005 0 0"),
    ]);
    let top = index(&[top([
        charset_at as i32,
        charstrings_at as i32,
        fd_array_at as i32,
        fd_select_at as i32,
    ])]);
    [
        header.to_vec(),
        names,
        top,
        strings,
        gsubrs,
        charset,
        charstrings,
        fd_array,
        fd_select,
        private0,
        private1,
        subrs,
    ]
    .concat()
}

fn parse(data: Vec<u8>) -> Cff {
    let len = data.len();
    Cff::parse(data.into(), 0..len, None).unwrap()
}

fn bbox(font: &Cff, gid: u32) -> [f32; 4] {
    let b = font.path(gid).unwrap().bounds();
    [b.left(), b.top(), b.right(), b.bottom()]
}

fn assert_box(got: [f32; 4], want: [f32; 4]) {
    let close = got.iter().zip(want).all(|(g, w)| (g - w).abs() < 1e-3);
    assert!(close, "{got:?} != {want:?}");
}

#[test]
fn reads_name_keyed_fonts() {
    let font = parse(name_keyed(None));
    assert!(!font.is_cid());
    let gid = |name| font.gid(name).unwrap();
    assert_eq!(gid("A"), 1);
    assert_eq!(gid("A.alt"), 8);
    assert_eq!(font.glyph_name(8).as_deref(), Some("A.alt"));
    assert_eq!(font.encoding_gid(65), Some(1));
    assert_eq!(font.encoding_gid(202), Some(8));
    assert_eq!(font.encoding_gid(70), None);
    let names = font.encoding_names();
    assert_eq!(names[194].as_deref(), Some("acute"));
    assert_eq!(names[0], None);

    assert_box(bbox(&font, gid("A")), [0.1, 0.0, 0.4, 0.4]);
    // Local and global subroutines.
    assert_box(bbox(&font, gid("B")), [0.05, 0.05, 0.25, 0.25]);
    assert_box(bbox(&font, gid("C")), [0.1, 0.0, 0.4, 0.12]);
    // Hint masks are skipped over.
    assert_box(bbox(&font, gid("D")), [0.05, 0.0, 0.55, 0.3]);
    assert_box(bbox(&font, gid("E")), [0.1, 0.1, 0.38, 0.4]);
    // `endchar` with four arguments draws `A` and `acute` (StandardEncoding).
    assert_box(bbox(&font, gid("Aacute")), [0.1, 0.0, 0.4, 0.65]);
    assert!(font.path(0).is_none());
    // Widths: given, else defaultWidthX.
    assert_eq!(font.advance(gid("A")), Some(0.5));
    assert_eq!(font.advance(gid("B")), Some(0.25));
    assert_eq!(font.cid_gid(3), Some(3));
}

#[test]
fn applies_the_font_matrix() {
    let font = parse(name_keyed(Some("0.0005 0 0 0.0005 0 0")));
    assert_box(bbox(&font, 1), [0.05, 0.0, 0.2, 0.2]);
    assert_eq!(font.advance(1), Some(0.25));
}

#[test]
fn reads_cid_keyed_fonts_by_cid() {
    let font = parse(cid_keyed());
    assert!(font.is_cid());
    assert_eq!(font.cid_gid(100), Some(1));
    assert_eq!(font.cid_gid(101), Some(2));
    assert_eq!(font.cid_gid(500), Some(3));
    assert_eq!(font.cid_gid(1), None);
    assert_eq!(font.glyph_name(1), None);
    assert_eq!(font.encoding_gid(65), None);
    assert_box(bbox(&font, 1), [0.0, 0.0, 0.5, 0.5]);
    // Font dict 1's matrix halves its glyphs; its subroutines are its own.
    assert_box(bbox(&font, 2), [0.0, 0.0, 0.25, 0.25]);
    assert_box(bbox(&font, 3), [0.0, 0.0, 0.25, 0.25]);
}

#[test]
fn damaged_cff_does_not_panic() {
    let data = name_keyed(None);
    assert!(Cff::parse(Arc::from(&b""[..]), 0..0, None).is_none());
    assert!(Cff::parse(data.clone().into(), 0..data.len() + 10, None).is_none());
    for cut in [4, 20, data.len() / 2, data.len() - 3] {
        let part: Arc<[u8]> = data[..cut].into();
        if let Some(font) = Cff::parse(part, 0..cut, None) {
            for gid in 0..12 {
                let _ = (font.path(gid), font.advance(gid));
            }
        }
    }
    let mut flipped = data.clone();
    for i in (40..flipped.len()).step_by(7) {
        flipped[i] ^= 0xA5;
    }
    let len = flipped.len();
    if let Some(font) = Cff::parse(flipped.into(), 0..len, None) {
        for gid in 0..12 {
            let _ = (font.path(gid), font.advance(gid), font.glyph_name(gid));
        }
        let _ = font.encoding_names();
    }
}
