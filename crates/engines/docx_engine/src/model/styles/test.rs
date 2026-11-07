use super::*;

const XML: &str = r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="200"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="480"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/>
    <w:rPr><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>"#;

#[test]
fn merges_based_on_chains() {
    let t = XmlTree::parse(XML.as_bytes(), "s").unwrap();
    let s = Styles::parse(&t, &ThemeInfo::default());
    let h2 = s.get("Heading2").unwrap();
    assert_eq!(h2.rpr.size, Some(13.0));
    assert_eq!(h2.rpr.bold, Some(true));
    assert_eq!(h2.ppr.keep_next, Some(true));
    assert_eq!(h2.ppr.before, Some(24.0));
    assert_eq!(s.paragraph_style(None).unwrap().id, "Normal");
    assert_eq!(s.id_by_name("Heading 1"), Some("Heading1"));
}

#[test]
fn toggles_between_style_levels() {
    let t = XmlTree::parse(XML.as_bytes(), "s").unwrap();
    let s = Styles::parse(&t, &ThemeInfo::default());
    let mut r = s.doc_rpr.clone();
    r.apply(&s.get("Heading1").unwrap().rpr, true);
    assert_eq!(r.bold, Some(true));
    // A bold character style in a bold paragraph style reads normal.
    r.apply(&s.get("Strong").unwrap().rpr, true);
    assert_eq!(r.bold, Some(false));
    // Direct formatting is absolute.
    let direct = RPr {
        bold: Some(true),
        ..RPr::default()
    };
    r.apply(&direct, false);
    assert_eq!(r.bold, Some(true));
}

#[test]
fn table_conditions_follow_look() {
    let look = crate::model::props::TableLook::default();
    let at = |row, col| CellPlace {
        row,
        rows: 3,
        col,
        cols: 2,
        header_rows: 1,
        row_band: 1,
        col_band: 1,
    };
    let c = cell_conditions(&look, at(0, 0));
    assert!(c.contains(&"firstRow") && c.contains(&"firstCol") && c.contains(&"nwCell"));
    let c = cell_conditions(&look, at(1, 1));
    assert!(c.contains(&"band1Horz"));
    let c = cell_conditions(&look, at(2, 1));
    assert!(c.contains(&"band2Horz"));
}
