use super::slugify;

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
