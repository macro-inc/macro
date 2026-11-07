use super::*;
#[test]
fn css_quotes_comments_parentheses_and_overwrites_preserve_order() {
    let css = style_object_from_css(
        "\u{feff}color: red; x: url('a;:/*b*/'); /* ignore */ color: blue; q: \"a\\\";b\"; empty: ; tail: yes",
    );
    assert_eq!(
        css.iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<Vec<_>>(),
        [
            ("color", "blue"),
            ("x", "url('a;:/*b*/')"),
            ("q", "\"a\\\";b\""),
            ("tail", "yes")
        ]
    );
    assert_eq!(
        css_from_style_object(&css),
        "color: blue;x: url('a;:/*b*/');q: \"a\\\";b\";tail: yes;"
    );
    assert_eq!(js_trim("\u{feff} a \u{2029}"), "a");
    assert_eq!(js_trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
}
