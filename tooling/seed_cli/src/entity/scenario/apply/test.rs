use super::*;

#[test]
fn supplied_html_is_sanitized_like_inbound_mail() {
    let cleaned = scenario_body_html_sanitized(Some("<p>hi</p><script>alert(1)</script>"), "plain");
    assert!(cleaned.contains("<p>hi</p>"));
    assert!(!cleaned.to_ascii_lowercase().contains("<script"));
}

#[test]
fn plaintext_fallback_is_also_sanitized() {
    let cleaned = scenario_body_html_sanitized(None, "hello<script>x</script>");
    assert!(cleaned.contains("hello"));
    assert!(!cleaned.to_ascii_lowercase().contains("<script"));
}
