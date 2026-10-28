use super::*;

#[test]
fn only_http_and_https_links_are_kept() {
    for (link, kept) in [
        ("https://maps.example.com/place?id=1", true),
        ("  HTTP://example.com  ", true),
        ("javascript:alert(document.cookie)", false),
        ("JavaScript:alert(1)", false),
        ("data:text/html,<script>alert(1)</script>", false),
        ("file:///etc/passwd", false),
        ("//evil.example.com", false),
        ("https://exa mple.com", false),
        ("https://example.com/\u{0}", false),
        ("", false),
    ] {
        assert_eq!(web_link(link).is_some(), kept, "{link}");
    }
    assert_eq!(
        web_link(&format!(
            "https://example.com/{}",
            "a".repeat(WEB_LINK_LIMIT)
        )),
        None
    );
}
