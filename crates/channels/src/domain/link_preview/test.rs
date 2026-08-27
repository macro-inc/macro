use super::*;

const URL: &str = "https://example.com/article";

fn m_link_content(url: &str) -> String {
    format!(r#"check this <m-link>{{"url":"{url}","text":"{url}","title":""}}</m-link> out"#)
}

#[test]
fn suppresses_matching_m_link_payload() {
    let content = m_link_content(URL);
    let out = remove_link_preview_from_content(&content, URL);
    assert_eq!(
        out,
        format!(
            r#"check this <m-link>{{"url":"{URL}","text":"{URL}","title":"","preview":false}}</m-link> out"#
        )
    );
}

#[test]
fn preserves_author_payload_field_order() {
    let content =
        r#"<m-link>{"text":"t","url":"https://example.com/article","title":"x"}</m-link>"#;
    let out = remove_link_preview_from_content(content, URL);
    assert_eq!(
        out,
        r#"<m-link>{"text":"t","url":"https://example.com/article","title":"x","preview":false}</m-link>"#
    );
}

#[test]
fn leaves_other_links_untouched() {
    let content = format!(
        "{} and {}",
        m_link_content(URL),
        m_link_content("https://other.com")
    );
    let out = remove_link_preview_from_content(&content, URL);
    assert!(out.contains(r#""url":"https://other.com","text":"https://other.com","title":""}"#));
    assert_eq!(out.matches("\"preview\":false").count(), 1);
}

#[test]
fn flips_existing_preview_true() {
    let content = r#"<m-link>{"url":"https://example.com/article","text":"t","title":"","preview":true}</m-link>"#;
    let out = remove_link_preview_from_content(content, URL);
    assert!(out.contains("\"preview\":false"));
    assert!(!out.contains("\"preview\":true"));
}

#[test]
fn empty_url_is_a_no_op() {
    let content = m_link_content(URL);
    assert_eq!(remove_link_preview_from_content(&content, ""), content);
}

#[test]
fn is_idempotent() {
    let once = remove_link_preview_from_content(&m_link_content(URL), URL);
    let twice = remove_link_preview_from_content(&once, URL);
    assert_eq!(once, twice);
}

#[test]
fn wraps_bare_url_occurrence() {
    let out = remove_link_preview_from_content(&format!("see {URL} please"), URL);
    assert_eq!(
        out,
        format!(
            r#"see <m-link>{{"url":"{URL}","text":"{URL}","title":"","preview":false}}</m-link> please"#
        )
    );
}

#[test]
fn wraps_markdown_link_keeping_label() {
    let out = remove_link_preview_from_content(&format!("see [the article]({URL}) please"), URL);
    assert_eq!(
        out,
        format!(
            r#"see <m-link>{{"url":"{URL}","text":"the article","title":"","preview":false}}</m-link> please"#
        )
    );
}

#[test]
fn ignores_url_as_substring_of_longer_url() {
    let content = format!("see {URL}/nested");
    assert_eq!(remove_link_preview_from_content(&content, URL), content);
}

#[test]
fn no_op_when_url_absent() {
    let content = m_link_content("https://other.com");
    assert_eq!(remove_link_preview_from_content(&content, URL), content);
}

#[test]
fn does_not_rewrite_url_inside_other_m_link_payload_text() {
    // URL appears only as the text of a DIFFERENT link's payload.
    let content =
        format!(r#"<m-link>{{"url":"https://other.com","text":"{URL}","title":""}}</m-link>"#);
    assert_eq!(remove_link_preview_from_content(&content, URL), content);
}

#[test]
fn does_not_rewrite_repeated_url_inside_another_payload_text() {
    // Target URL appears twice inside ANOTHER link's display text.
    let content = format!(
        r#"<m-link>{{"url":"https://other.com","text":"see {URL} and {URL} now","title":""}}</m-link>"#
    );
    assert_eq!(remove_link_preview_from_content(&content, URL), content);
}

#[test]
fn suppresses_both_m_link_and_bare_occurrence() {
    let content = format!("{} and also {URL}", m_link_content(URL));
    let out = remove_link_preview_from_content(&content, URL);
    // Neither occurrence should still render a preview.
    assert_eq!(out.matches("\"preview\":false").count(), 2, "out: {out}");
}
