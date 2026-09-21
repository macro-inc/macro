use super::build_user_invite_message;

#[test]
fn escapes_organization_html() {
    let org_name = "R&D <img src=x onerror=alert(1)> &lt;Partners&gt;";
    let result = build_user_invite_message(org_name, "prod");

    assert!(result.contains(
        "<strong>R&amp;D &lt;img src=x onerror=alert(1)&gt; &amp;lt;Partners&amp;gt;</strong>"
    ));
    assert!(!result.contains(org_name));
}

#[test]
fn preserves_organization_text_and_environment_links() {
    for (environment, prefix) in [("prod", ""), ("staging", "staging."), ("dev", "dev.")] {
        let result = build_user_invite_message("Acme's \"Team\" – 東京", environment);

        assert!(result.contains("<strong>Acme's \"Team\" – 東京</strong>"));
        assert!(result.contains(&format!(
            "href=\"https://{prefix}macro.com/app/?login=true\""
        )));
        assert!(!result.contains("{ORG_NAME}"));
        assert!(!result.contains("{PREFIX}"));
    }
}
