use super::{build_task_branch_name, slugify};

#[test]
fn strips_brackets_and_special_chars() {
    assert_eq!(slugify("[search] fix bug"), "search-fix-bug");
}

#[test]
fn lowercases_and_replaces_spaces() {
    assert_eq!(slugify("My Cool Task"), "my-cool-task");
}

#[test]
fn collapses_consecutive_hyphens() {
    assert_eq!(slugify("foo  -- bar"), "foo-bar");
}

#[test]
fn trims_leading_and_trailing_hyphens() {
    assert_eq!(slugify("  -hello world-  "), "hello-world");
}

#[test]
fn keeps_digits() {
    assert_eq!(slugify("Issue 1234: do thing"), "issue-1234-do-thing");
}

#[test]
fn drops_non_ascii() {
    assert_eq!(slugify("café résumé"), "caf-rsum");
}

#[test]
fn empty_after_sanitization() {
    assert_eq!(slugify("!!!@@@"), "");
}

#[test]
fn keeps_existing_hyphens() {
    assert_eq!(slugify("foo-bar-baz"), "foo-bar-baz");
}

#[test]
fn builds_full_branch_name() {
    assert_eq!(
        build_task_branch_name("abcd1234", "[search] fix bug"),
        "search-fix-bug-macro-abcd1234"
    );
}

#[test]
fn falls_back_to_suffix_when_slug_empty() {
    assert_eq!(build_task_branch_name("abcd1234", "!!!"), "macro-abcd1234");
}

#[test]
fn caps_branch_name_at_max_length() {
    let title = "word ".repeat(60);
    let result = build_task_branch_name("abcd1234", &title);
    assert!(result.len() <= 200);
    assert!(result.ends_with("-macro-abcd1234"));
    // Truncation happens at a hyphen boundary, so no trailing partial word.
    assert!(!result.contains("-w-macro-"));
}

#[test]
fn truncates_at_hyphen_boundary() {
    // Short id "id" → suffix "macro-id" (8 chars). Available slug = 200 - 9 = 191.
    let mut slug_input = String::new();
    for _ in 0..30 {
        slug_input.push_str("longword ");
    }
    let result = build_task_branch_name("id", &slug_input);
    assert!(result.len() <= 200);
    // The slug portion should not end with a partial "longword".
    let slug_portion = result.trim_end_matches("-macro-id");
    for segment in slug_portion.split('-') {
        assert_eq!(segment, "longword", "found partial word: {segment}");
    }
}
