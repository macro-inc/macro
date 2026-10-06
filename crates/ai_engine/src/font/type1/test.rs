//! A Type 1 font built here: clear text, then charstrings encrypted with
//! `lenIV` 4 (or another) inside an eexec-encrypted private dictionary.

use super::*;

/// The `r` of eexec and charstring encryption.
const EEXEC_KEY: u16 = 55665;
const CHARSTRING_KEY: u16 = 4330;

/// Encrypts with four leading bytes, as fonts store both parts.
pub(crate) fn encrypt(plain: &[u8], key: u16) -> Vec<u8> {
    encrypt_after(plain, key, 4)
}

/// Encrypts with `lead` leading bytes.
fn encrypt_after(plain: &[u8], key: u16, lead: usize) -> Vec<u8> {
    let mut r = key;
    [0x2A, 0x9F, 0x13, 0x77, 0x51, 0x08]
        .iter()
        .cycle()
        .take(lead)
        .chain(plain)
        .map(|&p| {
            let c = p ^ (r >> 8) as u8;
            r = (u16::from(c).wrapping_add(r))
                .wrapping_mul(52845)
                .wrapping_add(22719);
            c
        })
        .collect()
}

fn number(out: &mut Vec<u8>, v: i32) {
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
            out.push(255);
            out.extend(v.to_be_bytes());
        }
    }
}

/// A Type 1 charstring from operators and numbers written out.
pub(crate) fn charstring(src: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for token in src.split_whitespace() {
        if let Ok(v) = token.parse::<i32>() {
            number(&mut out, v);
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
            "closepath" => &[9],
            "callsubr" => &[10],
            "return" => &[11],
            "hsbw" => &[13],
            "endchar" => &[14],
            "rmoveto" => &[21],
            "hmoveto" => &[22],
            "vhcurveto" => &[30],
            "hvcurveto" => &[31],
            "dotsection" => &[12, 0],
            "seac" => &[12, 6],
            "sbw" => &[12, 7],
            "div" => &[12, 12],
            "callothersubr" => &[12, 16],
            "pop" => &[12, 17],
            "setcurrentpoint" => &[12, 33],
            _ => panic!("unknown operator {token}"),
        };
        out.extend_from_slice(op);
    }
    out
}

/// The standard flex and hint replacement subroutines, then one of hints.
const SUBRS: [&str; 6] = [
    "3 0 callothersubr pop pop setcurrentpoint return",
    "0 1 callothersubr return",
    "0 2 callothersubr return",
    "return",
    "1 3 callothersubr pop callsubr return",
    "100 50 hstem 20 30 vstem return",
];

/// Glyphs: a square, one through a subroutine, a flex, hint replacement
/// and `div`, every line and curve operator, an accent, and a `seac`.
pub(crate) const GLYPHS: [(&str, &str); 8] = [
    (".notdef", "0 250 hsbw endchar"),
    (
        "A",
        "0 500 hsbw 100 0 rmoveto 300 0 rlineto 0 400 rlineto -300 0 rlineto closepath endchar",
    ),
    (
        "B",
        "0 600 hsbw 50 50 rmoveto 200 0 rlineto 6 callsubr closepath endchar",
    ),
    (
        "C",
        "0 500 hsbw 100 100 rmoveto 1 callsubr 150 0 rmoveto 2 callsubr -100 20 rmoveto \
         2 callsubr 50 0 rmoveto 2 callsubr 50 0 rmoveto 2 callsubr 50 0 rmoveto 2 callsubr \
         50 0 rmoveto 2 callsubr 50 -20 rmoveto 2 callsubr 50 400 100 0 callsubr \
         0 -100 rlineto -300 0 rlineto closepath endchar",
    ),
    (
        "D",
        "0 600 hsbw 5 4 callsubr 50 0 rmoveto 1000 2 div 0 rlineto 0 300 rlineto \
         -500 0 rlineto closepath endchar",
    ),
    (
        "E",
        "0 0 700 0 sbw 100 100 rmoveto 200 hlineto 200 vlineto 0 50 -50 50 -100 0 rrcurveto \
         -50 -50 -50 -50 hvcurveto closepath 60 hmoveto 10 vmoveto 0 10 10 10 vhcurveto \
         closepath endchar",
    ),
    (
        "acute",
        "0 300 hsbw 100 500 rmoveto 100 0 rlineto 0 100 rlineto -100 0 rlineto closepath endchar",
    ),
    ("Aacute", "0 500 hsbw 0 100 50 65 194 seac"),
];

/// Subroutine 6, which B calls.
const SUBR_6: &str = "0 200 rlineto -200 0 rlineto return";

/// The clear-text part, through `eexec`.
fn clear_text(header: &str, matrix: &str) -> Vec<u8> {
    format!(
        "{header}\n11 dict begin\n/FontName /TestFont def\n/FontType 1 def\n/PaintType 0 def\n\
         /FontMatrix [{matrix}] readonly def\n/FontBBox {{0 0 1000 1000}} readonly def\n\
         /Encoding 256 array\n0 1 255 {{1 index exch /.notdef put}} for\n\
         dup 65 /A put\ndup 66 /B put\ndup 67 /C put\ndup 68 /D put\ndup 69 /E put\n\
         dup 201 /Aacute put\nreadonly def\ncurrentdict end\ncurrentfile eexec\n"
    )
    .into_bytes()
}

/// The private part, eexec-encrypted.
fn private_part() -> Vec<u8> {
    private_part_with(4)
}

/// The private part with charstrings encrypted after `len_iv` bytes (not
/// at all for -1).
fn private_part_with(len_iv: i32) -> Vec<u8> {
    let mut p = format!(
        "dup /Private 8 dict dup begin\n/RD{{string currentfile exch readstring pop}}executeonly def\n\
         /ND{{noaccess def}}executeonly def\n/NP{{noaccess put}}executeonly def\n/lenIV {len_iv} def\n\
         /password 5839 def\n/MinFeature{{16 16}}def\n/Subrs 7 array\n"
    )
    .into_bytes();
    let protect = |plain: Vec<u8>| match usize::try_from(len_iv) {
        Ok(lead) => encrypt_after(&plain, CHARSTRING_KEY, lead),
        Err(_) => plain,
    };
    for (i, src) in SUBRS.iter().chain([&SUBR_6]).enumerate() {
        let cs = protect(charstring(src));
        p.extend(format!("dup {i} {} RD ", cs.len()).as_bytes());
        p.extend(&cs);
        p.extend(b" NP\n");
    }
    p.extend(format!("ND\n2 index /CharStrings {} dict dup begin\n", GLYPHS.len()).as_bytes());
    for (name, src) in GLYPHS {
        let cs = protect(charstring(src));
        p.extend(format!("/{name} {} -| ", cs.len()).as_bytes());
        p.extend(&cs);
        p.extend(b" |-\n");
    }
    p.extend(b"end\nend\nreadonly put\nnoaccess put\ndup/FontName get exch definefont pop\nmark currentfile closefile\n");
    encrypt(&p, EEXEC_KEY)
}

fn trailer() -> Vec<u8> {
    let mut t = vec![b'\n'];
    for _ in 0..8 {
        t.extend([b'0'; 64]);
        t.push(b'\n');
    }
    t.extend(b"cleartomark\n");
    t
}

/// The font as PDF files embed it: clear text, binary eexec part, trailer.
pub(crate) fn font_program(matrix: &str) -> Vec<u8> {
    [
        clear_text("%!FontType1-1.0: TestFont 001.000", matrix),
        private_part(),
        trailer(),
    ]
    .concat()
}

fn pfb(segments: &[(u8, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (kind, data) in segments {
        out.extend([0x80, *kind]);
        out.extend((data.len() as u32).to_le_bytes());
        out.extend(*data);
    }
    out.extend([0x80, 3]);
    out
}

fn hex_lines(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, b) in data.iter().enumerate() {
        out.extend(format!("{b:02x}").as_bytes());
        if i % 32 == 31 {
            out.push(b'\n');
        }
    }
    out
}

fn bbox(font: &Type1, name: &str) -> [f32; 4] {
    let path = font.path(font.gid(name).unwrap()).unwrap();
    let b = path.bounds();
    [b.left(), b.top(), b.right(), b.bottom()]
}

fn assert_box(got: [f32; 4], want: [f32; 4]) {
    let close = got.iter().zip(want).all(|(g, w)| (g - w).abs() < 1e-3);
    assert!(close, "{got:?} != {want:?}");
}

fn check_glyphs(font: &Type1, scale: f32) {
    let s = |b: [f32; 4]| b.map(|v| v * scale);
    assert_eq!(font.glyph_count(), GLYPHS.len() as u32);
    assert_box(bbox(font, "A"), s([0.1, 0.0, 0.4, 0.4]));
    assert_box(bbox(font, "B"), s([0.05, 0.05, 0.25, 0.25]));
    // The flex's curves bulge to 120 units.
    assert_box(bbox(font, "C"), s([0.1, 0.0, 0.4, 0.12]));
    assert_box(bbox(font, "D"), s([0.05, 0.0, 0.55, 0.3]));
    assert_box(bbox(font, "E"), s([0.05, 0.1, 0.3, 0.4]));
    // The accent sits 100 units right and 50 up of its own place.
    assert_box(bbox(font, "Aacute"), s([0.1, 0.0, 0.4, 0.65]));
    let advance = |name| font.advance(font.gid(name).unwrap()).unwrap();
    assert!((advance("A") - 0.5 * scale).abs() < 1e-4);
    assert!((advance("E") - 0.7 * scale).abs() < 1e-4);
    assert!(font.path(font.gid(".notdef").unwrap()).is_none());
}

#[test]
fn reads_charstrings_with_flex_seac_and_subroutines() {
    let font = Type1::parse(&font_program("0.001 0 0 0.001 0 0")).unwrap();
    check_glyphs(&font, 1.0);
    assert_eq!(font.encoding_name(65), Some("A"));
    assert_eq!(font.encoding_name(201), Some("Aacute"));
    assert_eq!(font.encoding_gid(66), font.gid("B"));
    assert_eq!(
        font.encoding_name(66),
        font.glyph_name(font.gid("B").unwrap())
    );
    assert!(font.names().any(|(n, _)| n == "acute"));
}

#[test]
fn applies_the_font_matrix() {
    let font = Type1::parse(&font_program("0.0005 0 0 0.0005 0 0")).unwrap();
    check_glyphs(&font, 0.5);
    // An oblique matrix shears x by y.
    let font = Type1::parse(&font_program("0.001 0 0.0002 0.001 0 0")).unwrap();
    assert_box(bbox(&font, "A"), [0.1, 0.0, 0.48, 0.4]);
}

#[test]
fn reads_pfb_hex_and_damaged_headers() {
    let clear = clear_text("%!FontType1-1.0: TestFont 001.000", "0.001 0 0 0.001 0 0");
    let private = private_part();
    let wrapped = pfb(&[(1, &clear), (2, &private), (1, &trailer())]);
    check_glyphs(&Type1::parse(&wrapped).unwrap(), 1.0);

    let hex = [clear.clone(), hex_lines(&private), trailer()].concat();
    check_glyphs(&Type1::parse(&hex).unwrap(), 1.0);

    // Junk before the header, another header line, or none at all.
    let junk = [b"\r\n  ".to_vec(), font_program("0.001 0 0 0.001 0 0")].concat();
    check_glyphs(&Type1::parse(&junk).unwrap(), 1.0);
    let other = [
        clear_text("%!PS-Adobe-3.0 Resource-Font", "0.001 0 0 0.001 0 0"),
        private.clone(),
    ]
    .concat();
    check_glyphs(&Type1::parse(&other).unwrap(), 1.0);
    let bare = [
        clear_text("11 dict pop", "0.001 0 0 0.001 0 0"),
        private.clone(),
    ]
    .concat();
    check_glyphs(&Type1::parse(&bare).unwrap(), 1.0);

    // A PFB whose header is not one read-fonts takes.
    let renamed = clear_text("%!PS-Adobe-3.0 Resource-Font", "0.001 0 0 0.001 0 0");
    let wrapped = pfb(&[(1, &renamed), (2, &private)]);
    check_glyphs(&Type1::parse(&wrapped).unwrap(), 1.0);
}

#[test]
fn reads_other_len_iv() {
    let clear = clear_text("%!FontType1-1.0: TestFont 001.000", "0.001 0 0 0.001 0 0");
    for len_iv in [0, 2, -1] {
        let program = [clear.clone(), private_part_with(len_iv), trailer()].concat();
        check_glyphs(&Type1::parse(&program).unwrap(), 1.0);
    }
}

#[test]
fn rejects_what_is_not_type1() {
    assert!(Type1::parse(b"").is_none());
    assert!(Type1::parse(b"%!FontType1 no eexec here").is_none());
    let program = font_program("0.001 0 0 0.001 0 0");
    for cut in [10, 200, program.len() / 2] {
        let _ = Type1::parse(&program[..cut]);
    }
    // Damaged encrypted bytes must not panic.
    let mut damaged = program.clone();
    let at = damaged.len() / 2;
    for b in &mut damaged[at..at + 64] {
        *b ^= 0x5A;
    }
    if let Some(font) = Type1::parse(&damaged) {
        for gid in 0..font.glyph_count() {
            let _ = (font.path(gid), font.advance(gid));
        }
    }
}
