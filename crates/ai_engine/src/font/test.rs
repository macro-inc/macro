mod corpus;

use super::*;
use cff::test::{cid_keyed, name_keyed};
use truetype::test::INTER;
use type1::test::font_program;

fn program(kind: ProgramKind, data: Vec<u8>) -> Option<Program> {
    Some(Program {
        kind,
        data: data.into(),
        length1: None,
        length2: None,
    })
}

fn bbox(font: &Font, code: u32) -> [f32; 4] {
    let b = font.outline(code).expect("outline").bounds();
    [b.left(), b.top(), b.right(), b.bottom()]
}

fn assert_box(got: [f32; 4], want: [f32; 4]) {
    let close = got.iter().zip(want).all(|(g, w)| (g - w).abs() < 1e-3);
    assert!(close, "{got:?} != {want:?}");
}

/// Inter's `A`: its control box and advance in em.
const INTER_A: [f32; 4] = [52.0 / 2048.0, 0.0, 1361.0 / 2048.0, 1490.0 / 2048.0];
const INTER_A_ADVANCE: f32 = 1413.0 / 2048.0;

fn inter_simple(encoding: Option<EncodingSpec>, widths: Vec<f32>) -> FontSpec {
    FontSpec {
        subtype: FontSubtype::TrueType,
        base_font: "ABCDEF+Inter".into(),
        first_char: 65,
        widths,
        missing_width: 250.0,
        flags: NONSYMBOLIC,
        encoding,
        program: program(ProgramKind::TrueType, INTER.to_vec()),
        ..FontSpec::default()
    }
}

#[test]
fn font_is_shareable() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<Font>();
}

#[test]
fn simple_truetype_fonts() {
    let encoding = EncodingSpec {
        base: Some("WinAnsiEncoding".into()),
        differences: vec![(66, "Euro".into())],
    };
    let font = Font::load(inter_simple(Some(encoding), vec![700.0, 600.0]));
    assert!(!font.substituted());
    assert_eq!(font.name(), "Inter");
    assert_eq!(font.stand_in_family(), None);
    assert_eq!(
        font.decode(b"A B"),
        [65, 32, 66].map(|code| CharCode { code, len: 1 })
    );
    assert!(font.is_space(CharCode { code: 32, len: 1 }));
    assert!(!font.is_space(CharCode { code: 32, len: 2 }));
    assert_box(bbox(&font, 65), INTER_A);
    // The same path each time.
    assert!(Arc::ptr_eq(
        &font.outline(65).unwrap(),
        &font.outline(65).unwrap()
    ));
    assert_eq!(font.width(65), 700.0);
    assert_eq!(font.width(66), 600.0);
    assert_eq!(font.width(67), 250.0);
    assert_eq!(font.unicode(65).as_deref(), Some("A"));
    assert_eq!(font.unicode(66).as_deref(), Some("€"));
    assert_eq!(font.unicode(0x93).as_deref(), Some("\u{201C}"));
    assert!(font.outline(66).is_some());
    assert!(font.outline(32).is_none());
    assert!(!font.vertical());
    assert_eq!(font.type3_glyph(65), None);
}

#[test]
fn widths_come_from_the_program_when_the_dictionary_has_none() {
    let font = Font::load(inter_simple(None, Vec::new()));
    assert!((font.width(65) - INTER_A_ADVANCE * 1000.0).abs() < 0.01);
    // No encoding: StandardEncoding names.
    assert_eq!(font.unicode(0x27).as_deref(), Some("\u{2019}"));
}

#[test]
fn symbolic_truetype_fonts_read_codes() {
    let mut spec = inter_simple(None, vec![700.0]);
    spec.flags = SYMBOLIC;
    spec.program = program(
        ProgramKind::TrueType,
        truetype::test::inter_with(&[(b"cmap", Some(truetype::test::symbol_cmap()))]),
    );
    let font = Font::load(spec);
    // 0x41 through (3, 0) at 0xF041.
    assert_box(bbox(&font, 0x41), INTER_A);
    assert!(font.outline(0x42).is_none());
    // Text: not the private use character, but the glyph's `post` name,
    // else the code as WinAnsi.
    assert_eq!(font.unicode(0x41).as_deref(), Some("A"));
    assert_eq!(font.unicode(0x27).as_deref(), Some("'"));
}

#[test]
fn composite_truetype_fonts() {
    let cid = CidSpec {
        widths: vec![(2, vec![600.0])],
        ..CidSpec::default()
    };
    let spec = FontSpec {
        subtype: FontSubtype::Type0,
        base_font: "ABCDEF+Inter".into(),
        cmap: Some(CMapSpec::Named("Identity-H".into())),
        cid: Some(cid.clone()),
        program: program(ProgramKind::TrueType, INTER.to_vec()),
        ..FontSpec::default()
    };
    let font = Font::load(spec.clone());
    assert_eq!(
        font.decode(&[0, 2, 0, 3, 7]),
        [
            CharCode { code: 2, len: 2 },
            CharCode { code: 3, len: 2 },
            CharCode { code: 7, len: 1 }
        ]
    );
    assert!(!font.is_space(CharCode { code: 32, len: 2 }));
    assert_box(bbox(&font, 2), INTER_A);
    assert_eq!(font.width(2), 600.0);
    assert_eq!(font.width(3), 1000.0);
    // Text from the program's Unicode `cmap` without `ToUnicode`.
    assert_eq!(font.unicode(2).as_deref(), Some("A"));
    assert!(!font.vertical());

    // `CIDToGIDMap` and vertical writing.
    let mut mapped = spec;
    mapped.cmap = Some(CMapSpec::Named("Identity-V".into()));
    mapped.cid = Some(CidSpec {
        cid_to_gid: CidToGid::Map(vec![0, 2, 0]),
        ..cid
    });
    let font = Font::load(mapped);
    assert!(font.vertical());
    assert_box(bbox(&font, 1), INTER_A);
    assert!(font.outline(2).is_none());
    assert!(font.outline(9).is_none());
}

#[test]
fn type1_fonts_with_differences() {
    let spec = FontSpec {
        subtype: FontSubtype::Type1,
        base_font: "QWERTY+TestFont".into(),
        first_char: 65,
        widths: vec![500.0],
        encoding: Some(EncodingSpec {
            base: None,
            differences: vec![
                (97, "B".into()),
                (98, "Aacute".into()),
                (99, "nosuch".into()),
            ],
        }),
        program: program(ProgramKind::Type1, font_program("0.001 0 0 0.001 0 0")),
        to_unicode: Some(b"1 beginbfchar <61> <0078> endbfchar".to_vec()),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert!(!font.substituted());
    assert_eq!(font.name(), "TestFont");
    // The built-in encoding, then `Differences`.
    assert_box(bbox(&font, 65), [0.1, 0.0, 0.4, 0.4]);
    assert_box(bbox(&font, 97), [0.05, 0.05, 0.25, 0.25]);
    assert_box(bbox(&font, 98), [0.1, 0.0, 0.4, 0.65]);
    assert!(font.outline(99).is_none());
    assert_eq!(font.width(65), 500.0);
    // `ToUnicode` first, then glyph names.
    assert_eq!(font.unicode(97).as_deref(), Some("x"));
    assert_eq!(font.unicode(98).as_deref(), Some("Á"));
    assert_eq!(font.unicode(65).as_deref(), Some("A"));
}

#[test]
fn cff_fonts_by_name_and_by_cid() {
    let spec = FontSpec {
        subtype: FontSubtype::Type1,
        base_font: "Test".into(),
        encoding: Some(EncodingSpec {
            base: Some("WinAnsiEncoding".into()),
            differences: vec![(200, "A.alt".into())],
        }),
        program: program(ProgramKind::Type1C, name_keyed(None)),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert!(!font.substituted());
    assert_box(bbox(&font, 65), [0.1, 0.0, 0.4, 0.4]);
    // No `Widths`: the program's advances.
    assert_eq!(font.width(65), 500.0);
    assert_eq!(font.width(66), 250.0);
    assert!(font.outline(200).is_some());
    assert_eq!(font.unicode(200).as_deref(), Some("A"));
    // Codes the encoding names glyphs the font lacks draw nothing.
    assert!(font.outline(0x80).is_none());

    let cmap = b"1 begincodespacerange <00> <FF> endcodespacerange\n\
                 1 begincidchar <41> 100 endcidchar\n\
                 2 begincidrange <42> <43> 101 <44> <44> 500 endcidrange";
    let spec = FontSpec {
        subtype: FontSubtype::Type0,
        base_font: "Test-Identity".into(),
        cmap: Some(CMapSpec::Embedded(cmap.to_vec())),
        cid: Some(CidSpec {
            cff: true,
            widths: vec![(100, vec![500.0, 250.0])],
            ..CidSpec::default()
        }),
        program: program(ProgramKind::CidType0C, cid_keyed()),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert_eq!(
        font.decode(b"AD"),
        [0x41, 0x44].map(|code| CharCode { code, len: 1 })
    );
    assert_box(bbox(&font, 0x41), [0.0, 0.0, 0.5, 0.5]);
    assert_box(bbox(&font, 0x42), [0.0, 0.0, 0.25, 0.25]);
    assert!(font.outline(0x43).is_none());
    assert_box(bbox(&font, 0x44), [0.0, 0.0, 0.25, 0.25]);
    assert_eq!(font.width(0x41), 500.0);
    assert_eq!(font.width(0x42), 250.0);
    assert_eq!(font.width(0x44), 1000.0);
    assert_eq!(font.unicode(0x41), None);
}

#[test]
fn programs_are_read_as_what_they_are() {
    let type1 = font_program("0.001 0 0 0.001 0 0");
    let headerless = type1[type1.iter().position(|b| *b == b'\n').unwrap() + 1..].to_vec();
    for (kind, data) in [
        (ProgramKind::TrueType, type1.clone()),
        (ProgramKind::Type1, name_keyed(None)),
        (ProgramKind::Type1C, headerless),
        (ProgramKind::Type1, INTER.to_vec()),
    ] {
        let font = Font::load(FontSpec {
            encoding: Some(EncodingSpec {
                base: Some("StandardEncoding".into()),
                differences: Vec::new(),
            }),
            program: program(kind, data),
            ..FontSpec::default()
        });
        assert!(!font.substituted(), "{kind:?}");
        assert!(font.outline(65).is_some(), "{kind:?}");
    }
}

#[test]
fn composite_fonts_with_type1_programs() {
    // As MuPDF writes them: a CIDFontType0 over a Type 1 program, CIDs
    // being its glyph ids.
    let type1 = Type1::parse(&font_program("0.001 0 0 0.001 0 0")).unwrap();
    let gid = type1.gid("B").unwrap();
    let font = Font::load(FontSpec {
        subtype: FontSubtype::Type0,
        cmap: Some(CMapSpec::Named("Identity-H".into())),
        cid: Some(CidSpec {
            cff: true,
            ..CidSpec::default()
        }),
        program: program(ProgramKind::Type1, font_program("0.001 0 0 0.001 0 0")),
        ..FontSpec::default()
    });
    assert_box(bbox(&font, gid), [0.05, 0.05, 0.25, 0.25]);
    assert_eq!(font.unicode(gid).as_deref(), Some("B"));
    assert!(font.outline(1000).is_none());
}

#[test]
fn opentype_programs_with_cff_outlines() {
    // Inter with the CFF font above as its outlines (its `cmap` still
    // finds glyphs the CFF names differently).
    let otf = truetype::test::inter_with(&[(b"CFF ", Some(name_keyed(None))), (b"glyf", None)]);
    let spec = FontSpec {
        subtype: FontSubtype::Type1,
        base_font: "Test".into(),
        program: program(ProgramKind::OpenType, otf),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert!(!font.substituted());
    // A CFF table without a matrix of its own takes `head`'s 2048 units
    // per em, as FreeType reads it.
    let s = 1000.0 / 2048.0;
    assert_box(bbox(&font, 65), [0.1 * s, 0.0, 0.4 * s, 0.4 * s]);
    assert_eq!(font.unicode(65).as_deref(), Some("A"));
}

#[test]
fn stand_ins_for_fonts_not_embedded() {
    let spec = FontSpec {
        base_font: "Helvetica".into(),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert!(font.substituted());
    assert_eq!(font.stand_in_family(), Some("Inter"));
    // Standard widths; glyphs stretched to them.
    assert_eq!(font.width(65), 667.0);
    let b = bbox(&font, 65);
    let stretch = 0.667 / INTER_A_ADVANCE;
    assert_box(
        b,
        [INTER_A[0] * stretch, 0.0, INTER_A[2] * stretch, INTER_A[3]],
    );
    assert_eq!(font.unicode(65).as_deref(), Some("A"));
    assert!(font.outline(32).is_none());

    // A synthesized oblique leans right.
    let oblique = Font::load(FontSpec {
        base_font: "Helvetica-Oblique".into(),
        ..FontSpec::default()
    });
    let (upright, leaning) = (
        bbox(&font, u32::from(b'I')),
        bbox(&oblique, u32::from(b'I')),
    );
    assert!(leaning[2] > upright[2] + 0.05, "{leaning:?} {upright:?}");

    // Symbol fonts draw names they lack by their own encoding.
    let dingbats = Font::load(FontSpec {
        base_font: "ZapfDingbats".into(),
        encoding: Some(EncodingSpec {
            base: Some("WinAnsiEncoding".into()),
            differences: Vec::new(),
        }),
        ..FontSpec::default()
    });
    assert_eq!(
        dingbats.unicode(u32::from(b'4')).as_deref(),
        Some("\u{2714}")
    );
    assert_eq!(dingbats.width(u32::from(b'4')), 846.0);
}

#[test]
fn stand_ins_come_from_registered_families() {
    // A family only this test registers (Inter's file under another name).
    fig_engine::text::register_font(INTER.to_vec(), Some("Zz Test Sans"));
    let regular = Font::load(FontSpec {
        base_font: "ABCDEF+ZzTestSans".into(),
        ..FontSpec::default()
    });
    assert_eq!(regular.stand_in_family(), Some("Zz Test Sans"));
    // No widths: the stand-in's own advances, at the weight asked for.
    assert!((regular.width(65) - INTER_A_ADVANCE * 1000.0).abs() < 0.5);
    let bold = Font::load(FontSpec {
        base_font: "ZzTestSans-Bold".into(),
        ..FontSpec::default()
    });
    assert_eq!(bold.stand_in_family(), Some("Zz Test Sans"));
    assert!(bold.width(65) > regular.width(65) + 10.0);
}

#[test]
fn stand_ins_for_programs_that_do_not_parse() {
    let mut spec = inter_simple(None, vec![650.0]);
    spec.base_font = "ABCDEF+Arial-BoldMT".into();
    spec.program = program(ProgramKind::TrueType, b"true\0\0garbage".to_vec());
    let font = Font::load(spec);
    assert!(font.substituted());
    assert_eq!(font.name(), "Arial-BoldMT");
    assert_eq!(font.width(65), 650.0);
    let b = bbox(&font, 65);
    assert!((b[2] - b[0]) < 0.65 && b[2] > 0.5, "{b:?}");
}

#[test]
fn type3_fonts() {
    let spec = FontSpec {
        subtype: FontSubtype::Type3,
        first_char: 65,
        widths: vec![500.0, 300.0],
        missing_width: 100.0,
        encoding: Some(EncodingSpec {
            base: None,
            differences: vec![(65, "square".into()), (66, "uni2713".into())],
        }),
        font_matrix: Some([0.002, 0.0, 0.0, -0.002, 0.0, 0.0]),
        ..FontSpec::default()
    };
    let font = Font::load(spec);
    assert!(!font.substituted());
    assert_eq!(font.type3_glyph(65), Some("square"));
    assert_eq!(font.type3_glyph(67), None);
    assert!(font.outline(65).is_none());
    assert_eq!(font.width(65), 1000.0);
    assert_eq!(font.width(66), 600.0);
    assert_eq!(font.width(90), 200.0);
    assert_eq!(font.unicode(66).as_deref(), Some("✓"));
    assert_eq!(font.unicode(65), None);
}

#[test]
fn damaged_specs_do_not_panic() {
    let specs = [
        FontSpec {
            subtype: FontSubtype::Type0,
            ..FontSpec::default()
        },
        FontSpec {
            subtype: FontSubtype::Type0,
            cmap: Some(CMapSpec::Embedded(b"begincidrange <00".to_vec())),
            cid: Some(CidSpec {
                default_width: 0.0,
                widths: vec![(u32::MAX, vec![1.0]), (5, Vec::new())],
                cid_to_gid: CidToGid::Map(Vec::new()),
                ..CidSpec::default()
            }),
            program: program(ProgramKind::CidType0C, vec![1, 0, 4, 4, 0, 0]),
            ..FontSpec::default()
        },
        FontSpec {
            first_char: u32::MAX,
            widths: vec![1.0; 4],
            program: program(ProgramKind::Type1, b"%!FontType1 eexec \x80\x80".to_vec()),
            ..FontSpec::default()
        },
        FontSpec {
            subtype: FontSubtype::Type3,
            font_matrix: Some([f64::NAN; 6]),
            ..FontSpec::default()
        },
    ];
    for spec in specs {
        let font = Font::load(spec);
        for code in [0, 1, 32, 65, 255, 0xFFFF, u32::MAX] {
            let _ = (font.width(code), font.outline(code), font.unicode(code));
            let _ = font.type3_glyph(code);
        }
        let _ = font.decode(&[0, 1, 2, 0xFF, 0xFF]);
        let _ = (font.name(), font.vertical(), font.substituted());
    }
}
