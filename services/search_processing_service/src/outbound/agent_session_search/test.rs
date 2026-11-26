use super::shown_text;

#[test]
fn a_link_is_indexed_as_the_text_the_transcript_shows() {
    assert_eq!(
        shown_text(
            r#"Fetch <m-link>{"url":"https://example.com/q3","text":"the quarterly report","title":""}</m-link> and summarize it"#
        ),
        "Fetch the quarterly report and summarize it"
    );
}

#[test]
fn a_document_mention_is_indexed_as_its_name() {
    assert_eq!(
        shown_text(
            r#"Compare <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Pricing plan","blockParams":{}}</m-document-mention> with last year"#
        ),
        "Compare Pricing plan with last year"
    );
}

#[test]
fn prose_that_is_not_markup_is_kept_as_written() {
    let reply = "Return a Vec<String> when a < b, and keep <div> as text.";
    assert_eq!(shown_text(reply), reply);
}

#[test]
fn a_paste_is_indexed_as_its_content() {
    assert_eq!(
        shown_text(
            r#"Why does this fail?
<m-paste>{"content":"panic at invoice total overflow <line 42>","origin":"pasted"}</m-paste> Fix it."#
        ),
        "Why does this fail?\npanic at invoice total overflow <line 42> Fix it."
    );
}

/// Agents leave a mention's name empty; it reads as its kind, as in channels.
#[test]
fn a_nameless_document_mention_reads_as_its_kind() {
    assert_eq!(
        shown_text(
            r#"Filed <m-document-mention>{"documentId":"t1","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>"#
        ),
        "Filed <task>"
    );
}

#[test]
fn markup_from_the_first_tag_that_does_not_parse_stays_as_written() {
    let text = r#"The parser reads `<m-link>` tags. See <m-link>{"url":"https://example.com","text":"docs"}</m-link>."#;
    assert_eq!(shown_text(text), text);
}

/// A tag that does not parse keeps its stretch as written; a paste after it
/// still reads as its content.
#[test]
fn a_paste_after_markup_that_does_not_parse_still_reads_as_its_content() {
    assert_eq!(
        shown_text(
            r#"See <m-link>not json</m-link> then <m-paste>{"content":"invoice total"}</m-paste>"#
        ),
        "See <m-link>not json</m-link> then invoice total"
    );
}
