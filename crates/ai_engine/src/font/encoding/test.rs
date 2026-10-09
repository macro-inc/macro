use super::*;

#[test]
fn base_encodings_name_codes() {
    use BaseEncoding::*;
    assert_eq!(Standard.name(b'A'), Some("A"));
    assert_eq!(Standard.name(0x27), Some("quoteright"));
    assert_eq!(Standard.name(0xAE), Some("fi"));
    assert_eq!(Standard.name(0x80), None);
    assert_eq!(WinAnsi.name(0x27), Some("quotesingle"));
    assert_eq!(WinAnsi.name(0x80), Some("Euro"));
    assert_eq!(WinAnsi.name(0x93), Some("quotedblleft"));
    // Unused WinAnsi codes are bullets.
    assert_eq!(WinAnsi.name(0x81), Some("bullet"));
    assert_eq!(MacRoman.name(0x8A), Some("adieresis"));
    assert_eq!(MacExpert.name(0x61), Some("Asmall"));
    assert_eq!(Symbol.name(b'a'), Some("alpha"));
    assert_eq!(ZapfDingbats.name(b'4'), Some("a20"));
    assert_eq!(WinAnsi.code("Euro"), Some(0x80));
    assert_eq!(MacRoman.code("Euro"), None);
}

#[test]
fn encodings_by_pdf_name() {
    assert_eq!(
        BaseEncoding::from_name("WinAnsiEncoding"),
        Some(BaseEncoding::WinAnsi)
    );
    assert_eq!(
        BaseEncoding::from_name("MacExpertEncoding"),
        Some(BaseEncoding::MacExpert)
    );
    assert_eq!(BaseEncoding::from_name("Identity-H"), None);
}

#[test]
fn builds_tables_from_bases_and_differences() {
    let spec = EncodingSpec {
        base: Some("WinAnsiEncoding".into()),
        differences: vec![(65, "Alpha".into()), (66, "Beta".into()), (300, "x".into())],
    };
    let table = Encoding::build(Some(&spec), Encoding::default());
    assert_eq!(table.name(65), Some("Alpha"));
    assert_eq!(table.name(66), Some("Beta"));
    assert_eq!(table.name(67), Some("C"));
    assert_eq!(table.name(300), None);

    // Without a base, differences apply to the font's own encoding.
    let own = Encoding::from_names((0..256).map(|c| (c == 1).then(|| "g1".to_string())));
    let spec = EncodingSpec {
        base: None,
        differences: vec![(2, "g2".into())],
    };
    let table = Encoding::build(Some(&spec), own.clone());
    assert_eq!(table.name(1), Some("g1"));
    assert_eq!(table.name(2), Some("g2"));
    assert_eq!(Encoding::build(None, own.clone()), own);
}

#[test]
fn fills_gaps_and_unknown_names() {
    let mut table = Encoding::default();
    table.apply(&[(65, "Agrave".into())]);
    table.fill(BaseEncoding::Standard);
    assert_eq!(table.name(65), Some("Agrave"));
    assert_eq!(table.name(66), Some("B"));

    let mut table = Encoding::base(BaseEncoding::WinAnsi);
    table.fill_unless(BaseEncoding::ZapfDingbats, |n| n.starts_with('a'));
    assert_eq!(table.name(u32::from(b'4')), Some("a20"));
    assert_eq!(table.name(u32::from(b'a')), Some("a"));
}
