use ammonia::Builder;
use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use std::collections::HashSet;

pub fn sanitize_email_html(raw_html: &str) -> String {
    // Attempt 1: Parse as a full document. This is best for well-formed emails.
    let document = Html::parse_document(raw_html);
    let content_to_clean = if let Some(reconstructed) = find_and_reconstruct(&document) {
        reconstructed
    } else {
        // Attempt 2 (Fallback): The document is likely malformed (e.g., body inside a p tag).
        // `parse_fragment` is more lenient and will build a usable DOM from the mess.
        let fragment = Html::parse_fragment(raw_html);
        if let Some(reconstructed) = find_and_reconstruct(&fragment) {
            reconstructed
        } else {
            // Ultimate fallback: No body tag was found with either method.
            // Sanitize the original HTML as-is.
            raw_html.to_string()
        }
    };

    CLEANER.clean(&content_to_clean).to_string()
}

/// Extracts all <style> tags and the <body> tag from a parsed document,
/// wherever they might be, and reconstructs a clean HTML string.
fn find_and_reconstruct(document: &Html) -> Option<String> {
    let style_selector = Selector::parse("style").unwrap();
    let body_selector = Selector::parse("body").unwrap();

    // 1. Find the <body> tag anywhere in the parsed document.
    // If we can't find a body, we can't proceed. This is our main content.
    if let Some(body) = document.select(&body_selector).next() {
        // 2. Find all <style> tags anywhere in the document.
        // This is resilient to parser "fix-ups" that might move them out of the <head>.
        let styles_html = document
            .select(&style_selector)
            .map(|style_el| style_el.html())
            .collect::<String>();

        let body_html = body.html();
        let reconstructed = format!("{}{}", styles_html, body_html);
        Some(reconstructed)
    } else {
        None
    }
}

// create a single time
static CLEANER: Lazy<Builder<'static>> = Lazy::new(|| {
    let mut cleaner = Builder::default();

    // we are allowing style tags. ammonia has built-in css sanitization
    cleaner.rm_clean_content_tags(&["style"]);

    // Basic and layout tags
    cleaner.add_tags(&[
        "body",
        "div",
        "span",
        "p",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "em",
        "b",
        "i",
        "u",
        "strike",
        "sub",
        "sup",
        "ul",
        "ol",
        "li",
        "blockquote",
        "code",
        "pre",
        "table",
        "tbody",
        "thead",
        "tfoot",
        "tr",
        "td",
        "th",
        "img",
        "a",
        "font",
        "center",
        "style",
    ]);

    cleaner.filter_style_properties(get_safe_css_properties());

    // Allow common, generally safe attributes
    // IMPORTANT: `style` is included here, enabling Ammonia's CSS filter
    cleaner.add_generic_attributes(&[
        "style",
        "class",
        "id",
        "title",
        "lang",
        "dir",
        "width",
        "height",
        "align",
        "valign",
        "bgcolor",
        "border",
        "cellpadding",
        "cellspacing",
        "colspan",
        "rowspan",
    ]);

    // Tag-specific attributes
    cleaner.add_tag_attributes("a", &["href", "title", "target"]);
    cleaner.add_tag_attributes(
        "img",
        &[
            "src", "alt", "title", "width", "height", "border", "align", "vspace", "hspace",
        ],
    );
    cleaner.add_tag_attributes("font", &["color", "size", "face"]);
    cleaner.add_tag_attributes(
        "td",
        &[
            "width", "height", "align", "valign", "bgcolor", "colspan", "rowspan", "nowrap",
        ],
    ); // Add common TD attrs
    cleaner.add_tag_attributes(
        "th",
        &[
            "width", "height", "align", "valign", "bgcolor", "colspan", "rowspan", "nowrap",
        ],
    ); // Add common TH attrs

    // Link safety and url schemes
    let mut allowed_schemes = HashSet::new();
    allowed_schemes.insert("http");
    allowed_schemes.insert("https");
    allowed_schemes.insert("mailto");
    allowed_schemes.insert("cid");
    cleaner.url_schemes(allowed_schemes);
    cleaner
});

/// a wild guess based on what the internet told me
fn get_safe_css_properties() -> HashSet<&'static str> {
    HashSet::from([
        // Text Formatting & Appearance
        "color",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant",
        "text-decoration",
        "text-transform",
        "letter-spacing",
        "word-spacing",
        "line-height",
        "text-align",
        "vertical-align",
        "white-space",
        "direction",
        "unicode-bidi",
        // Color & Background
        "background-color",
        "opacity",
        // Box Model & Spacing
        "padding",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "margin",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "border",
        "border-top",
        "border-right",
        "border-bottom",
        "border-left",
        "border-width",
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
        "border-style",
        "border-top-style",
        "border-right-style",
        "border-bottom-style",
        "border-left-style",
        "border-color",
        "border-top-color",
        "border-right-color",
        "border-bottom-color",
        "border-left-color",
        "border-radius",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
        "border-spacing",
        "border-collapse",
        // Basic Layout & Sizing
        "width",
        "height",
        "max-width",
        "max-height",
        "min-width",
        "min-height",
        "display",
        "overflow",
        "clear",
        "float",
        // Lists
        "list-style-type",
        "list-style-position",
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// should extract the body attribute and disregard the title attribute
    #[test]
    fn test_sanitize_body_only() {
        let input_html = include_str!("testdata/sanitizer/body-only/original.html");
        let expected_html = include_str!("testdata/sanitizer/body-only/expected.html");
        test_html_sanitization(input_html, expected_html, "body-only");
    }

    fn test_html_sanitization(input_html: &str, expected_html: &str, test_name: &str) {
        // Get the sanitizer and sanitize the HTML
        let sanitized_html = sanitize_email_html(input_html);

        // Write the sanitized output to a file for inspection (uncomment for debugging if needed)
        let path = format!("src/testdata/sanitizer/{}/actual_output.html", test_name);
        fs::create_dir_all(path.rsplit_once('/').unwrap().0).expect("Failed to create directory");
        fs::write(path, &sanitized_html).expect("Failed to write sanitized output to file");

        // Compare the sanitized output with the expected output
        // Normalize whitespace for more reliable comparison
        assert_eq!(
            sanitized_html.replace(" ", "").replace("\n", "").trim(),
            expected_html.replace(" ", "").replace("\n", "").trim(),
            "Test '{}' failed: sanitized HTML doesn't match expected output",
            test_name
        );
    }
}
