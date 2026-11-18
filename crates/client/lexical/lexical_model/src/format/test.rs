use super::*;
#[test]
fn formatting_matches_upstream_bits_and_exclusions() {
    assert_eq!(
        TextFormat::SUBSCRIPT.toggled(TextFormatType::Superscript, None),
        TextFormat::SUPERSCRIPT
    );
    assert_eq!(
        TextFormat::BOLD.toggled(TextFormatType::Bold, Some(TextFormat::BOLD)),
        TextFormat::BOLD
    );
    assert!(ElementFormat::Right.has_format(ElementFormat::Center));
    assert_eq!(text_direction("123 שלום"), Some(TextDirection::Rtl));
    assert_eq!(text_direction("123 abc"), Some(TextDirection::Ltr));
    assert_eq!(text_direction("123"), None);
}

#[test]
fn raw_element_alignment_keeps_number_and_exports_empty_name() {
    let raw = ElementFormat::from_bits(99);
    assert_eq!(raw.bits(), 99);
    assert_eq!(raw.as_str(), "");
    assert_eq!(raw.to_string(), "");
    assert_eq!(
        serde_json::to_value(raw).expect("alignment"),
        serde_json::json!("")
    );
    assert_eq!(ElementFormat::from_bits(2), ElementFormat::Center);
    assert_eq!(
        "center".parse::<ElementFormat>().expect("named alignment"),
        ElementFormat::Center
    );
}
