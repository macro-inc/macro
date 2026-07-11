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

/// Convert an HTML fragment to block-aware plaintext: block elements are
/// separated by newlines, but inline runs (`<strong>`, `<em>`, `<a>`, …) stay
/// on one line. Returns `None` if conversion fails. Suitable for building a
/// `text/plain` MIME alternative from a small HTML snippet (e.g. a signature).
pub fn html_to_plaintext(html: &str) -> Option<String> {
    let config = html2text::config::plain()
        .no_table_borders()
        .link_footnotes(false)
        .no_link_wrapping();

    parse_html_to_text(html, config)
}

fn parse_html_to_text(html: &str, config: Config<PlainDecorator>) -> Option<String> {
    // html2text panics on some malformed-but-real email HTML (e.g. a table
    // rowspan overhanging past the last row, or rowspan="0"). A panic here
    // takes down the whole message-processing worker, so contain it and treat
    // the body as unparseable instead.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        config.string_from_read(html.as_bytes(), usize::MAX)
    }))
    .inspect_err(|_| {
        tracing::warn!(
            html_len = html.len(),
            "html2text panicked converting email body"
        );
    });
    match result {
        Ok(Ok(text)) => {
            let trimmed = text
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .collect::<Vec<&str>>()
                .join("\n");
            Some(trimmed)
        }
        Ok(Err(_)) | Err(_) => None,
    }
}

#[cfg(test)]
mod test;
