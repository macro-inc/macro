use super::with_pastes_as_content;

/// Brackets each call, so the output shows which stretches were flattened
/// together.
fn bracket(markup: &str) -> String {
    format!("[{markup}]")
}

#[test]
fn each_stretch_around_a_paste_is_flattened_on_its_own() {
    assert_eq!(
        with_pastes_as_content(
            "a\n\n<m-paste>{\"content\":\"panic at \\u003cline 42\\u003e\",\"origin\":\"pasted\"}</m-paste>\n\nb",
            bracket
        ),
        "[a\n\n]panic at <line 42>[\n\nb]"
    );
}

#[test]
fn text_without_pastes_is_flattened_in_one_call() {
    assert_eq!(
        with_pastes_as_content("plain <m-link>x</m-link> a < b", bracket),
        "[plain <m-link>x</m-link> a < b]"
    );
    assert_eq!(with_pastes_as_content("", bracket), "");
}

#[test]
fn a_paste_that_does_not_parse_stays_as_written() {
    assert_eq!(
        with_pastes_as_content("a <m-paste>not json</m-paste> b", bracket),
        "[a ]<m-paste>not json</m-paste>[ b]"
    );
}

#[test]
fn an_opener_without_a_closer_keeps_the_rest_as_written() {
    assert_eq!(
        with_pastes_as_content("a <m-paste> b <m-paste> c", bracket),
        "[a ]<m-paste> b <m-paste> c"
    );
    let many = "<m-paste>x ".repeat(20_000);
    assert_eq!(with_pastes_as_content(&many, bracket), many);
}
