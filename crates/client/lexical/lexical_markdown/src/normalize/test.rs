use super::*;
#[test]
fn normalization_keeps_hard_breaks_html_boundaries_and_code_whitespace() {
    assert_eq!(
        normalize_markdown("one  \ntwo\nthree", true),
        "one  \ntwo three"
    );
    assert_eq!(normalize_markdown("one\n\u{feff}two", true), "one two");
    assert_eq!(
        normalize_markdown("one\n<ſpan>\ntwo", true),
        "one <ſpan> two"
    );
    assert_eq!(
        normalize_markdown("one\n<span>\ntwo\n</span>\nend", true),
        "one\n<span>\ntwo\n</span>\nend"
    );
    assert_eq!(
        normalize_markdown("```js\nx  \n```\nnext", true),
        "```js\nx  \n```\nnext"
    );
    assert_eq!(
        normalize_markdown("one  \n  \ntwo\u{a0}", false),
        "one  \n\ntwo\u{a0}"
    );
}
