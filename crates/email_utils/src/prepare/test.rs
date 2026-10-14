use super::*;

fn prepare(html: &str) -> PreparedEmailBody {
    prepare_email_body(
        &EmailBodyInput {
            html: Some(html),
            ..Default::default()
        },
        &BodyOptions::default(),
    )
}

fn prepare_with(html: &str, options: BodyOptions) -> PreparedEmailBody {
    prepare_email_body(
        &EmailBodyInput {
            html: Some(html),
            ..Default::default()
        },
        &options,
    )
}

fn images(remote: RemoteImages, proxy_url: Option<&str>) -> BodyOptions {
    BodyOptions {
        images: ImagePolicy {
            remote,
            proxy_url: proxy_url.map(str::to_owned),
        },
        ..Default::default()
    }
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

#[test]
fn strips_editor_metadata_and_handlers_from_the_reader() {
    let html = r#"<p data-lexical-indent="1"><a data-document-mention="true" href="https://example.com/spec" onclick="alert(1)">Spec</a><img data-scale="0.5" src="cid:part" onerror="alert(1)"></p>"#;
    let reader = prepare(html).html;
    assert!(!reader.contains("data-"), "{reader}");
    assert!(!reader.contains("onclick") && !reader.contains("onerror"));
    assert!(reader.contains(r#"href="https://example.com/spec""#));
    assert!(reader.contains(">Spec</a>"));
}

#[test]
fn normalizes_frameset_documents_to_an_empty_body() {
    let body = prepare(r#"<frameset><frame src="https://example.com"></frameset>"#);
    assert_eq!(body.html, "");
    assert!(!body.has_table);
}

#[test]
fn bounds_deep_nesting_without_exposing_removed_markup() {
    let html = format!(
        "<p>Before</p>{}Middle<img src=\"cid:part\"><form><p>Hidden form</p></form><script>Hidden script</script>{}<p>After</p>",
        "<div>left".repeat(5000),
        "right</div>".repeat(5000),
    );
    let result = prepare(&html).html;
    assert_eq!(
        strip_tags(&result),
        format!(
            "Before{}Middle{}After",
            "left".repeat(5000),
            "right".repeat(5000)
        )
    );
    assert!(result.contains(r#"<img src="cid:part">"#));
    assert!(!result.contains("Hidden") && !result.contains("<form") && !result.contains("<script"));
}

#[test]
fn trims_signatures_and_is_deterministic() {
    let html = r#"<p>Hello<br><br></p><div class="gmail_signature">Signature</div>"#;
    let first = prepare(html);
    assert_eq!(first, prepare(html));
    assert_eq!(first.html, "<p>Hello</p>");
    assert!(first.has_hidden_content);
}

#[test]
fn falls_back_to_the_body_without_replyless_html() {
    assert_eq!(prepare("<p>New message</p>").html, "<p>New message</p>");
    let body = prepare_email_body(
        &EmailBodyInput {
            html: Some("<p>New message</p>"),
            replyless_html: Some(""),
            text: None,
        },
        &BodyOptions::default(),
    );
    assert_eq!(body.html, "<p>New message</p>");
}

#[test]
fn removes_recognized_quotes_and_restores_them_on_request() {
    let html = r#"<p>New</p><div class="macro_quote">Old</div><div class="macro-email-signature">Me</div>"#;
    let body = prepare(html);
    assert_eq!(body.html, "<p>New</p>");
    assert!(body.has_hidden_content);
    let full = prepare_with(
        html,
        BodyOptions {
            show_quoted_content: true,
            ..Default::default()
        },
    );
    assert_eq!(full.html, html);
}

#[test]
fn uses_replyless_html_and_detects_equal_length_differences() {
    let body = prepare_email_body(
        &EmailBodyInput {
            html: Some("<p>Old</p>"),
            replyless_html: Some("<p>New</p>"),
            text: None,
        },
        &BodyOptions::default(),
    );
    assert_eq!(body.html, "<p>New</p>");
    assert!(body.has_hidden_content);
}

#[test]
fn renders_plaintext_literally() {
    let body = prepare_email_body(
        &EmailBodyInput {
            text: Some("**Hello**\n<img src=x onerror=alert(1)> & goodbye"),
            ..Default::default()
        },
        &BodyOptions::default(),
    );
    assert_eq!(body.kind, PreparedKind::Text);
    assert!(
        body.html
            .contains("**Hello**\n&lt;img src=x onerror=alert(1)&gt; &amp; goodbye")
    );
    assert!(!body.has_hidden_content);
}

#[test]
fn repairs_malformed_html_and_preserves_tables() {
    let body = prepare("<table><tr><td>A<td>B");
    assert_eq!(
        body.html,
        "<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"
    );
    assert!(body.has_table);
}

#[test]
fn retains_document_styles_and_signatures_by_option() {
    let html = r#"<head><style>p { color: red }</style></head><body><p>A<br></p><span class="gmail_signature_prefix">--</span><div class="gmail_signature">Me</div></body>"#;
    let body = prepare(html);
    assert_eq!(body.html, "<style>p{color:red}</style>\n<p>A</p>");
    assert!(body.has_hidden_content);
    let full = prepare_with(
        html,
        BodyOptions {
            show_quoted_content: true,
            ..Default::default()
        },
    );
    assert!(
        full.html
            .contains(r#"<div class="gmail_signature">Me</div>"#)
    );
}

#[test]
fn trims_trailing_breaks_and_empty_wrappers() {
    for html in ["<p>A<br><br></p>  ", "<div><p>A</p><div><br></div></div>"] {
        let body = prepare(html).html;
        assert!(!body.contains("<br>"), "{body}");
        assert!(body.contains('A'));
    }
    assert!(
        prepare(r#"<p>A</p><img src="cid:a">"#)
            .html
            .contains("<img")
    );
    assert!(prepare("<p>A<br>B</p>").html.contains("A<br>B"));
    assert_eq!(
        prepare("<p>Hello<br><br><br></p><style></style>").html,
        "<p>Hello</p>"
    );
    assert!(
        prepare("<p>Hello</p><style>p{color:red}</style>")
            .html
            .contains("<style>p{color:red}</style>")
    );
}

#[test]
fn splits_classes_on_ascii_whitespace_only() {
    for separator in ['\u{A0}', '\u{0B}'] {
        let body = prepare(&format!(
            r#"<p class="gmail_signature{separator}main">Message body</p><div class="macro_quote{separator}main">More content</div>"#
        ));
        assert!(body.html.contains("Message body"));
        assert!(body.html.contains("More content"));
        assert!(!body.has_hidden_content);
    }
}

#[test]
fn proxies_image_sources_with_encoded_urls() {
    let body = prepare_with(
        r#"<img src="https://example.com/my image.png">"#,
        images(RemoteImages::Allow, Some("https://proxy.test")),
    );
    assert!(body.html.contains("my%20image.png"), "{}", body.html);
}

#[test]
fn rejects_escaped_host_selectors_and_image_set_functions() {
    let html =
        r#"<style>:h\6fst{color:red}p{background:i\6d age-set("https://evil.test/a" 1x)}</style>"#;
    let body = prepare_with(html, images(RemoteImages::Block, None)).html;
    assert!(!body.contains("color:red"), "{body}");
    assert!(!body.contains("evil.test"), "{body}");
}

#[test]
fn rejects_escaped_url_functions() {
    let html = r#"<style>p{background:u\72l("https://evil.test/a")}</style><p style="background:u\72l('https://evil.test/b')">Text</p>"#;
    for options in [
        images(RemoteImages::Block, None),
        images(RemoteImages::Allow, Some("https://proxy.test")),
    ] {
        let body = prepare_with(html, options).html;
        assert!(!body.contains("evil.test"), "{body}");
    }
}

#[test]
fn normalizes_cid_and_https_schemes() {
    let body = prepare(r#"<img src="CID:part"><img src="HTTPS://example.com/a">"#).html;
    assert!(body.contains(r#"src="cid:part""#), "{body}");
    assert!(body.contains(r#"src="https://example.com/a""#), "{body}");
}

#[test]
fn removes_active_markup() {
    for html in [
        r#"<img src="https://example.com/x" onerror="alert(1)">"#,
        r#"<script>alert(1)</script><iframe src="https://example.com"></iframe>"#,
        r#"<svg><a href="javascript:alert(1)">x</a></svg><math><mi>x</mi></math>"#,
        r#"<a href="java&#10;script:alert(1)" ping="https://example.com">x</a>"#,
        r#"<form action="https://example.com"><input autofocus><button>send</button></form>"#,
        r#"<template><img src=x onerror="alert(1)"></template>"#,
    ] {
        let body = prepare(&format!("<p>Safe content</p>{html}")).html;
        assert!(body.contains("<p>Safe content</p>"), "{body}");
        for needle in [
            "onerror",
            "alert(",
            "<script",
            "<iframe",
            "<svg",
            "<math",
            "<form",
            "<input",
            "<template",
            "ping=",
        ] {
            assert!(!body.contains(needle), "{needle} in {body}");
        }
    }
}

#[test]
fn keeps_relative_and_cid_links_but_not_data_links() {
    let body = prepare(r#"<a href="mailto:a@example.com">mail</a><a href="https://example.com">web</a><a href="data:image/png;base64,AAAA">data</a><a href="/document">relative</a><a href="cid:part">part</a>"#).html;
    assert!(body.contains(r#"href="mailto:a@example.com""#));
    assert!(body.contains(r#"href="https://example.com""#));
    assert!(!body.contains(r#"href="data:"#));
    assert!(body.contains(r#"href="/document""#));
    assert!(body.contains(r#"href="cid:part""#));
}

#[test]
fn blocks_every_automatic_remote_resource_path() {
    let html = r#"<style>@import "https://evil.test/a";@font-face{font-family:x;src:url(https://evil.test/font)}p{background:url(https://evil.test/a)}b{background:image-set("https://evil.test/b" 1x)}</style><p style="background: url(https://evil.test/c)">Text</p><img src="https://evil.test/d" srcset="https://evil.test/e 2x"><table background="https://evil.test/f"><tr><td>x</td></tr></table>"#;
    let body = prepare_with(html, images(RemoteImages::Block, None)).html;
    assert!(!body.contains("evil.test"), "{body}");
    assert!(!body.contains("srcset"));
    assert!(body.contains("Text"));
}

#[test]
fn proxies_img_sources_only() {
    let html = r#"<style>p{background:url(https://example.com/rule)}</style><img src="https://example.com/a"><p style="background:url(https://example.com/b)">X</p><table background="https://example.com/table"><tr><td>X</td></tr></table>"#;
    let body = prepare_with(
        html,
        images(RemoteImages::Allow, Some("https://proxy.test/image")),
    )
    .html;
    assert!(body.contains("https://proxy.test/image?url=https%3A%2F%2Fexample.com%2Fa"));
    assert!(
        body.contains(r#"url(&quot;https://example.com/b&quot;)"#),
        "{body}"
    );
    assert!(
        body.contains(r#"url("https://example.com/rule")"#),
        "{body}"
    );
    assert!(body.contains(r#"background="https://example.com/table""#));
    assert_eq!(body.matches("proxy.test").count(), 1);
}

#[test]
fn keeps_cid_and_raster_data_images_but_not_svg_data() {
    let body = prepare(r#"<img src="cid:part"><img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml;base64,AAAA">"#).html;
    assert!(body.contains(r#"src="cid:part""#));
    assert!(body.contains(r#"src="data:image/png;base64,AAAA""#));
    assert!(!body.contains("svg+xml"));
}

#[test]
fn keeps_nested_dark_rules_and_strips_host_selectors_and_unsafe_urls() {
    let body = prepare("<style>@media screen{@media(prefers-color-scheme:dark){p{color:white}}p{color:red}}:host{position:fixed}p{background:url(javascript:alert)}p{color:blue}</style>").html;
    assert!(
        !body.contains(":host") && !body.contains("javascript"),
        "{body}"
    );
    assert!(body.contains("prefers-color-scheme"));
    assert!(body.contains("color:red"));
    assert!(body.contains("color:blue"));
}

#[test]
fn strips_theme_rules_only_at_the_top_of_head_styles() {
    let html = "<head><style>@media(prefers-color-scheme:dark){.head{color:red}}@media screen{@media(prefers-color-scheme:dark){.nested{color:green}}}</style></head><body><style>@media(prefers-color-scheme:dark){.body{color:blue}}</style><p>Hello</p></body>";
    let body = prepare(html).html;
    assert!(!body.contains(".head"), "{body}");
    assert!(body.contains(".nested{color:green}"), "{body}");
    assert!(body.contains(".body{color:blue}"), "{body}");
}

#[test]
fn keeps_valid_declarations_around_a_recoverable_error() {
    let html = r#"<style>.preheader{display:none;color:red !;}.message{font-size:32px;padding:24px}</style><p style="padding:12px;color:red !;margin:8px">Hello</p>"#;
    let body = prepare(html).html;
    assert!(body.contains(".preheader{display:none}"), "{body}");
    assert!(
        body.contains(".message{font-size:32px;padding:24px}"),
        "{body}"
    );
    assert!(
        body.contains(r#"style="padding:12px;margin:8px""#),
        "{body}"
    );
    assert!(!body.contains("red !"));
}

#[test]
fn keeps_variables_under_the_normal_policy_only() {
    let html = r#"<style>.message{--tone:red;color:var(--tone,var(--missing,blue));--picture:url(https://example.com/image);background:var(--picture,url(https://example.com/fallback))}</style><p class="message">Hello</p>"#;
    let body = prepare(html).html;
    assert!(
        body.contains("color:var(--tone,var(--missing,blue))"),
        "{body}"
    );
    let blocked = prepare_with(html, images(RemoteImages::Block, None)).html;
    assert!(!blocked.contains("example.com"), "{blocked}");
    assert!(!blocked.contains("var("), "{blocked}");
}

#[test]
fn normalizes_protocol_relative_resources() {
    let html = r##"<a href="//example.com/open">Open</a><map name="offer"><area href="//example.com/accept" shape="rect" coords="0,0,20,20"></map><img src="//example.com/image" usemap="#offer">"##;
    let body = prepare(html).html;
    assert!(body.contains(r#"href="https://example.com/open""#));
    assert!(body.contains(r#"<area href="https://example.com/accept""#));
    assert!(body.contains(r#"src="https://example.com/image""#));
    assert!(
        !prepare_with(html, images(RemoteImages::Block, None))
            .html
            .contains("src=")
    );
}

#[test]
fn keeps_grouping_and_namespace_rules() {
    let html = r#"<style>@namespace h url(http://www.w3.org/1999/xhtml);@layer email{@scope (.message){h|p{font-size:32px;color:red}}}</style><div class="message"><p>Hello</p></div>"#;
    let body = prepare(html).html;
    assert!(
        body.contains("@namespace h url(http://www.w3.org/1999/xhtml);"),
        "{body}"
    );
    assert!(
        body.contains("@layer email{@scope (.message){h|p{font-size:32px;color:red}}}"),
        "{body}"
    );
}

#[test]
fn rewrites_image_set_candidates_and_blocks_indirect_loads() {
    let html = r#"<p style="background:image-set('//example.com/a' 1x,url(https://example.com/b) 2x)">A</p><p style="--source:'https://example.com/indirect';background:image-set(var(--source) 1x)">B</p>"#;
    let body = prepare(html).html;
    assert!(
        body.contains(r#"image-set(&quot;https://example.com/a&quot; 1x,url(&quot;https://example.com/b&quot;) 2x)"#),
        "{body}"
    );
    let blocked = prepare_with(html, images(RemoteImages::Block, None)).html;
    assert!(!blocked.contains("background:"), "{blocked}");
}

#[test]
fn never_lets_css_strings_close_a_style_element() {
    let body = prepare(r#"<style>p::after{content:"< /style>"}</style>"#).html;
    assert!(!body.contains("content:\"<"), "{body}");
}

#[test]
fn drops_unsafe_properties_and_expressions() {
    let body = prepare(r#"<p style="behavior:url(x.htc);animation:spin 1s;transition:all 1s;width:expression(alert(1));color:red">X</p>"#).html;
    assert!(body.contains(r#"style="color:red""#), "{body}");
}

#[test]
fn keeps_media_query_whitespace_meaningful() {
    let body = prepare("<body><style>@media screen and (max-width: 600px){.x{margin:0 auto}}</style><p>X</p></body>").html;
    assert!(
        body.contains("@media screen and (max-width: 600px){.x{margin:0 auto}}"),
        "{body}"
    );
}

#[test]
fn breaks_the_first_rule_after_a_cdo_like_the_web_renderer() {
    // Outlook wraps style sheets in `<!-- … -->`. The web renderer prints the
    // token against the next rule it keeps, which then never matches; the
    // server must render the same until both change together.
    let html = "<head><style><!-- @font-face{font-family:x} p.MsoNormal{margin:0in} .other{color:red} --></style></head><body><p class=\"MsoNormal\">Hi</p></body>";
    let body = prepare(html).html;
    assert!(
        body.contains(r"\3c !--p.MsoNormal{margin:0in}.other{color:red}-->"),
        "{body}"
    );
}
