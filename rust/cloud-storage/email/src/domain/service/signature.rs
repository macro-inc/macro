use lol_html::html_content::ContentType;
use lol_html::{HtmlRewriter, Settings, element};
use scraper::{Html, Selector};
use std::cell::Cell;

#[cfg(test)]
mod test;

/// Marker class wrapping an injected signature.
const SIGNATURE_CLASS: &str = "macro-email-signature";

/// Whether the body already carries an injected signature, so the caller can
/// stay idempotent across a client that still bakes it in and across re-sends.
pub(crate) fn has_signature(body_html: &str) -> bool {
    Selector::parse(&format!(".{SIGNATURE_CLASS}"))
        .ok()
        .map(|sel| {
            Html::parse_fragment(body_html)
                .select(&sel)
                .next()
                .is_some()
        })
        .unwrap_or(false)
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

/// Extracts the signature's visible text for the `text/plain` MIME alternative.
/// Joins text nodes with newlines (after trimming/dropping empties) so words
/// don't run together across block boundaries (e.g. `<div>A</div><div>B</div>`
/// becomes `A\nB`, not `AB`).
pub(crate) fn signature_plain_text(signature_html: &str) -> String {
    Html::parse_fragment(signature_html)
        .root_element()
        .text()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
