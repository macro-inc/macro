use super::*;
#[test]
fn regex_and_synthetic_matchers_preserve_utf16_offsets_and_undefined_groups() {
    let regex = RegexMatcher::new("(https://example\\.com)(/x)?", "i").expect("regex");
    let result = regex.exec("😀 HTTPS://example.com").expect("match");
    assert_eq!(result.index, Utf16Offset(3));
    assert_eq!(result.end(), Utf16Offset(22));
    assert_eq!(result.group_count(), 3);
    assert_eq!(result.get(2), None);
    assert_eq!(result.get(1), Some("HTTPS://example.com"));
    let mut synthetic =
        Match::new(Utf16Offset(0), "abc", vec![Some("abc".into())]).expect("synthetic");
    synthetic.set(2, Some("".into()));
    assert_eq!(synthetic.get(1), None);
    assert_eq!(synthetic.get(2), Some(""));
    assert!(RegexMatcher::new("x", "g").is_err());
    assert!(RegexMatcher::new("x", "ii").is_err());
}
#[test]
fn nonunicode_matches_one_surrogate_but_unicode_matches_one_scalar() {
    let legacy = RegexMatcher::new("[^x]", "").expect("regex");
    let unicode = RegexMatcher::new("[^x]", "u").expect("regex");
    assert_eq!(legacy.exec("😀").expect("match").full(), "�");
    assert_eq!(unicode.exec("😀").expect("match").full(), "😀");
}
