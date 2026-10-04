use super::*;

#[test]
fn reads_field_kinds_and_formats() {
    assert_eq!(field_kind(" PAGE \\* MERGEFORMAT "), Some(Dynamic::Page));
    assert_eq!(field_kind("NUMPAGES"), Some(Dynamic::Pages));
    assert_eq!(field_kind("REF _Ref1 \\h"), None);
    assert_eq!(
        field_format("PAGE \\* roman", &NumFmt::Decimal),
        NumFmt::LowerRoman
    );
    assert_eq!(
        field_format("PAGE", &NumFmt::UpperRoman),
        NumFmt::UpperRoman
    );
}

#[test]
fn reads_attributes_from_tags() {
    assert_eq!(
        attr_value(r#"<w:fldChar w:fldCharType="begin"/>"#, "fldCharType").as_deref(),
        Some("begin")
    );
    assert_eq!(
        attr_value(r#"<w:footnoteReference w:id="12"/>"#, "id").as_deref(),
        Some("12")
    );
    assert_eq!(attr_value(r#"<w:br w:type="page"/>"#, "clear"), None);
}

#[test]
fn breaks_after_hyphens_and_cjk() {
    assert!(breaks_after('-', Some('a')));
    assert!(!breaks_after('-', Some('1')));
    assert!(breaks_after('中', Some('文')));
    assert!(!breaks_after('a', Some('b')));
}
