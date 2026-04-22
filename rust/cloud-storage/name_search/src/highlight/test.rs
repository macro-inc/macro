use super::highlight_name;

#[test]
fn returns_none_for_empty_term() {
    assert!(highlight_name("testingfoop", "").is_none());
    assert!(highlight_name("testingfoop", "   ").is_none());
}

#[test]
fn returns_none_when_name_does_not_match() {
    assert!(highlight_name("unrelated", "test").is_none());
}

#[test]
fn wraps_substring_matches_case_insensitively() {
    assert_eq!(
        highlight_name("testingfoop", "test").as_deref(),
        Some("<macro_em>test</macro_em>ingfoop")
    );
    assert_eq!(
        highlight_name("MD CHECKBOX LIST TEST", "test").as_deref(),
        Some("MD CHECKBOX LIST <macro_em>TEST</macro_em>")
    );
}

#[test]
fn wraps_all_occurrences() {
    assert_eq!(
        highlight_name("test of a test", "test").as_deref(),
        Some("<macro_em>test</macro_em> of a <macro_em>test</macro_em>")
    );
}

#[test]
fn escapes_regex_specials_in_term() {
    assert_eq!(
        highlight_name("plan (v2) draft", "(v2)").as_deref(),
        Some("plan <macro_em>(v2)</macro_em> draft")
    );
}
