use lol_html::html_content::ContentType;
use lol_html::{HtmlRewriter, Settings, element};
use scraper::{Html, Selector};
use std::cell::Cell;

#[cfg(test)]
mod test;

/// Marker class wrapping an injected signature.
const SIGNATURE_CLASS: &str = "macro-email-signature";

/// Whether the body already carries our signature in its own content (idempotency
/// for re-sends / an old client that still bakes it in). A signature inside a
/// quoted thread (`.macro_quote`) is the replied-to message's and is ignored.
pub(crate) fn has_signature(body_html: &str) -> bool {
    let Ok(sig_sel) = Selector::parse(&format!(".{SIGNATURE_CLASS}")) else {
        return false;
    };
    Html::parse_fragment(body_html).select(&sig_sel).any(|el| {
        !el.ancestors().any(|node| {
            node.value()
                .as_element()
                .and_then(|e| e.attr("class"))
                .is_some_and(|class| class.split_whitespace().any(|c| c == "macro_quote"))
        })
    })
}

/// Injects the (already-sanitized) signature into the outgoing HTML body,
/// wrapped in a `.macro-email-signature` marker div. Placed after the message
/// but above any quoted/forwarded thread (Gmail's ordering): inserted before the
/// first `.macro_quote` block if present, else appended to `<body>`. If neither
/// matches (e.g. a bare fragment with no `<body>`), it is appended to the end so
/// the signature is never silently dropped.
pub(crate) fn inject_signature(body_html: &str, signature_html: &str) -> String {
    let wrapped = format!(r#"<div class="{SIGNATURE_CLASS}">{signature_html}</div>"#);

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
    let mut result = match String::from_utf8(output) {
        Ok(result) => result,
        Err(_) => return format!("{body_html}{wrapped}"),
    };
    // Neither a `<body>` nor a `.macro_quote` matched (e.g. a bare fragment) —
    // append rather than drop the signature.
    if !done.get() {
        result.push_str(&wrapped);
    }
    result
}

/// Removes any server-wrapped signature (the `.macro-email-signature` element
/// and its contents) from the body. Used to honor an explicit
/// `include_signature = false` even when a client already baked one in.
pub(crate) fn strip_signature(body_html: &str) -> String {
    let selector = format!(".{SIGNATURE_CLASS}");
    let mut output = Vec::new();
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![element!(selector.as_str(), |el| {
                el.remove();
                Ok(())
            })],
            ..Settings::default()
        },
        |c: &[u8]| output.extend_from_slice(c),
    );
    if rewriter.write(body_html.as_bytes()).is_err() {
        return body_html.to_string();
    }
    if rewriter.end().is_err() {
        return body_html.to_string();
    }
    String::from_utf8(output).unwrap_or_else(|_| body_html.to_string())
}

/// Extracts the signature's visible text for the `text/plain` MIME alternative.
/// Uses a block-aware HTML->text conversion so inline tags (`<strong>`, `<a>`, …)
/// stay on one line and only block boundaries introduce newlines.
pub(crate) fn signature_plain_text(signature_html: &str) -> String {
    email_utils::body_parsed::html_to_plaintext(signature_html).unwrap_or_default()
}
