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
