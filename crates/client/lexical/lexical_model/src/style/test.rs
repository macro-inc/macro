use super::*;
#[test]
fn css_nested_quoted_escaped_comments_and_duplicates() {
    let css = parse_css_declarations(
        "color: red; background: url('a;b:c'); /* ignore */ color: blue; --x: fn(a; fn(b)); content: \"a\\\";b\"; broken; width: 1px",
    );
    assert_eq!(css.get("color").map(String::as_str), Some("blue"));
    assert_eq!(
        css.get("background").map(String::as_str),
        Some("url('a;b:c')")
    );
    assert_eq!(css.get("--x").map(String::as_str), Some("fn(a; fn(b))"));
    assert_eq!(css.get("content").map(String::as_str), Some("\"a\\\";b\""));
    assert_eq!(css.get("width").map(String::as_str), Some("1px"));
    assert_eq!(css.keys().next().map(String::as_str), Some("color"));
}

#[test]
fn malformed_css_drops_invalid_declarations_without_losing_valid_neighbors() {
    let parsed = parse_css_declarations(
        "empty:;:bad;no-colon; color: red; x:func(1;2); broken:'unterminated",
    );
    assert_eq!(parsed.get("color").map(String::as_str), Some("red"));
    assert_eq!(parsed.get("x").map(String::as_str), Some("func(1;2)"));
    assert!(!parsed.contains_key("no-colon"));
}
