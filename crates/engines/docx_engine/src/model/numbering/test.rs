use super::*;

#[test]
fn formats_numbers() {
    assert_eq!(format_number(4, &NumFmt::UpperRoman), "IV");
    assert_eq!(format_number(1994, &NumFmt::LowerRoman), "mcmxciv");
    assert_eq!(format_number(1, &NumFmt::LowerLetter), "a");
    assert_eq!(format_number(27, &NumFmt::UpperLetter), "AA");
    assert_eq!(format_number(28, &NumFmt::UpperLetter), "BB");
    assert_eq!(format_number(2, &NumFmt::Ordinal), "2nd");
    assert_eq!(format_number(13, &NumFmt::Ordinal), "13th");
    assert_eq!(format_number(21, &NumFmt::CardinalText), "Twenty-one");
    assert_eq!(format_number(3, &NumFmt::OrdinalText), "Third");
    assert_eq!(format_number(5, &NumFmt::DecimalZero), "05");
    assert_eq!(format_number(4, &NumFmt::Chicago), "\u{00A7}");
    assert_eq!(format_number(5, &NumFmt::Chicago), "**");
    assert_eq!(format_number(6, &NumFmt::Chicago), "\u{2020}\u{2020}");
}

#[test]
fn counts_levels_and_restarts() {
    let xml = r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1.%2.%3"/><w:isLgl/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    </w:numbering>"#;
    let t = XmlTree::parse(xml.as_bytes(), "n").unwrap();
    let n = Numbering::parse(&t, &ThemeInfo::default());
    let styles = Styles::default();
    let mut c = Counters::default();
    let mut label = |id: i64, l: u8| c.next(&n, &styles, id, l).unwrap().text;
    assert_eq!(label(1, 0), "1.");
    assert_eq!(label(1, 1), "(a)");
    assert_eq!(label(1, 1), "(b)");
    assert_eq!(label(1, 2), "1.2.1");
    assert_eq!(label(1, 0), "2.");
    assert_eq!(label(1, 1), "(a)");
    // A restarted instance counts on its own.
    assert_eq!(label(2, 0), "5.");
    assert_eq!(label(2, 0), "6.");
    assert_eq!(label(1, 0), "3.");
}
