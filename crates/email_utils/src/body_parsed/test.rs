use super::*;

#[test]
fn test_plaintext_passthrough() {
    let body = Some("Hello, world!".to_string());
    let result = compute_body_parsed(false, &body);
    assert_eq!(result, Some("Hello, world!".to_string()));
}

#[test]
fn test_none_body() {
    assert_eq!(compute_body_parsed(false, &None), None);
    assert_eq!(compute_body_parsed(true, &None), None);
}

#[test]
fn test_html_to_text() {
    let body = Some("<html><body><p>Hello, world!</p></body></html>".to_string());
    let result = compute_body_parsed(true, &body);
    assert_eq!(result, Some("Hello, world!".to_string()));
}

#[test]
fn test_empty_html() {
    let body = Some("".to_string());
    let result = compute_body_parsed(true, &body);
    assert_eq!(result, Some("".to_string()));
}

#[test]
fn test_malformed_html() {
    let body = Some("<p>Unclosed paragraph<div>Nested content</p>".to_string());
    let result = compute_body_parsed(true, &body);
    assert!(result.is_some());
    let text = result.unwrap();
    assert!(text.contains("Unclosed paragraph"));
    assert!(text.contains("Nested content"));
}

#[test]
fn test_formatted_email() {
    let body = Some(
        r#"
        <html>
            <body>
                <div>
                    <p>Hi John,</p>
                    <p>Thank you for your inquiry about our services.</p>
                    <p>Our team will get back to you within 24 hours.</p>
                    <hr>
                    <div style="color: gray; font-size: 12px;">
                        <p>Example Corp.</p>
                        <p>123 Business St.<br>Suite 100<br>San Francisco, CA 94107</p>
                        <p>Phone: (555) 555-5555</p>
                    </div>
                </div>
            </body>
        </html>
    "#
        .to_string(),
    );

    let result = compute_body_parsed(true, &body);
    assert!(result.is_some());
    let text = result.unwrap();
    assert!(text.contains("Hi John,"));
    assert!(text.contains("Thank you for your inquiry"));
    assert!(text.contains("Example Corp."));
    assert!(text.contains("123 Business St."));
}

#[test]
fn test_html_to_plaintext_inline_vs_block() {
    // Inline tags stay on one line — no spurious break between the runs.
    // Emphasis renders as markdown markers, matching the rest of our
    // HTML->plaintext conversion.
    assert_eq!(
        html_to_plaintext("<div>Thanks <strong>Alice</strong></div>"),
        Some("Thanks **Alice**".to_string())
    );
    // Block elements are separated by newlines.
    assert_eq!(
        html_to_plaintext("<div>Thanks</div><div>Alice</div>"),
        Some("Thanks\nAlice".to_string())
    );
}

#[test]
fn test_rowspan_overhang_does_not_panic() {
    // html2text 0.15.x panicked with "capacity overflow" on a rowspan
    // extending past the last table row (tot_width underflow).
    let body = Some("<table><th rowspan=\"5\"><tr>".to_string());
    let result = compute_body_parsed_linkless(true, &body);
    assert_eq!(result, Some(String::new()));
}

#[test]
fn test_rowspan_zero_does_not_panic() {
    // html2text's column layout divides by zero on rowspan="0" (still
    // unfixed upstream as of 0.16.5). Raw mode stacks the cells instead of
    // laying them out, so the cell's text survives.
    let body = Some("<table><td rowspan=\"0\">x".to_string());
    let result = compute_body_parsed_linkless(true, &body);
    assert_eq!(result, Some("x".to_string()));
}

#[test]
fn test_linkless_strips_brackets() {
    let body = Some("<p>Visit <a href=\"https://example.com\">example</a></p>".to_string());
    let result = compute_body_parsed_linkless(true, &body);
    assert!(result.is_some());
    let text = result.unwrap();
    assert!(!text.contains('['));
    assert!(!text.contains(']'));
}

#[test]
fn undecorated_text_has_no_emphasis_marks() {
    assert_eq!(
        html_to_undecorated_text(
            "<p>Thanks, <b>see</b> <em>you</em> <a href=\"https://example.com\">Monday</a></p>"
        ),
        Some("Thanks, see you Monday".to_string())
    );
}

#[test]
fn quotes_nested_to_the_limit_still_convert() {
    let html = format!("{}deep text", "<blockquote>".repeat(64));

    let text = html_to_plaintext(&html);

    assert!(text.is_some_and(|text| text.ends_with("deep text")));
}

#[test]
fn quotes_nested_past_the_limit_get_no_text() {
    let html = format!("{}deep text", "<blockquote>".repeat(65));

    assert_eq!(html_to_plaintext(&html), None);
}

#[test]
fn side_by_side_cells_keep_their_text_together() {
    let html = format!(
        "<table><tr><td>{}</td><td>{}</td></tr></table>",
        "alpha ".repeat(200),
        "bravo ".repeat(200)
    );

    let text = html_to_plaintext(&html).expect("the table converts");

    assert!(
        text.lines()
            .all(|line| !(line.contains("alpha") && line.contains("bravo")))
    );
    assert!(text.contains(&"alpha ".repeat(100)));
    assert!(text.contains(&"bravo ".repeat(100)));
}

#[test]
fn a_footnoted_link_longer_than_the_width_stays_on_one_line() {
    let url = format!("https://example.com/{}", "a".repeat(1_500));
    let body = Some(format!("<p><a href=\"{url}\">the report</a></p>"));

    let text = compute_body_parsed(true, &body).expect("the body converts");

    assert!(text.lines().any(|line| line.ends_with(&url)));
}

#[test]
fn a_body_past_the_size_limit_converts_only_its_start() {
    let html = format!(
        "<p>opening line</p><p>{}</p><p>closing line</p>",
        "word ".repeat(250_000)
    );

    let text = html_to_plaintext(&html).expect("the body converts");

    assert!(text.starts_with("opening line"));
    assert!(!text.contains("closing line"));
}
