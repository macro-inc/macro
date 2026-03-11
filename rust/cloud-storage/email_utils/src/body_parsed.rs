use html2text::config::Config;
use html2text::render::PlainDecorator;

/// Convert `body_replyless` into plaintext with link footnotes.
///
/// If the original message had no HTML body, `body_replyless` is already plaintext.
/// Otherwise it's HTML and is parsed to plaintext using `html2text`.
pub fn compute_body_parsed(has_html: bool, body_replyless: &Option<String>) -> Option<String> {
    let text = body_replyless.as_ref()?;

    if !has_html {
        return Some(text.clone());
    }

    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(true);

    parse_html_to_text(text, config)
}

/// Convert `body_replyless` into plaintext without link footnotes or brackets.
///
/// Same as [`compute_body_parsed`] but strips link wrapping and square brackets,
/// producing cleaner text for search indexing.
pub fn compute_body_parsed_linkless(
    has_html: bool,
    body_replyless: &Option<String>,
) -> Option<String> {
    let text = body_replyless.as_ref()?;

    if !has_html {
        return Some(text.clone());
    }

    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(false)
        .no_link_wrapping();

    parse_html_to_text(text, config).map(|mut text| {
        text.retain(|c| c != '[' && c != ']');
        text
    })
}

fn parse_html_to_text(html: &str, config: Config<PlainDecorator>) -> Option<String> {
    match config.string_from_read(html.as_bytes(), usize::MAX) {
        Ok(text) => {
            let trimmed = text
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .collect::<Vec<&str>>()
                .join("\n");
            Some(trimmed)
        }
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
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
    fn test_linkless_strips_brackets() {
        let body = Some("<p>Visit <a href=\"https://example.com\">example</a></p>".to_string());
        let result = compute_body_parsed_linkless(true, &body);
        assert!(result.is_some());
        let text = result.unwrap();
        assert!(!text.contains('['));
        assert!(!text.contains(']'));
    }
}
