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
