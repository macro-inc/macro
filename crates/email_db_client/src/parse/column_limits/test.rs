use super::*;

#[test]
fn clamp_leaves_values_that_already_fit() {
    assert_eq!(clamp("abc".to_string(), 5), "abc");
    assert_eq!(clamp("abcde".to_string(), 5), "abcde");
}

#[test]
fn clamp_cuts_to_the_character_limit() {
    assert_eq!(clamp("abcdef".to_string(), 5), "abcde");
    assert_eq!(clamp(String::new(), 0), "");
}

#[test]
fn clamp_counts_characters_not_bytes() {
    // Postgres varchar(n) counts characters, so a 5-char multi-byte string
    // fits a varchar(5) and must survive untouched.
    let five_chars = "ñññññ".to_string();
    assert_eq!(five_chars.len(), 10);
    assert_eq!(clamp(five_chars.clone(), 5), five_chars);
    assert_eq!(clamp(five_chars, 3), "ñññ");
}

#[test]
fn clamp_never_splits_a_multi_byte_character() {
    let emoji = "👩‍🚀🚀🚀".to_string();
    let clamped = clamp(emoji, 2);
    assert!(clamped.is_char_boundary(clamped.len()));
    assert_eq!(clamped.chars().count(), 2);
}

#[test]
fn fits_compares_characters() {
    assert!(fits("ñññññ", 5));
    assert!(!fits("ñññññ", 4));
}

#[test]
fn clamp_opt_passes_through_none() {
    assert_eq!(clamp_opt(None, 5, "col"), None);
}

#[test]
fn clamp_opt_truncates_some() {
    assert_eq!(
        clamp_opt(Some("abcdef".to_string()), 5, "col"),
        Some("abcde".to_string())
    );
}
