use crate::util::process_pre_insert::clean_message::clean_message;
use models_email::email::service;

#[test]
fn test_clean_html_test_1() {
    // Given an email with Outlook-style formatting and a "From:" separator
    let full_email = include_str!("../testdata/test-1/dirty.html");
    let expected_reply = include_str!("../testdata/test-1/clean.html");

    test_clean_html(full_email, expected_reply, "test-1");
}

fn message_with_html(html: &str) -> service::message::Message {
    service::message::Message {
        db_id: uuid::Uuid::default(),
        provider_id: None,
        global_id: None,
        thread_db_id: uuid::Uuid::default(),
        provider_thread_id: None,
        replying_to_id: None,
        link_id: Default::default(),
        subject: None,
        snippet: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: false,
        from: None,
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_html_sanitized: Some(html.to_string()),
        body_text: None,
        attachments: vec![],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: Default::default(),
        labels: vec![],
        body_macro: None,
        updated_at: Default::default(),
    }
}

fn test_clean_html(dirty_html: &str, expected_clean_html: &str, test_name: &str) {
    let mut message = message_with_html(dirty_html);

    // When we extract the reply
    clean_message(&mut message);

    assert_eq!(
        message
            .body_html_sanitized
            .unwrap()
            .replace(" ", "")
            .replace("\n", "")
            .trim(),
        expected_clean_html
            .replace(" ", "")
            .replace("\n", "")
            .trim(),
        "Test '{}' failed: extracted reply doesn't match expected",
        test_name
    );
}

/// Runs the ingest order: sanitize the provider's HTML, then clean it.
fn sanitize_then_clean(raw_html: &str) -> String {
    let mut message = message_with_html(&email_utils::sanitize_email_html(raw_html));
    clean_message(&mut message);
    message.body_html_sanitized.unwrap()
}

/// Element and attribute names in `html`, as a browser would parse it.
fn elements_and_attributes(html: &str) -> Vec<String> {
    scraper::Html::parse_fragment(html)
        .root_element()
        .descendants()
        .skip(1)
        .filter_map(scraper::ElementRef::wrap)
        .map(|element| {
            let attributes: Vec<&str> = element.value().attrs().map(|(name, _)| name).collect();
            format!("{}[{}]", element.value().name(), attributes.join(","))
        })
        .collect()
}

#[test]
fn escaped_tag_in_text_stays_text() {
    let cleaned =
        sanitize_then_clean("<p>Wrap a word in &lt;b&gt; and &lt;/b&gt; to make it bold.</p>");

    assert_eq!(
        cleaned,
        "<p>Wrap a word in &lt;b&gt; and &lt;/b&gt; to make it bold.</p>"
    );
    assert_eq!(elements_and_attributes(&cleaned), ["p[]"]);
}

#[test]
fn escaped_tag_before_the_last_content_stays_text() {
    // Nodes ahead of the last piece of content take the other serialization path.
    let cleaned = sanitize_then_clean(
        "<div>Type &lt;i&gt;word&lt;/i&gt; for italics, then <b>stop</b></div>",
    );

    assert_eq!(
        cleaned,
        "<div>Type &lt;i&gt;word&lt;/i&gt; for italics, then <b>stop</b></div>"
    );
    assert_eq!(elements_and_attributes(&cleaned), ["div[]", "b[]"]);
}

#[test]
fn escaped_address_in_text_is_kept() {
    let cleaned =
        sanitize_then_clean("<div>Ask Grace &lt;grace@example.com&gt; <i>today</i></div>");

    assert_eq!(
        cleaned,
        "<div>Ask Grace &lt;grace@example.com&gt; <i>today</i></div>"
    );
}

#[test]
fn quote_in_attribute_value_stays_in_the_value() {
    let cleaned = sanitize_then_clean(
        r#"<p title="Say &quot;hi&quot; to everyone" style="color:red">Hover</p>"#,
    );

    assert_eq!(elements_and_attributes(&cleaned), ["p[title,style]"]);
    assert_eq!(
        cleaned,
        r#"<p title="Say &quot;hi&quot; to everyone" style="color:red">Hover</p>"#
    );
}

#[test]
fn escaped_ampersand_entity_is_not_decoded_twice() {
    let cleaned = sanitize_then_clean("<p>type &amp;lt;b&amp;gt; for bold</p>");

    assert_eq!(cleaned, "<p>type &amp;lt;b&amp;gt; for bold</p>");
}

#[test]
fn cleaning_sanitized_html_leaves_nothing_for_the_sanitizer_to_remove() {
    let payloads = [
        r#"<p>&lt;script&gt;run()&lt;/script&gt;</p>"#,
        r#"<div>&lt;img src=x onerror=run()&gt;<br><br></div>"#,
        r#"<p>one</p>&lt;iframe src="https://example.com"&gt;&lt;/iframe&gt;<br>"#,
        r#"<a href="https://example.com" title="&quot; onclick=&quot;run()">link</a>"#,
        r#"<img src="https://example.com/a.png" alt="&quot; onerror=&quot;run()">"#,
        r#"<table><tr><td align="&quot;&gt;&lt;script&gt;run()&lt;/script&gt;">cell</td></tr></table>"#,
        r#"<style>p &gt; b { color: red }</style><p>text &lt;/p&gt;&lt;svg onload=run()&gt;</p>"#,
    ];

    for payload in payloads {
        let cleaned = sanitize_then_clean(payload);
        assert_eq!(
            elements_and_attributes(&email_utils::sanitize_email_html(&cleaned)),
            elements_and_attributes(&cleaned),
            "cleaning made markup out of text in {payload}"
        );
    }
}

#[test]
fn trailing_breaks_and_empty_containers_are_removed() {
    let cleaned =
        sanitize_then_clean("<div>Hello<br></div><div><br></div><p> </p><br><!-- end -->");

    assert_eq!(cleaned, "<div>Hello</div>");
}

#[test]
fn breaks_before_the_last_content_are_kept() {
    let cleaned = sanitize_then_clean(
        r#"<div>a<br><br>b</div><div><br></div><img src="https://example.com/a.png"><br>"#,
    );

    assert_eq!(
        cleaned,
        r#"<div>a<br><br>b</div><div><br></div><img src="https://example.com/a.png">"#
    );
}

#[test]
fn deeply_nested_elements_are_cleaned_without_overflowing_the_stack() {
    // A stack this small holds the walk only if its depth does not grow with
    // the nesting of the message.
    let cleaned = std::thread::Builder::new()
        .stack_size(256 * 1024)
        .spawn(|| {
            let mut message = message_with_html(&format!("{}text<br>", "<div>".repeat(5_000)));
            clean_message(&mut message);
            message.body_html_sanitized.unwrap()
        })
        .unwrap()
        .join()
        .unwrap();

    assert_eq!(cleaned.matches("<div>").count(), 5_000);
    assert!(cleaned.contains("<div>text</div>"));
}

#[test]
fn markup_inside_a_style_element_stays_style_text() {
    let cleaned = sanitize_then_clean("<style><b>Bold</b></style><p>styled</p><br>");

    assert_eq!(elements_and_attributes(&cleaned), ["style[]", "p[]"]);
}
