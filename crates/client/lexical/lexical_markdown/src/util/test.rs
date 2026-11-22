use super::*;
#[test]
fn javascript_whitespace_excludes_nel_and_includes_bom() {
    assert_eq!(js_trim("\u{feff}\u{a0}x\u{2003}"), "x");
    assert_eq!(js_trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
    assert!(is_punctuation(96));
    assert!(!is_punctuation(0x3002));
}
#[test]
fn escape_and_decimal_scans_are_ordered_and_nonoverlapping() {
    assert_eq!(
        unescape_text(r"\\\* \a \! &#42; &#128512; &#55296; &#1114112; &#999999999999999999999;"),
        "\\* \\a ! * 😀 � &#1114112; &#999999999999999999999;"
    );
    assert_eq!(unescape_text(r"\&#42;"), "*");
}
