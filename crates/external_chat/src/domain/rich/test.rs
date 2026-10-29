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

#[test]
fn a_group_created_line_names_the_subject_never_the_creation_metadata() {
    let metadata = r#"{"reason":0,"parent_group_jid":null,"is_open_group":true,"subject":null,"author":"123456789@lid","is_initially_empty":false}"#;
    let named = r#"{"reason":0,"subject":"Launch","author":"123456789@lid"}"#;

    assert_eq!(created_subject(metadata), None);
    assert_eq!(created_subject(named).as_deref(), Some("Launch"));
    assert_eq!(created_subject(" Launch ").as_deref(), Some("Launch"));
    assert_eq!(created_subject("2026").as_deref(), Some("2026"));
    assert_eq!(created_subject("  "), None);
}
