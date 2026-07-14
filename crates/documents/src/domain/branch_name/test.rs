use super::{build_task_branch_name, slugify, user_branch_prefix};

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
fn user_prefix_prefers_github_username() {
    assert_eq!(
        user_branch_prefix(Some("octocat"), "user@example.com"),
        "octocat"
    );
}

#[test]
fn user_prefix_falls_back_to_email_local_part() {
    assert_eq!(user_branch_prefix(None, "user@example.com"), "user");
}

#[test]
fn user_prefix_sanitizes_branch_component() {
    assert_eq!(
        user_branch_prefix(Some(" user/name "), "fallback@example.com"),
        "user-name"
    );
}

#[test]
fn builds_full_branch_name_with_short_id_fallback() {
    assert_eq!(
        build_task_branch_name("user", None, None, "abcd1234", "[search] fix bug"),
        "user/macro-abcd1234-search-fix-bug"
    );
}

#[test]
fn builds_full_branch_name_with_team_task_id() {
    assert_eq!(
        build_task_branch_name(
            "octocat",
            Some("ENG"),
            Some(42),
            "abcd1234",
            "[search] fix bug"
        ),
        "octocat/eng-42-search-fix-bug"
    );
}

#[test]
fn falls_back_to_prefix_when_slug_empty() {
    assert_eq!(
        build_task_branch_name("user", None, None, "abcd1234", "!!!"),
        "user/macro-abcd1234"
    );
}

#[test]
fn caps_branch_name_at_max_length() {
    let title = "word ".repeat(60);
    let result = build_task_branch_name("user", None, None, "abcd1234", &title);
    assert!(result.len() <= 200);
    assert!(result.starts_with("user/macro-abcd1234-"));
    // Truncation happens at a hyphen boundary, so no trailing partial word.
    let slug_portion = result.trim_start_matches("user/macro-abcd1234-");
    for segment in slug_portion.split('-') {
        assert_eq!(segment, "word", "found partial word: {segment}");
    }
}

#[test]
fn truncates_at_hyphen_boundary() {
    let mut slug_input = String::new();
    for _ in 0..30 {
        slug_input.push_str("longword ");
    }
    let result = build_task_branch_name("user", Some("ENG"), Some(42), "id", &slug_input);
    assert!(result.len() <= 200);
    assert!(result.starts_with("user/eng-42-"));

    let slug_portion = result.trim_start_matches("user/eng-42-");
    for segment in slug_portion.split('-') {
        assert_eq!(segment, "longword", "found partial word: {segment}");
    }
}
