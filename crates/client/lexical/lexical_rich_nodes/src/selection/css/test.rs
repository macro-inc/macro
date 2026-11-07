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

#[test]
fn malformed_css_keeps_the_upstream_partial_declarations() {
    for (css, expected) in [
        ("a: red/*unterminated; b: blue", vec![("a", "red")]),
        (
            "a: 'unterminated; b: red",
            vec![("a", "'unterminated; b: red")],
        ),
        ("a: fn(x;y: z; b:q", vec![("a", "fn(x;y: z; b:q")]),
        ("a/*comment*/b: yes", vec![("ab", "yes")]),
        ("a: foo\\; b: yes", vec![("a", "foo\\"), ("b", "yes")]),
        ("bad; x:y; :empty; z:", vec![("x", "y")]),
    ] {
        let styles = style_object_from_css(css);
        assert_eq!(
            styles
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str()))
                .collect::<Vec<_>>(),
            expected,
            "{css}"
        );
    }
}
