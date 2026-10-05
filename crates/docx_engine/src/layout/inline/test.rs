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
fn scaled_and_kerned_runs_measure_at_device_sizes() {
    assert!((device_size(10.0) - 9.96).abs() < 1e-4);
    assert!((device_size(12.0) - 12.0).abs() < 1e-4);
    assert!((device_size(8.5) - 8.52).abs() < 1e-4);
    let mut props = crate::model::props::RPr::default().resolve();
    assert!(!device_metrics(&props, 10.0));
    props.scale = 1.03;
    assert!(device_metrics(&props, 10.0));
    props.scale = 1.0;
    props.kern = 14.0;
    assert!(!device_metrics(&props, 10.0));
    assert!(device_metrics(&props, 14.0));
}

#[test]
fn breaks_after_hyphens_and_cjk() {
    assert!(breaks_after('-', Some('a')));
    assert!(!breaks_after('-', Some('1')));
    assert!(breaks_after('中', Some('文')));
    assert!(!breaks_after('a', Some('b')));
    // A joiner keeps a hyphen with what follows.
    assert!(!breaks_after('-', Some('\u{200D}')));
    assert!(!breaks_after('\u{2060}', Some('中')));
}

#[test]
fn east_asian_punctuation_keeps_to_its_text() {
    // Closing punctuation never starts a line, opening never ends one.
    assert!(!breaks_after('中', Some('，')));
    assert!(!breaks_after('中', Some('。')));
    assert!(breaks_after('，', Some('文')));
    assert!(!breaks_after('《', Some('文')));
    assert!(!breaks_after('「', Some('文')));
}
