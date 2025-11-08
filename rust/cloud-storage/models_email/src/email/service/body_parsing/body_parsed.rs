use crate::email::service::message;
use html2text::config::Config;
use html2text::render::PlainDecorator;

pub fn get_body_parsed_for_message(message: &message::MessageWithBodyReplyless) -> Option<String> {
    // if the message has no body_html, that means the body_replyless
    // is plaintext. meaning it's already parsed, and we can just use that.
    if message.inner.body_html_sanitized.is_none() {
        message.body_replyless.clone()
    } else {
        // Otherwise, body_replyless is html, and we need to parse it into plaintext.

        let config = html2text::config::plain()
            .no_table_borders()
            .link_footnotes(true);

        parse_html_to_text(&message.body_replyless, config)
    }
}

pub fn get_body_parsed_linkless_for_message(
    message: &message::MessageWithBodyReplyless,
) -> Option<String> {
    // if the message has no body_html, that means the body_replyless
    // is plaintext. meaning it's already parsed, and we can just use that.
    if message.inner.body_html_sanitized.is_none() {
        message.body_replyless.clone()
    } else {
        // Otherwise, body_replyless is html, and we need to parse it into plaintext.

        let config = html2text::config::plain()
            .no_table_borders()
            .link_footnotes(false)
            .no_link_wrapping();

        // remove square brackets around links
        parse_html_to_text(&message.body_replyless, config)
            // more performant than .replace() as .replace() makes a copy
            .map(|mut text| {
                text.retain(|c| c != '[' && c != ']');
                text
            })
    }
}

fn parse_html_to_text(
    body_html_sanitized: &Option<String>,
    config: Config<PlainDecorator>,
) -> Option<String> {
    if let Some(html) = body_html_sanitized {
        match config.string_from_read(html.as_bytes(), usize::MAX) {
            Ok(text) => {
                let trimmed_text = text
                    .lines()
                    .map(|line| line.trim())
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<&str>>()
                    .join("\n");

                Some(trimmed_text)
            }
            Err(_) => None,
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn get_default_config() -> Config<PlainDecorator> {
        html2text::config::plain()
            .no_table_borders()
            .link_footnotes(true)
    }

    #[test]
    fn test_parse_html_to_text_with_simple_html() {
        let html = Some("<html><body><p>Hello, world!</p></body></html>".to_string());
        let provider_id = "gmail";
        let link_id = macro_uuid::generate_uuid_v7();

        let result = parse_html_to_text(&html, get_default_config());

        assert_eq!(result, Some("Hello, world!".to_string()));
    }

    #[test]
    fn test_parse_html_to_text_with_none() {
        let html: Option<String> = None;
        let provider_id = "gmail";
        let link_id = macro_uuid::generate_uuid_v7();

        let result = parse_html_to_text(&html, get_default_config());
        assert_eq!(result, None);
    }

    #[test]
    fn test_parse_html_to_text_with_empty_html() {
        let html = Some("".to_string());
        let provider_id = "gmail";
        let link_id = macro_uuid::generate_uuid_v7();

        let result = parse_html_to_text(&html, get_default_config());

        assert_eq!(result, Some("".to_string()));
    }

    #[test]
    fn test_parse_html_to_text_with_malformed_html() {
        let html = Some("<p>Unclosed paragraph<div>Nested content</p>".to_string());
        let provider_id = "yahoo";
        let link_id = macro_uuid::generate_uuid_v7();

        let result = parse_html_to_text(&html, get_default_config());

        // html2text is pretty forgiving with malformed HTML
        assert!(result.is_some());
        let text = result.unwrap();
        assert!(text.contains("Unclosed paragraph"));
        assert!(text.contains("Nested content"));
    }

    #[test]
    fn test_parse_html_to_text_with_formatted_email() {
        let html = Some(
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
        let provider_id = "gmail";
        let link_id = Uuid::new_v4();

        let result = parse_html_to_text(&html, get_default_config());

        assert!(result.is_some());
        let text = result.unwrap();
        assert!(text.contains("Hi John,"));
        assert!(text.contains("Thank you for your inquiry"));
        assert!(text.contains("Example Corp."));
        assert!(text.contains("123 Business St."));
    }
}
