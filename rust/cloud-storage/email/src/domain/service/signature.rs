use lol_html::html_content::ContentType;
use lol_html::{HtmlRewriter, Settings, element};
use scraper::{Html, Selector};
use std::cell::Cell;

/// Injects the (already-sanitized) signature into the outgoing HTML body,
/// wrapped in a `.macro-email-signature` marker div. Placed after the message
/// but above any quoted/forwarded thread (Gmail's ordering): inserted before the
/// first `.macro_quote` block if present, otherwise appended as the last child
/// of `<body>`. On any rewriting error it falls back to a plain append so the
/// signature is never silently dropped.
pub(crate) fn inject_signature(body_html: &str, signature_html: &str) -> String {
    let wrapped = format!(r#"<div class="macro-email-signature">{signature_html}</div>"#);

    let has_quote = Selector::parse(".macro_quote")
        .ok()
        .map(|sel| {
            Html::parse_fragment(body_html)
                .select(&sel)
                .next()
                .is_some()
        })
        .unwrap_or(false);

    let done = Cell::new(false);
    let selector = if has_quote { ".macro_quote" } else { "body" };
    let mut output = Vec::new();
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![element!(selector, |el| {
                if !done.get() {
                    if has_quote {
                        el.before(&wrapped, ContentType::Html);
                    } else {
                        el.append(&wrapped, ContentType::Html);
                    }
                    done.set(true);
                }
                Ok(())
            })],
            ..Settings::default()
        },
        |c: &[u8]| output.extend_from_slice(c),
    );

    if rewriter.write(body_html.as_bytes()).is_err() {
        return format!("{body_html}{wrapped}");
    }
    if rewriter.end().is_err() {
        return format!("{body_html}{wrapped}");
    }
    String::from_utf8(output).unwrap_or_else(|_| format!("{body_html}{wrapped}"))
}

/// Extracts the signature's visible text for the `text/plain` MIME alternative.
pub(crate) fn signature_plain_text(signature_html: &str) -> String {
    Html::parse_fragment(signature_html)
        .root_element()
        .text()
        .collect::<String>()
        .trim()
        .to_string()
}
