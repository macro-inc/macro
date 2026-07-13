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
    // html2text panics with a divide-by-zero on rowspan="0" (still
    // unfixed upstream as of 0.16.5). The catch_unwind wrapper must
    // contain it and treat the body as unparseable.
    let body = Some("<table><td rowspan=\"0\">x".to_string());
    let result = compute_body_parsed_linkless(true, &body);
    assert_eq!(result, None);
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
