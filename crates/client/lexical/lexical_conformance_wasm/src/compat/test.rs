use super::*;

#[test]
fn exported_format_names_and_bits_match_the_pinned_upstream_literals() {
    assert_eq!(
        Value::Object(format_flags()),
        serde_json::json!({
            "IS_BOLD":1,"IS_ITALIC":2,"IS_STRIKETHROUGH":4,"IS_UNDERLINE":8,
            "IS_CODE":16,"IS_SUBSCRIPT":32,"IS_SUPERSCRIPT":64,"IS_HIGHLIGHT":128,
            "IS_LOWERCASE":256,"IS_UPPERCASE":512,"IS_CAPITALIZE":1024
        })
    );
}
