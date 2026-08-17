use ammonia::Builder;
use regex::Regex;
use scraper::{Html, Selector};
use std::collections::HashSet;
use std::sync::LazyLock;

#[cfg(test)]
mod test;

/// Sanitizes a full email HTML document against the shared allowlist.
///
/// Extracts `<style>` and `<body>` content from (possibly malformed)
/// documents, cleans the markup with ammonia, and scrubs `<style>` element
/// text of external references and non-allowlisted properties.
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

    sanitize_style_blocks(&CLEANER.clean(&content_to_clean).to_string())
}

/// Sanitizes a user-supplied HTML fragment (e.g. an email signature) with the
/// same allowlist as full email bodies, but without the document/body
/// reconstruction `sanitize_email_html` applies to whole messages — a fragment
/// has no `<head>`/`<body>` to extract, so we just clean it in place.
pub fn sanitize_html_fragment(raw_html: &str) -> String {
    sanitize_style_blocks(&CLEANER.clean(raw_html).to_string())
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

/// Innermost `{ ... }` declaration blocks. Nested at-rules (`@media { a { … } }`)
/// keep their structure: only the inner declaration lists match.
static CSS_DECLARATION_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{([^{}]*)\}").expect("static regex is valid"));
static CSS_COMMENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)/\*.*?\*/").expect("static regex is valid"));
/// `@import …` up to its terminating semicolon (or end of block/input).
static CSS_IMPORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)@import[^;{}]*(;|$)").expect("static regex is valid"));
/// `<style …> … </style>` in ammonia's already-normalized output.
static STYLE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)(<style\b[^>]*>)(.*?)(</style>)").expect("static regex is valid")
});

/// Scrubs the text content of every `<style>` element in sanitized HTML.
///
/// Ammonia's built-in CSS filter applies only to `style` *attributes*;
/// `<style>` element content passes through verbatim, which would allow CSS
/// overlay phishing and `@import`/`url()` exfiltration or tracking. This pass
/// removes comments and `@import` rules and keeps only allowlisted,
/// externally-inert declarations.
fn sanitize_style_blocks(html: &str) -> String {
    if !html.contains("<style") {
        return html.to_string();
    }

    STYLE_BLOCK
        .replace_all(html, |caps: &regex::Captures<'_>| {
            format!(
                "{}{}{}",
                &caps[1],
                sanitize_style_content(&caps[2]),
                &caps[3]
            )
        })
        .into_owned()
}

fn sanitize_style_content(css: &str) -> String {
    let css = CSS_COMMENT.replace_all(css, "");
    let css = CSS_IMPORT.replace_all(&css, "");

    CSS_DECLARATION_BLOCK
        .replace_all(&css, |caps: &regex::Captures<'_>| {
            format!("{{{}}}", filter_css_declarations(&caps[1]))
        })
        .into_owned()
}

fn filter_css_declarations(declarations: &str) -> String {
    let safe_properties = get_safe_css_properties();

    declarations
        .split(';')
        .filter_map(|declaration| {
            let (property, value) = declaration.split_once(':')?;
            let property = property.trim().to_ascii_lowercase();
            let value_lower = value.to_ascii_lowercase();
            // Escapes (`\75 rl(`) could smuggle url() past a substring check,
            // so any backslash disqualifies the declaration outright.
            let value_is_inert = !value_lower.contains("url(")
                && !value_lower.contains("expression(")
                && !value_lower.contains('\\');
            (safe_properties.contains(property.as_str()) && value_is_inert)
                .then(|| format!("{}:{};", property, value.trim()))
        })
        .collect()
}

// create a single time
static CLEANER: LazyLock<Builder<'static>> = LazyLock::new(|| {
    let mut cleaner = Builder::default();

    // Keep <style> elements and their text. NOTE: ammonia's CSS filtering
    // applies only to `style` attributes; element content is emitted verbatim,
    // so sanitize_style_blocks scrubs it after cleaning.
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
        "dl",
        "dt",
        "dd",
        "caption",
        "map",
        "area", // Maps
        "details",
        "summary", // Modern
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
    // 'name' is used for anchor links within the email (e.g., Table of Contents)
    cleaner.add_tag_attributes("a", &["href", "title", "target", "name"]);
    // NOTE: `srcset` is deliberately absent — ammonia scheme-filters `src`
    // but not the URL list inside `srcset`, so allowing it would let
    // non-allowlisted schemes through. Images still render via `src`.
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
    // Used to restart numbering or change type (A, a, I, i)
    cleaner.add_tag_attributes("ol", &["start", "type"]);
    cleaner.add_tag_attributes("img", &["usemap"]);
    // Essential for image maps to function
    cleaner.add_tag_attributes("map", &["name"]);
    cleaner.add_tag_attributes("area", &["shape", "coords", "href", "alt", "target"]);
    cleaner.add_tag_attributes("details", &["open"]);

    // Link safety and url schemes
    let mut allowed_schemes = HashSet::new();
    allowed_schemes.insert("http");
    allowed_schemes.insert("https");
    allowed_schemes.insert("mailto");
    allowed_schemes.insert("cid");
    allowed_schemes.insert("tel");
    allowed_schemes.insert("sms");
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
        "font",
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
        // --- FLEXBOX (Safe and essential for modern email) ---
        "flex",
        "flex-basis",
        "flex-direction",
        "flex-flow",
        "flex-grow",
        "flex-shrink",
        "flex-wrap",
        "align-content",
        "align-items",
        "align-self",
        "justify-content",
        "order",
        "gap",
        // --- TYPOGRAPHY EXTENSIONS ---
        "word-break",
        "overflow-wrap", // Essential for preventing long URLs from breaking layout
        "line-break",
        // --- MICROSOFT OUTLOOK SPECIFICS ---
        // These are safe logic-wise and essential for Outlook rendering.
        // There are many, but these are the most common layout fixers:
        "mso-line-height-rule",
        "mso-hide",
        "mso-padding-alt",
        "mso-margin-top-alt",
        "mso-margin-bottom-alt",
        // Color & Background
        "background-color",
        "opacity",
        "background",
        "background-image",
        "background-position",
        "background-repeat",
        "background-size",
        // Essential for reliable box model calculations in responsive email
        "box-sizing",
        // List shorthand is often used instead of list-style-type
        "list-style",
    ])
}
