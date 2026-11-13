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

#[test]
fn a_cut_file_name_keeps_its_extension() {
    let name = format!("{}.pdf", "Überblick ".repeat(60));
    let clamped = clamp_filename_opt(Some(name), 512, "test").unwrap();
    assert_eq!(clamped.chars().count(), 512);
    assert!(clamped.ends_with(".pdf"), "{clamped}");
    assert!(clamped.starts_with("Überblick Überblick"));
}

#[test]
fn a_file_name_that_fits_is_left_alone() {
    assert_eq!(
        clamp_filename_opt(Some("report.final.pdf".into()), 512, "test"),
        Some("report.final.pdf".into())
    );
    assert_eq!(clamp_filename_opt(None, 512, "test"), None);
}

#[test]
fn a_long_name_without_a_real_extension_is_cut_from_the_end() {
    // No dot, and a "extension" with a space, are cut like any other value.
    let no_dot = "a".repeat(20);
    assert_eq!(
        clamp_filename_opt(Some(no_dot), 10, "test").unwrap(),
        "a".repeat(10)
    );
    let spaced = format!("{}.not an extension", "a".repeat(20));
    assert_eq!(
        clamp_filename_opt(Some(spaced), 10, "test").unwrap(),
        "a".repeat(10)
    );
}
